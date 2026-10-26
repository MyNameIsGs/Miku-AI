import { load } from "@tauri-apps/plugin-store";
import { getValidAccessToken } from "./auth";

export type SpotifyTrack = {
  name: string;
  artists: string;
  uri: string;
  // Para reproducirla dentro de su álbum -- ver playTrack.
  albumUri?: string;
};

export type SpotifyPlaylist = {
  name: string;
  owner: string;
  uri: string;
};

export type SpotifyAlbum = {
  name: string;
  artists: string;
  uri: string;
};

export type SpotifyNowPlaying = {
  isPlaying: boolean;
  // Id de la canción (para recordar qué baile eligió Miku con ella).
  id?: string | null;
  track: string | null;
  artists: string | null;
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
      album?: { uri?: string };
    };
    return {
      name: track.name,
      artists: (track.artists ?? []).map((a) => a.name).join(", "),
      uri: track.uri,
      albumUri: track.album?.uri,
    };
  });
}

// Playlists/álbumes: se busca solo para reproducir el primer resultado
// directo (a diferencia de buscar_cancion, no hay una tool separada de
// "solo buscar" para estos -- pedir una playlist o un álbum puntual suele
// ser menos ambiguo que un título de canción).
export async function searchPlaylists(query: string, limit = 1): Promise<SpotifyPlaylist[]> {
  const params = new URLSearchParams({ q: query, type: "playlist", limit: String(limit) });
  const response = await spotifyFetch(`/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Error buscando playlists en Spotify: ${await response.text()}`);
  }
  const data = await response.json();
  // La API puede devolver entradas null en este array (playlists borradas
  // o ya no disponibles) -- se filtran antes de mapear.
  const items: unknown[] = (data.playlists?.items ?? []).filter(Boolean);
  return items.map((item) => {
    const playlist = item as { name: string; owner?: { display_name?: string }; uri: string };
    return {
      name: playlist.name,
      owner: playlist.owner?.display_name ?? "",
      uri: playlist.uri,
    };
  });
}

// Playlists propias (dueño o seguidas) -- la búsqueda pública de Spotify
// apenas indexa contenido privado del usuario, así que para
// reproducir_playlist conviene buscar acá primero por coincidencia de
// texto (mismo criterio que cerrar_pendiente/abrir_aplicacion: el código
// hace el matching, no un id opaco) en vez de confiar en /search para
// algo que probablemente sea una playlist personal de Sebastián.
async function listMyPlaylists(): Promise<SpotifyPlaylist[]> {
  const results: SpotifyPlaylist[] = [];
  let path: string | null = "/me/playlists?limit=50";

  while (path) {
    const response = await spotifyFetch(path);
    if (!response.ok) {
      throw new Error(`Error listando tus playlists de Spotify: ${await response.text()}`);
    }
    const data = await response.json();
    const items: unknown[] = (data.items ?? []).filter(Boolean);
    for (const item of items) {
      const playlist = item as { name: string; owner?: { display_name?: string }; uri: string };
      results.push({
        name: playlist.name,
        owner: playlist.owner?.display_name ?? "",
        uri: playlist.uri,
      });
    }
    const next: string | null = data.next ?? null;
    path = next ? next.replace("https://api.spotify.com/v1", "") : null;
  }

  return results;
}

// Busca primero entre las playlists propias/seguidas de Sebastián por
// coincidencia parcial de nombre; si no encuentra nada ahí, recién cae a
// la búsqueda pública de Spotify (para playlists editoriales que nunca
// siguió, ej. "Viral Hits").
export async function findPlaylist(query: string): Promise<SpotifyPlaylist | null> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  // Sin la playlist de una canción de Miku (ver playTrack): "la playlist
  // de Miku" tiene que encontrar "Miku y Teto", no esa.
  const mine = (await listMyPlaylists()).filter((p) => p.name !== MIKU_PLAYLIST_NAME);
  const ownMatch = mine.find((p) => p.name.toLowerCase().includes(normalized));
  if (ownMatch) return ownMatch;

  const publicResults = await searchPlaylists(query, 1);
  return publicResults[0] ?? null;
}

