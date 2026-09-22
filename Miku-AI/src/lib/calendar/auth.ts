import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../oauth/pkce";

// Google Calendar (idea #7 del plan) -- mismo diseño que Gmail
// (lib/gmail/auth.ts), conexión aparte (Sebastián puede tener cuentas de
// Gmail conectadas sin querer conectar su calendario, o viceversa). Puerto
// de loopback distinto (14700 Spotify, 14701 Gmail, 14702 este) para no
// confundirlos en logs.
//
// Reusa el MISMO cliente OAuth de Google Cloud que ya usa Gmail
// (VITE_GMAIL_CLIENT_ID/SECRET) -- es el mismo cliente tipo "Escritorio"
// del mismo proyecto, y un cliente OAuth puede pedir distintos scopes en
// distintos pedidos de autorización sin necesitar un cliente nuevo. Lo
// único que hace falta en la consola de Google Cloud: habilitar la
// "Google Calendar API" (APIs & Services -> Library) y agregar el scope
// de solo lectura en "Acceso a los datos" -- NO hace falta crear ningún
// cliente OAuth nuevo.
const REDIRECT_PORT = 14702;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// Solo lectura -- mismo criterio de privacidad que Gmail.
const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
const STORE_KEY = "calendarAccounts";

export type CalendarAccount = {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

type RustGoogleTokens = {
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

export async function loadCalendarAccounts(): Promise<CalendarAccount[]> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    return (await store.get<CalendarAccount[]>(STORE_KEY)) ?? [];
  } catch (err) {
    console.error("Error cargando cuentas de Calendar:", err);
    return [];
  }
}

async function saveCalendarAccounts(accounts: CalendarAccount[]) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, accounts);
  await store.save();
}

export async function disconnectCalendarAccount(email: string): Promise<void> {
  const accounts = await loadCalendarAccounts();
  await saveCalendarAccounts(accounts.filter((a) => a.email !== email));
}

export async function listConnectedCalendarEmails(): Promise<string[]> {
  return (await loadCalendarAccounts()).map((a) => a.email);
}

// El calendario "primary" de una cuenta usa el email de esa cuenta como
// su propio id -- mismo rol que /gmail/v1/users/me/profile en la
// integración de Gmail, pero con el endpoint real de Calendar.
async function fetchPrimaryCalendarEmail(accessToken: string): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Error obteniendo el calendario principal: ${await response.text()}`);
  }
  const data = await response.json();
  return data.id as string;
}

// Mismo flujo que connectGmail() -- reusa los comandos de Rust
// gmail_exchange_code/gmail_refresh_token (genéricos, solo hablan con
// oauth2.googleapis.com/token con los parámetros que se les pasan, nada
// específico de Gmail en el código Rust) y el comando de loopback
// oauth_wait_for_redirect (también genérico, recibe el puerto).
export async function connectCalendar(): Promise<string> {
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

  const result = await invoke<RustGoogleTokens>("gmail_exchange_code", {
    clientId: clientId(),
    clientSecret: clientSecret(),
    code,
    codeVerifier: verifier,
    redirectUri: REDIRECT_URI,
  });

  if (!result.refresh_token) {
    throw new Error(
      "Google no mandó ningún refresh token -- probá revocar el acceso desde myaccount.google.com/permissions y conectar de nuevo.",
    );
  }

  const email = await fetchPrimaryCalendarEmail(result.access_token);

  const newAccount: CalendarAccount = {
    email,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };

  const accounts = await loadCalendarAccounts();
  const withoutThisAccount = accounts.filter((a) => a.email !== email);
  await saveCalendarAccounts([...withoutThisAccount, newAccount]);

  return email;
}

async function refreshCalendarAccount(account: CalendarAccount): Promise<CalendarAccount> {
  const result = await invoke<RustGoogleTokens>("gmail_refresh_token", {
    clientId: clientId(),
    clientSecret: clientSecret(),
    refreshToken: account.refreshToken,
  });

  const refreshed: CalendarAccount = {
    email: account.email,
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + result.expires_in * 1000,
  };

  const accounts = await loadCalendarAccounts();
  await saveCalendarAccounts(
    accounts.map((a) => (a.email === account.email ? refreshed : a)),
  );
  return refreshed;
}

export async function getValidAccessTokenForCalendar(email: string): Promise<string | null> {
  const accounts = await loadCalendarAccounts();
  const account = accounts.find((a) => a.email === email);
  if (!account) return null;

  if (account.expiresAt - Date.now() > 60000) {
    return account.accessToken;
  }
  try {
    const refreshed = await refreshCalendarAccount(account);
    return refreshed.accessToken;
  } catch (err) {
    console.error(
      `Error refrescando el token de Calendar para ${email} (puede haber expirado o haber sido revocado):`,
      err,
    );
    await disconnectCalendarAccount(email);
    return null;
  }
}
