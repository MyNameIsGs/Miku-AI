import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../oauth/pkce";

// Puerto fijo distinto del de Spotify (14700) para no confundirlos en
// logs -- a diferencia de Spotify, Google no exige que el puerto coincida
// con nada pre-registrado (permite loopback en cualquier puerto para
// clientes tipo "Desktop app"), pero mantenerlo fijo es más simple que
// elegir uno dinámico y no hay riesgo real de colisión en esta app.
const REDIRECT_PORT = 14701;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// Nivel 3 de la Tarea 6.7: solo lectura, nunca enviar/borrar/modificar.
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const STORE_KEY = "gmailAccounts";

// Sebastián usa varias cuentas de Gmail -- a diferencia de Spotify (una
// sola cuenta tiene sentido), acá se guarda un array, uno por cuenta
// conectada, identificado por su email real (no un id opaco). Nota: como
// la app de Google sigue en "Testing", CADA cuenta que se quiera conectar
// tiene que estar agregada a mano como test user en el OAuth consent
// screen del Cloud Console -- si no, Google rechaza el login para esa
// cuenta con "access blocked", no es un bug de acá.
export type GmailAccount = {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

type RustGmailTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

function clientId(): string {
  const id = import.meta.env.VITE_GMAIL_CLIENT_ID;
  if (!id) throw new Error("Falta VITE_GMAIL_CLIENT_ID en .env");
  return id;
}

function clientSecret(): string {
  const secret = import.meta.env.VITE_GMAIL_CLIENT_SECRET;
  if (!secret) throw new Error("Falta VITE_GMAIL_CLIENT_SECRET en .env");
  return secret;
}

export async function loadGmailAccounts(): Promise<GmailAccount[]> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    return (await store.get<GmailAccount[]>(STORE_KEY)) ?? [];
  } catch (err) {
    console.error("Error cargando cuentas de Gmail:", err);
    return [];
  }
}

async function saveGmailAccounts(accounts: GmailAccount[]) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, accounts);
  await store.save();
}

export async function disconnectGmailAccount(email: string): Promise<void> {
  const accounts = await loadGmailAccounts();
  await saveGmailAccounts(accounts.filter((a) => a.email !== email));
}

export async function listConnectedGmailEmails(): Promise<string[]> {
  return (await loadGmailAccounts()).map((a) => a.email);
}

async function fetchProfileEmail(accessToken: string): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/profile",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Error obteniendo el perfil de Gmail: ${await response.text()}`);
  }
  const data = await response.json();
  return data.emailAddress as string;
}

// Arranca el flujo de conexión: abre el navegador para que Sebastián
// autorice, espera el callback de loopback (Rust, oauth_loopback.rs) y
// cambia el código por tokens. A diferencia de Spotify, el intercambio se
// hace en Rust (gmail_auth.rs, con reqwest) y no con fetch() desde el
// frontend -- no está documentado que el endpoint de token de Google
// permita CORS desde un origen arbitrario como el del webview, y Google
// mismo recomienda para apps nativas usar un cliente HTTP nativo para
// esta parte.
//
// prompt=select_account fuerza el selector de cuenta de Google en vez de
// autorizar directo la única sesión activa en el navegador -- necesario
// para poder elegir CUÁL de sus varias cuentas está conectando cada vez.
// Devuelve el email conectado para que la UI lo muestre.
export async function connectGmail(): Promise<string> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId());
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  // access_type=offline: sin esto Google no manda refresh_token. prompt=
  // "select_account consent" fuerza el selector de cuenta Y que vuelva a
  // mandar el refresh_token, aunque esa cuenta puntual ya se haya
  // autorizado antes en la vida de esta app.
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "select_account consent");

  const waitForRedirect = invoke<string>("oauth_wait_for_redirect", {
    port: REDIRECT_PORT,
  });

  await openUrl(authorizeUrl.toString());

  const rawQuery = await waitForRedirect;
  const params = new URLSearchParams(rawQuery);

  if (params.get("state") !== state) {
    throw new Error(
      "El callback de Google no coincide con esta sesión (state distinto) -- por seguridad, no se usa.",
    );
  }
  const oauthError = params.get("error");
  if (oauthError) {
    throw new Error(`Google rechazó la autorización: ${oauthError}`);
  }
  const code = params.get("code");
  if (!code) {
    throw new Error("Google no mandó ningún código de autorización.");
  }

  const result = await invoke<RustGmailTokens>("gmail_exchange_code", {
    clientId: clientId(),
    clientSecret: clientSecret(),
    code,
    codeVerifier: verifier,
    redirectUri: REDIRECT_URI,
  });

  if (!result.refresh_token) {
    throw new Error(
      "Google no mandó ningún refresh token -- prueba revocar el acceso desde myaccount.google.com/permissions y conectar de nuevo.",
    );
  }

  const email = await fetchProfileEmail(result.access_token);

  const newAccount: GmailAccount = {
    email,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };

  // Si ya estaba conectada (reconexión de la misma cuenta), reemplaza en
  // vez de duplicar.
  const accounts = await loadGmailAccounts();
  const withoutThisAccount = accounts.filter((a) => a.email !== email);
  await saveGmailAccounts([...withoutThisAccount, newAccount]);

  return email;
}

async function refreshGmailAccount(account: GmailAccount): Promise<GmailAccount> {
  const result = await invoke<RustGmailTokens>("gmail_refresh_token", {
    clientId: clientId(),
    clientSecret: clientSecret(),
    refreshToken: account.refreshToken,
  });

  const refreshed: GmailAccount = {
    email: account.email,
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + result.expires_in * 1000,
  };

  const accounts = await loadGmailAccounts();
  await saveGmailAccounts(
    accounts.map((a) => (a.email === account.email ? refreshed : a)),
  );
  return refreshed;
}

// Para usar antes de cualquier llamada a la API de Gmail para una cuenta
// puntual -- refresca solo si falta menos de un minuto para que expire.
// Con la app de Google en modo "Testing", el refresh_token expira cada 7
// días -- si el refresh falla (revocado o vencido), esa cuenta se
// desconecta sola en vez de tirar un error críptico cada vez, así la
// próxima consulta simplemente no la incluye y Sebastián sabe que tiene
// que reconectarla desde el panel de Config.
export async function getValidAccessTokenFor(email: string): Promise<string | null> {
  const accounts = await loadGmailAccounts();
  const account = accounts.find((a) => a.email === email);
  if (!account) return null;

  if (account.expiresAt - Date.now() > 60000) {
    return account.accessToken;
  }
  try {
    const refreshed = await refreshGmailAccount(account);
    return refreshed.accessToken;
  } catch (err) {
    console.error(
      `Error refrescando el token de Gmail para ${email} (puede haber expirado o haber sido revocado):`,
      err,
    );
    await disconnectGmailAccount(email);
    return null;
  }
}
