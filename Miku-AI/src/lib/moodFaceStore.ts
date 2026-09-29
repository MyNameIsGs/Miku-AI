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
// `anteriores`: la cara que tenía antes de pedir rediseñarla (por ella o
// por Sebastián desde Memoria), para que al rediseñar sepa de dónde parte.
type Previous = { face: string; byUser: boolean };
type Store = Partial<Record<MoodWithFace, string>> & { anteriores?: Partial<Record<MoodWithFace, Previous>> };

let cache: Store = {};

async function persist() {
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// Saca la cara actual y la guarda como "anterior": la próxima vez que esté
// así en reposo, la diseña de nuevo.
async function markForRedesign(mood: MoodWithFace, byUser: boolean) {
  const face = cache[mood];
  if (!face) return false;
  const { [mood]: _removed, ...rest } = cache;
  cache = { ...rest, anteriores: { ...(cache.anteriores ?? {}), [mood]: { face, byUser } } };
  return true;
}

// Las cuatro caras que diseñó (para el panel Memoria).
export function listMoodFaces(): Partial<Record<MoodWithFace, string>> {
  return Object.fromEntries(MOODS_WITH_FACE.filter((m) => cache[m]).map((m) => [m, cache[m]!]));
}

export function getPreviousMoodFace(mood: MoodWithFace): Previous | null {
  return cache.anteriores?.[mood] ?? null;
}

// "Que la rediseñe" desde el panel Memoria (pedido de Sebastián, 2026-09-28).
export async function requestMoodFaceRedesign(mood: MoodWithFace) {
  if (await markForRedesign(mood, true)) await persist();
}

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
  const { [mood]: _done, ...anteriores } = cache.anteriores ?? {};
  cache = { ...cache, [mood]: face, anteriores };
  await persist();
}

// [REDISEÑAR_CARA_ANIMO: ánimo]: la próxima vez que esté así en reposo, se
// lo vuelvo a preguntar.
export async function processMoodFaceRedesignMarkers(text: string) {
  let changed = false;
  for (const match of text.matchAll(/\[REDISE[ÑN]AR_CARA_ANIMO:\s*([^\]]+)\]/gi)) {
    const mood = match[1].trim().toLowerCase() as MoodWithFace;
    if (!MOODS_WITH_FACE.includes(mood) || !(await markForRedesign(mood, false))) continue;
    changed = true;
    console.log(`[Cara] Miku decidió rediseñar su cara de "${mood}".`);
  }
  if (changed) await persist();
}
