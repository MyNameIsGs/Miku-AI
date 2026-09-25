import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";

// Punto 3 del plan: cómo se duerme Miku cuando Sebastián no está, y cómo se
// despierta cuando vuelve. No es una tabla escrita a mano: lo diseña ella la
// primera vez que le pasa (ver useSleep.ts) y queda guardado acá, en la
// carpeta de memoria, sincronizado por GitHub como sus reacciones al tacto.

export type SleepMoment = "dormir" | "despertar";

export type SleepDesign = {
  // null = no cambia la cara ("cara:..." para una cara por partes).
  expression: string | null;
  entries: ParsedMovement["entries"];
  durationMs: number;
  animated: boolean;
  createdAt: string;
  rangos: number;
};

type Store = Partial<Record<SleepMoment, SleepDesign>>;

let cache: Store = {};

async function storePath() {
  return join(await appDataDir(), "memory", "sueno.json");
}

export async function loadSleepDesigns() {
  try {
    const path = await storePath();
    if (await exists(path)) cache = JSON.parse(await readTextFile(path)) as Store;
  } catch (err) {
    console.error("[Sueño] No se pudo cargar cómo se duerme Miku:", err);
  }
}

export function getSleepDesign(moment: SleepMoment): SleepDesign | null {
  return cache[moment] ?? null;
}

export async function saveSleepDesign(moment: SleepMoment, design: Omit<SleepDesign, "rangos">) {
  cache = { ...cache, [moment]: { ...design, rangos: BONE_RANGES_VERSION } };
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// [REDISEÑAR_DORMIR] / [REDISEÑAR_DESPERTAR]: ella decide cambiarlo. Se
// borra y la próxima vez que le pase lo diseña de nuevo, en ese momento.
export async function processSleepRedesignMarkers(text: string) {
  for (const match of text.matchAll(/\[REDISE[ÑN]AR_(DORMIR|DESPERTAR)\]/gi)) {
    const moment = match[1].toLowerCase() as SleepMoment;
    if (!cache[moment]) continue;
    const { [moment]: _removed, ...rest } = cache;
    cache = rest;
    await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
    console.log(`[Sueño] Miku decidió rediseñar cómo se ${moment === "dormir" ? "duerme" : "despierta"}.`);
  }
}
