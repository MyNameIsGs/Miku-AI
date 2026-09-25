import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";

// Punto 5b del plan: si Miku se mueve con la música, y cómo. Lo decide ella
// la primera vez que suena algo con ritmo claro (ver useMusicSway.ts) y
// queda acá, en la carpeta de memoria, sincronizado por GitHub.

export type MusicDesign =
  | {
      choice: "bailo";
      expression: string | null;
      entries: ParsedMovement["entries"];
      // Lo que eligió para cada vaivén; al sonar, se ajusta al ritmo.
      durationMs: number;
      createdAt: string;
      rangos: number;
    }
  | { choice: "no"; createdAt: string };

let cache: MusicDesign | null = null;

async function storePath() {
  return join(await appDataDir(), "memory", "musica.json");
}

export async function loadMusicDesign() {
  try {
    const path = await storePath();
    cache = (await exists(path)) ? (JSON.parse(await readTextFile(path)) as MusicDesign) : null;
  } catch (err) {
    console.error("[Música] No se pudo cargar cómo se mueve Miku con la música:", err);
  }
}

export function getMusicDesign(): MusicDesign | null {
  return cache;
}

export async function saveMusicDesign(design: MusicDesign) {
  cache = design.choice === "bailo" ? { ...design, rangos: BONE_RANGES_VERSION } : design;
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// [REDISEÑAR_MUSICA]: se borra y la próxima vez que suene música se le
// vuelve a preguntar.
export async function processMusicRedesignMarkers(text: string) {
  if (!/\[REDISE[ÑN]AR_M[UÚ]SICA\]/i.test(text) || !cache) return;
  cache = null;
  await writeTextFile(await storePath(), "null");
  console.log("[Música] Miku decidió rediseñar cómo se mueve con la música.");
}