export async function searchAlbums(query: string, limit = 1): Promise<SpotifyAlbum[]> {
  const params = new URLSearchParams({ q: query, type: "album", limit: String(limit) });
  const response = await spotifyFetch(`/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Error buscando álbumes en Spotify: ${await response.text()}`);
  }
  const data = await response.json();
  const items: unknown[] = (data.albums?.items ?? []).filter(Boolean);
  return items.map((item) => {
    const album = item as { name: string; artists?: { name: string }[]; uri: string };
    return {
      name: album.name,
      artists: (album.artists ?? []).map((a) => a.name).join(", "),
      uri: album.uri,
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
  return items.map((item) => {
    const device = item as { id: string; name: string; is_active: boolean };
    return { id: device.id, name: device.name, isActive: device.is_active };
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

function putPlay(body: Record<string, unknown>, deviceId?: string): Promise<Response> {
  const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
  return spotifyFetch(`/me/player/play${query}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Gotcha real de la Web API de Spotify (confirmado en la práctica, no solo
// en la documentación): aunque Sebastián tenga la app de Spotify abierta,
// /me/player/play puede devolver 404 igual si la API todavía no tiene
// ningún dispositivo marcado como "activo". La solución real es pedir la
// lista de dispositivos (con espera si viene vacía) y mandar el
// device_id explícito, no asumir que la API va a elegir uno sola. Los
// mensajes de error dejan explícito que reintentar la misma herramienta
// no cambia nada, para que el modelo no entre en un loop de reintentos.
// Compartido por playTrack (uris) y playContext (context_uri) -- mismo
// endpoint, mismo problema de dispositivo, solo cambia el cuerpo.
async function playWithDeviceFallback(body: Record<string, unknown>): Promise<void> {
  let response = await putPlay(body);

  if (response.status === 404) {
    const devices = await waitForDevices();
    if (devices.length === 0) {
      throw new Error(
        "Sigue sin aparecer ningún dispositivo de Spotify, ni esperando unos segundos. Esto no se arregla reintentando la herramienta -- puede que Spotify todavía esté iniciando; conviene avisarle a Sebastián y esperar un poco más antes de volver a pedirlo.",
      );
    }
    const target = devices.find((d) => d.isActive) ?? devices[0];
    response = await putPlay(body, target.id);
  }

  if (!response.ok && response.status !== 204) {
    const responseBody = await response.text().catch(() => "(sin cuerpo)");
    throw new Error(
      `Error al reproducir en Spotify (esto no se arregla reintentando la herramienta, hay que avisarle a Sebastián): ${responseBody}`,
    );
  }
}

// La app de escritorio de Spotify (desde la actualización del
// 2026-10-23, versión 1.306) acepta { uris: [canción] } con un 204 pero no
// la reproduce: corta lo que sonaba y deja el reproductor vacío. Probado
// contra la API real con seis variantes (device_id, position_ms, varias
// uris, offset, transferir antes...), todas igual; solo arranca lo que va
// dentro de un contexto, o lo que entra por la cola. Por eso:
// - Si ya está sonando algo: se encola y se salta a ella. Al terminar
//   vuelve lo que sonaba.
// - Si no: se toca la playlist privada de Miku, que se vacía y queda solo
//   con esta canción -- al terminar se para (o sigue la reproducción
//   automática de Spotify, como antes).
// - Sin el permiso de editar playlists (token de antes de 2026-10-25): el
//   álbum de la canción empezando en ella, y se avisa que hay que
//   reconectar.
export type PlayTrackResult =
  | { kind: "now" }
  | { kind: "queued_behind" }
  | { kind: "album_fallback" };

const MIKU_PLAYLIST_STORE_KEY = "spotifyMikuPlaylistId";
const MIKU_PLAYLIST_NAME = "Miku – sonando ahora";

class MissingPlaylistScopeError extends Error {}

async function isSomethingPlaying(): Promise<boolean> {
  const response = await spotifyFetch("/me/player");
  if (response.status !== 200) return false;
  const data = await response.json();
  return data.is_playing === true && data.item != null;
}

// La API no distingue en /me/player/queue lo que encoló el usuario de lo
// que sigue del álbum/playlist, así que no se puede saber de antemano si
// Sebastián tenía canciones encoladas. Se encola y se mira dónde quedó: si
// quedó primera, se salta a ella; si quedó detrás de las suyas, se deja ahí
// (la API no permite sacar algo de la cola, y saltar varias veces se
// comería las de él).
async function queueAndSkip(uri: string): Promise<"now" | "queued_behind"> {
  await addToQueue(uri);
  let position = -1;
  for (let attempt = 0; attempt < 3 && position === -1; attempt++) {
    await sleep(400);
    const response = await spotifyFetch("/me/player/queue");
    if (!response.ok) continue;
    const data = await response.json();
    const uris: string[] = (data.queue ?? []).map((item: { uri: string }) => item.uri);
    position = uris.indexOf(uri);
  }
  if (position !== 0) return "queued_behind";

  const response = await spotifyFetch("/me/player/next", { method: "POST" });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Error al saltar a la canción en Spotify: ${await response.text()}`);
  }
  return "now";
}

async function createMikuPlaylist(): Promise<string> {
  const response = await spotifyFetch("/me/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: MIKU_PLAYLIST_NAME,
      public: false,
      description: "La usa Miku para poner una canción suelta. Se vacía sola cada vez.",
    }),
  });
  if (response.status === 401 || response.status === 403) throw new MissingPlaylistScopeError();
  if (!response.ok) {
    throw new Error(`Error creando la playlist de Miku: ${await response.text()}`);
  }
  const id: string = (await response.json()).id;
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(MIKU_PLAYLIST_STORE_KEY, id);
  await store.save();
  return id;
}

function replaceMikuPlaylistItems(playlistId: string, uri: string): Promise<Response> {
  return spotifyFetch(`/playlists/${playlistId}/items`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [uri] }),
  });
}

