import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";

// Punto 5b del plan, segunda versión (pedido de Sebastián): Miku no tiene un
// solo baile sino un repertorio que arma ella, y elige cuál según la
// canción (ver useMusicSway.ts). Queda acá, en la carpeta de memoria,
// sincronizado por GitHub: sus bailes y qué eligió para cada canción de
// Spotify (la próxima vez que suene, se hace solo).

export type Dance = {
  // Para qué tipo de canción lo hizo, en sus palabras.
  descripcion: string;
  // true: el vaivén se ajusta al golpe de la canción; false: a su propio
  // ritmo (canciones sin golpe marcado, como una balada).
  alGolpe: boolean;
  expression: string | null;
  entries: ParsedMovement["entries"];
  durationMs: number;
  createdAt: string;
  rangos: number;
};

type SongChoice = { baile: string | null; titulo: string; at: string };

type Store = {
  version: 2;
  bailes: Record<string, Dance>;
  porCancion: Record<string, SongChoice>;
};

// Las canciones recordadas (las más viejas se olvidan).
const SONGS_MAX = 300;

const empty = (): Store => ({ version: 2, bailes: {}, porCancion: {} });
let cache: Store = empty();

async function storePath() {
  return join(await appDataDir(), "memory", "musica.json");
}

async function persist() {
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

export async function loadMusicStore() {
  try {
    const path = await storePath();
    if (!(await exists(path))) return;
    const loaded = JSON.parse(await readTextFile(path));
    if (loaded && loaded.version === 2) {
      cache = loaded as Store;
    } else if (loaded && loaded.choice === "bailo") {
      // Versión 1: un solo baile, al golpe. Pasa a ser el primero del
      // repertorio, con su nombre.
      cache = empty();
      cache.bailes.mi_baile = {
        descripcion: "el primero que diseñaste, para canciones con ritmo",
        alGolpe: true,
        expression: loaded.expression ?? null,
        entries: loaded.entries ?? [],
        durationMs: loaded.durationMs ?? 1000,
        createdAt: loaded.createdAt ?? new Date().toISOString(),
        rangos: loaded.rangos ?? BONE_RANGES_VERSION,
      };
      await persist();
    } else {
      // Versión 1 con [NO_BAILO] (o vacía): se empieza de cero; ahora se le
      // pregunta por canción, y puede decir que no con cada una.
      cache = empty();
    }
  } catch (err) {
    console.error("[Música] No se pudo cargar el repertorio de Miku:", err);
  }
}

export function getDances(): Record<string, Dance> {
  return cache.bailes;
}

export function getSongChoice(songKey: string): SongChoice | null {
  return cache.porCancion[songKey] ?? null;
}

export async function saveDance(name: string, dance: Omit<Dance, "rangos">) {
  cache.bailes[name] = { ...dance, rangos: BONE_RANGES_VERSION };
  await persist();
}

export async function saveSongChoice(songKey: string, baile: string | null, titulo: string) {
  cache.porCancion[songKey] = { baile, titulo, at: new Date().toISOString() };
  const keys = Object.keys(cache.porCancion);
  if (keys.length > SONGS_MAX) {
    keys
      .sort((a, b) => cache.porCancion[a].at.localeCompare(cache.porCancion[b].at))
      .slice(0, keys.length - SONGS_MAX)
      .forEach((key) => delete cache.porCancion[key]);
  }
  await persist();
}

// Sus bailes, en una línea cada uno (para los prompts).
export function describeDances(): string {
  const names = Object.keys(cache.bailes);
  if (names.length === 0) return "(todavía ninguno)";
  return names
    .map((name) => `- ${name}: ${cache.bailes[name].descripcion} (${cache.bailes[name].alGolpe ? "sigue el golpe" : "a tu propio ritmo"})`)
    .join("\n");
}

// [REDISEÑAR_MUSICA]: empieza de cero (bailes y elecciones).
// [OLVIDAR_BAILE: nombre]: borra ese baile y las canciones que lo usaban
// (la próxima vez que suenen, vuelve a elegir).
export async function processMusicRedesignMarkers(text: string) {
  let changed = false;
  if (/\[REDISE[ÑN]AR_M[UÚ]SICA\]/i.test(text)) {
    cache = empty();
    changed = true;
    console.log("[Música] Miku decidió empezar de cero con sus bailes.");
  }
  for (const match of text.matchAll(/\[OLVIDAR_BAILE:\s*([^\]]+)\]/gi)) {
    const name = match[1].trim().toLowerCase();
    if (!cache.bailes[name]) continue;
    delete cache.bailes[name];
    for (const key of Object.keys(cache.porCancion)) {
      if (cache.porCancion[key].baile === name) delete cache.porCancion[key];
    }
    changed = true;
    console.log(`[Música] Miku olvidó su baile "${name}".`);
  }
  if (changed) await persist();
}
