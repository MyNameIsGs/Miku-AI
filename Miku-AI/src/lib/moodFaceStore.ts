import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

// La cara de Miku en reposo según su ánimo la elige ella (pedido de
// Sebastián: "¿no debería Miku escoger cuál será la reacción de su rostro
// en sus estados de ánimo?"). La primera vez que está en reposo con un
// ánimo que todavía no diseñó, se le pregunta (ver useMoodFaceDesign.ts);
// queda acá, en la carpeta de memoria, sincronizado por GitHub. Mientras
// no la diseñe, se usa la de respaldo (RESTING_MOOD_FACES en useFace.ts).

export type MoodWithFace = "happy" | "sad" | "angry" | "relaxed";
export const MOODS_WITH_FACE: MoodWithFace[] = ["happy", "sad", "angry", "relaxed"];

// "cara:parte=peso,...", o "ninguna" si decidió que no se le note.
type Store = Partial<Record<MoodWithFace, string>>;

let cache: Store = {};

async function storePath() {
  return join(await appDataDir(), "memory", "caras_animo.json");
}

export async function loadMoodFaces() {
  try {
    const path = await storePath();
    if (await exists(path)) cache = JSON.parse(await readTextFile(path)) as Store;
  } catch (err) {
    console.error("[Cara] No se pudieron cargar las caras de ánimo de Miku:", err);
  }
}

export function getMoodFace(mood: string): string | null {
  return cache[mood as MoodWithFace] ?? null;
}

export async function saveMoodFace(mood: MoodWithFace, face: string) {
  cache = { ...cache, [mood]: face };
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// [REDISEÑAR_CARA_ANIMO: ánimo]: la próxima vez que esté así en reposo, se
// lo vuelvo a preguntar.
export async function processMoodFaceRedesignMarkers(text: string) {
  let changed = false;
  for (const match of text.matchAll(/\[REDISE[ÑN]AR_CARA_ANIMO:\s*([^\]]+)\]/gi)) {
    const mood = match[1].trim().toLowerCase() as MoodWithFace;
    if (!cache[mood]) continue;
    const { [mood]: _removed, ...rest } = cache;
    cache = rest;
    changed = true;
    console.log(`[Cara] Miku decidió rediseñar su cara de "${mood}".`);
  }
  if (changed) await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}