async function playViaMikuPlaylist(uri: string): Promise<void> {
  const store = await load(".settings.dat", { autoSave: false });
  let playlistId = (await store.get<string>(MIKU_PLAYLIST_STORE_KEY)) ?? (await createMikuPlaylist());

  let response = await replaceMikuPlaylistItems(playlistId, uri);
  // Si Sebastián la borró desde Spotify, se crea de nuevo.
  if (response.status === 404) {
    playlistId = await createMikuPlaylist();
    response = await replaceMikuPlaylistItems(playlistId, uri);
  }
  if (response.status === 401 || response.status === 403) throw new MissingPlaylistScopeError();
  if (!response.ok) {
    throw new Error(`Error preparando la playlist de Miku: ${await response.text()}`);
  }

  await playWithDeviceFallback({
    context_uri: `spotify:playlist:${playlistId}`,
    offset: { uri },
  });
}

export async function playTrack(track: SpotifyTrack): Promise<PlayTrackResult> {
  if (await isSomethingPlaying()) {
    return { kind: await queueAndSkip(track.uri) };
  }
  try {
    await playViaMikuPlaylist(track.uri);
    return { kind: "now" };
  } catch (err) {
    if (!(err instanceof MissingPlaylistScopeError) || !track.albumUri) throw err;
    await playWithDeviceFallback({ context_uri: track.albumUri, offset: { uri: track.uri } });
    return { kind: "album_fallback" };
  }
}

