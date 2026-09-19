import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load } from "@tauri-apps/plugin-store";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "../oauth/pkce";

// Puerto fijo -- Spotify exige que el Redirect URI registrado en el
// dashboard coincida EXACTO, así que no puede ser dinámico.
const REDIRECT_PORT = 14700;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = "user-modify-playback-state user-read-playback-state";
const STORE_KEY = "spotifyTokens";

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

function clientId(): string {
  const id = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("Falta VITE_SPOTIFY_CLIENT_ID en .env");
  return id;
}

export async function loadSpotifyTokens(): Promise<SpotifyTokens | null> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    return (await store.get<SpotifyTokens>(STORE_KEY)) ?? null;
  } catch (err) {
    console.error("Error cargando tokens de Spotify:", err);
    return null;
  }
}

async function saveSpotifyTokens(tokens: SpotifyTokens) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, tokens);
  await store.save();
}

export async function clearSpotifyTokens() {
  const store = await load(".settings.dat", { autoSave: false });
  await store.delete(STORE_KEY);
  await store.save();
}

export async function isSpotifyConnected(): Promise<boolean> {
  return (await loadSpotifyTokens()) !== null;
}

// Arranca el flujo de conexión: abre el navegador para que Sebastián
// autorice, espera el callback de loopback (Rust, ver
// oauth_loopback.rs -- compartido con cualquier otra integración OAuth) y
// cambia el código por tokens. El intercambio se hace con fetch() directo
// desde el frontend -- Spotify soporta CORS para el flujo Authorization
// Code + PKCE (pensado para apps de escritorio/SPA), así que no hace falta
// pasar por Rust para esta parte (a diferencia de Gmail, ver gmail/auth.ts).
export async function connectSpotify(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
  authorizeUrl.searchParams.set("client_id", clientId());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("state", state);

  // Arranca a escuchar ANTES de abrir el navegador, para no perder el
  // callback por una carrera si Spotify responde muy rápido.
  const waitForRedirect = invoke<string>("oauth_wait_for_redirect", {
    port: REDIRECT_PORT,
  });

  await openUrl(authorizeUrl.toString());

  const rawQuery = await waitForRedirect;
  const params = new URLSearchParams(rawQuery);

  if (params.get("state") !== state) {
    throw new Error(
      "El callback de Spotify no coincide con esta sesión (state distinto) -- por seguridad, no se usa.",
    );
  }
  const oauthError = params.get("error");
  if (oauthError) {
    throw new Error(`Spotify rechazó la autorización: ${oauthError}`);
  }
  const code = params.get("code");
  if (!code) {
    throw new Error("Spotify no mandó ningún código de autorización.");
  }

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId(),
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(
      `Spotify devolvió un error al pedir el token: ${await tokenResponse.text()}`,
    );
  }

  const data = await tokenResponse.json();
  await saveSpotifyTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

async function refreshSpotifyTokens(refreshToken: string): Promise<SpotifyTokens> {
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(
      `Spotify devolvió un error al refrescar el token: ${await tokenResponse.text()}`,
    );
  }

  const data = await tokenResponse.json();
  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    // Spotify no siempre manda un refresh_token nuevo -- si no vino, el
    // anterior sigue valiendo.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveSpotifyTokens(tokens);
  return tokens;
}

// Para usar antes de cualquier llamada a la Web API de Spotify -- refresca
// solo si falta menos de un minuto para que expire. Devuelve null si nunca
// se conectó.
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await loadSpotifyTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 60000) {
    return tokens.accessToken;
  }
  const refreshed = await refreshSpotifyTokens(tokens.refreshToken);
  return refreshed.accessToken;
}
