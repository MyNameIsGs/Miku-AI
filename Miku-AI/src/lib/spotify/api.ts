import { getValidAccessToken } from "./auth";

export type SpotifyTrack = {
  name: string;
  artists: string;
  uri: string;
};

async function spotifyFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error(
      "Spotify no está conectado -- Sebastián tiene que conectarlo primero desde el panel de Config.",
    );
  }
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function searchTracks(query: string, limit = 5): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(limit),
  });
  const response = await spotifyFetch(`/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Error buscando en Spotify: ${await response.text()}`);
  }
  const data = await response.json();
  const items: unknown[] = data.tracks?.items ?? [];
  return items.map((item) => {
    const track = item as {
      name: string;
      artists?: { name: string }[];
      uri: string;
    };
    return {
      name: track.name,
      artists: (track.artists ?? []).map((a) => a.name).join(", "),
      uri: track.uri,
    };
  });
}

type SpotifyDevice = {
  id: string;
  name: string;
  isActive: boolean;
};

async function listDevices(): Promise<SpotifyDevice[]> {
  const response = await spotifyFetch("/me/player/devices");
  if (!response.ok) {
    throw new Error(`Error consultando dispositivos de Spotify: ${await response.text()}`);
  }
  const data = await response.json();
  const items: unknown[] = data.devices ?? [];
  // Diagnóstico temporal (ver 6.23/6.24 del contexto): el JSON crudo trae
  // más campos que los que usamos (is_restricted, type, volume_percent) --
  // loguearlo entero para tener datos reales la próxima vez que falle, en
  // vez de seguir adivinando la causa.
  console.log("[Spotify] GET /me/player/devices ->", JSON.stringify(items));
  return items.map((item) => {
    const device = item as { id: string; name: string; is_active: boolean };
    return { id: device.id, name: device.name, isActive: device.is_active };
  });
}

function putPlay(uri: string, deviceId?: string): Promise<Response> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  return spotifyFetch(`/me/player/play${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [uri] }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Recién abierta, Spotify puede tardar unos segundos en registrarse como
// dispositivo ante la API -- confirmado en la práctica pidiéndole a Miku
// que abra Spotify y reproduzca algo en el mismo pedido, la lista de
// dispositivos venía vacía porque el proceso todavía estaba arrancando.
// Reintenta con espera antes de rendirse.
async function waitForDevices(maxAttempts = 4, delayMs = 1500): Promise<SpotifyDevice[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const devices = await listDevices();
    if (devices.length > 0) return devices;
    if (attempt < maxAttempts) await sleep(delayMs);
  }
  return [];
}

// Pone a sonar una canción por su URI. Gotcha real de la Web API de
// Spotify (confirmado en la práctica, no solo en la documentación): aunque
// Sebastián tenga la app de Spotify abierta, /me/player/play puede
// devolver 404 igual si la API todavía no tiene ningún dispositivo
// marcado como "activo" -- pasa seguido recién abierta la app, antes de
// tocar play una vez ahí, o si el proceso todavía está iniciando. La
// solución real es pedir la lista de dispositivos (con espera si viene
// vacía) y mandar el device_id explícito, no asumir que la API va a elegir
// uno sola. Los mensajes de error dejan explícito que reintentar la misma
// herramienta no cambia nada, para que el modelo no entre en un loop de
// reintentos (eso agotó las 3 vueltas de tool calling la primera vez).
export async function playTrack(uri: string): Promise<void> {
  let response = await putPlay(uri);

  if (!response.ok && response.status !== 204) {
    // Diagnóstico temporal: cuerpo real de la respuesta antes de decidir
    // qué rama tomar -- clonamos porque el body de un Response solo se
    // puede leer una vez.
    const firstBody = await response.clone().text().catch(() => "(sin cuerpo)");
    console.warn(
      `[Spotify] Primer intento de /me/player/play falló. Status: ${response.status}. Body: ${firstBody}`,
    );
  }

  if (response.status === 404) {
    const devices = await waitForDevices();
    if (devices.length === 0) {
      throw new Error(
        "Sigue sin aparecer ningún dispositivo de Spotify, ni esperando unos segundos. Esto no se arregla reintentando la herramienta -- puede que Spotify todavía esté iniciando; conviene avisarle a Sebastián y esperar un poco más antes de volver a pedirlo.",
      );
    }
    const target = devices.find((d) => d.isActive) ?? devices[0];
    console.log("[Spotify] Reintentando /me/player/play con device_id explícito:", target);
    response = await putPlay(uri, target.id);
  }

  if (!response.ok && response.status !== 204) {
    const body = await response.text().catch(() => "(sin cuerpo)");
    console.error(
      `[Spotify] /me/player/play siguió fallando. Status: ${response.status}. Body: ${body}`,
    );
    throw new Error(
      `Error al reproducir en Spotify (esto no se arregla reintentando la herramienta, hay que avisarle a Sebastián): ${body}`,
    );
  }
}