// Playlists y álbumes se reproducen como "contexto" (context_uri), no
// como uris individuales -- deja sonando la colección completa en orden,
// no solo un track suelto.
export async function playContext(contextUri: string): Promise<void> {
  await playWithDeviceFallback({ context_uri: contextUri });
}

// Agrega una canción a continuación de la cola actual, sin interrumpir lo
// que esté sonando -- distinto de reproducir_cancion, que corta lo que
// suena y arranca de inmediato.
export async function addToQueue(uri: string): Promise<void> {
  const response = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, {
    method: "POST",
  });
  if (response.status === 404) {
    throw new Error(
      "No hay ningún dispositivo de Spotify activo para agregar a la cola -- hay que abrir Spotify en algún lado primero.",
    );
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`Error agregando a la cola de Spotify: ${await response.text()}`);
  }
}

// Transfiere la reproducción a otro dispositivo de Spotify (por nombre
// parcial, mismo criterio de matching por texto que el resto del
// proyecto), sin cortar lo que esté sonando -- útil en un proyecto que
// tiene Spotify integrado en más de un dispositivo (desktop y Android).
export async function transferPlayback(deviceQuery: string): Promise<string> {
  const devices = await waitForDevices();
  if (devices.length === 0) {
    throw new Error("No hay ningún dispositivo de Spotify disponible para transferir la reproducción.");
  }
  const normalized = deviceQuery.trim().toLowerCase();
  const match = devices.find((d) => d.name.toLowerCase().includes(normalized));
  if (!match) {
    throw new Error(
      `No encontré ningún dispositivo de Spotify llamado "${deviceQuery}". Dispositivos disponibles: ${devices
        .map((d) => d.name)
        .join(", ")}.`,
    );
  }

  const response = await spotifyFetch("/me/player", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [match.id], play: true }),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Error transfiriendo la reproducción en Spotify: ${await response.text()}`);
  }
  return match.name;
}

export async function setShuffle(enabled: boolean): Promise<void> {
  const response = await spotifyFetch(`/me/player/shuffle?state=${enabled}`, { method: "PUT" });
  if (response.status === 404) {
    throw new Error(
      "No hay ningún dispositivo de Spotify activo para cambiar el modo aleatorio -- hay que abrir Spotify primero.",
    );
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`Error cambiando el modo aleatorio en Spotify: ${await response.text()}`);
  }
}

// "track" repite la canción actual en loop, "context" repite la
// playlist/álbum completo, "off" apaga la repetición.
export type SpotifyRepeatMode = "track" | "context" | "off";

export async function setRepeat(mode: SpotifyRepeatMode): Promise<void> {
  const response = await spotifyFetch(`/me/player/repeat?state=${mode}`, { method: "PUT" });
  if (response.status === 404) {
    throw new Error(
      "No hay ningún dispositivo de Spotify activo para cambiar la repetición -- hay que abrir Spotify primero.",
    );
  }
  if (!response.ok && response.status !== 204) {
    throw new Error(`Error cambiando la repetición en Spotify: ${await response.text()}`);
  }
}

// Qué está sonando ahora mismo -- 204 sin cuerpo es la respuesta real de
// Spotify cuando no hay nada reproduciéndose, no un error.
export async function getNowPlaying(): Promise<SpotifyNowPlaying> {
  const response = await spotifyFetch("/me/player/currently-playing");
  if (response.status === 204) {
    return { isPlaying: false, track: null, artists: null };
  }
  if (!response.ok) {
    throw new Error(`Error consultando qué está sonando en Spotify: ${await response.text()}`);
  }
  const data = await response.json();
  const item = data.item;
  if (!item) {
    return { isPlaying: false, track: null, artists: null };
  }
  const artists: { name: string }[] = item.artists ?? [];
  return {
    isPlaying: Boolean(data.is_playing),
    id: item.id ?? null,
    track: item.name ?? null,
    artists: artists.length > 0 ? artists.map((a) => a.name).join(", ") : null,
  };
}
