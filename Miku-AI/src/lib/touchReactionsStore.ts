import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";

// Tarea 8.12, segunda parte: las reacciones al tacto las decide Miku, no
// una tabla escrita a mano. La primera vez que Sebastián la toca en una
// zona, ella diseña cómo reacciona (ver useTouchReactions.requestDesign) y
// queda guardado acá; desde la segunda, se reproduce al instante, sin
// llamar al modelo. Las reacciones escritas a mano en useTouchReactions.ts
// son solo el respaldo mientras ella no diseñó la suya.
//
// Vive en la carpeta de memoria y se sincroniza por GitHub como el resto
// (ver sync_memory_to_github en lib.rs): es parte de quién es ella.

// "caricia" y "harta" no son zonas del cuerpo sino situaciones (acariciar
// la cabeza, muchos toques seguidos), pero se guardan igual.
export type TouchReactionKey =
  | "cabeza"
  | "cara"
  | "coletas"
  | "mano"
  | "brazo"
  | "torso"
  | "falda"
  | "pierna"
  | "caricia"
  | "harta";

export type DesignedTouchReaction = {
  // null = no cambia la expresión.
  expression: string | null;
  entries: ParsedMovement["entries"];
  durationMs: number;
  animated: boolean;
  // Para zonas con lado (una mano, una coleta): de qué lado la diseñó. Del
  // otro lado se usa la misma reacción espejada.
  side: "left" | "right" | null;
  createdAt: string;
};

type Store = Partial<Record<TouchReactionKey, DesignedTouchReaction>>;

let cache: Store = {};

async function storePath() {
  return join(await appDataDir(), "memory", "reacciones_tacto.json");
}

export async function loadTouchReactions() {
  try {
    const path = await storePath();
    if (await exists(path)) {
      cache = JSON.parse(await readTextFile(path)) as Store;
    }
  } catch (err) {
    console.error("[Tacto] No se pudieron cargar las reacciones de Miku:", err);
  }
}

export function getDesignedReaction(key: TouchReactionKey): DesignedTouchReaction | null {
  return cache[key] ?? null;
}

export async function saveDesignedReaction(key: TouchReactionKey, reaction: DesignedTouchReaction) {
  cache = { ...cache, [key]: reaction };
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// Para el panel de memoria: se lee del archivo (no del caché) para mostrar
// exactamente lo que quedó guardado.
export async function listDesignedReactions(): Promise<Store> {
  const path = await storePath();
  if (!(await exists(path))) return {};
  return JSON.parse(await readTextFile(path)) as Store;
}

// "Que la rediseñe": sin reacción guardada, el próximo toque en esa zona usa
// el respaldo y le pide a Miku que la diseñe de nuevo (ver resolveReaction
// en useTouchReactions). Se recarga el caché para que eso pase ya, sin
// reiniciar la app.
export async function deleteDesignedReaction(key: TouchReactionKey) {
  const store = await listDesignedReactions();
  delete store[key];
  await writeTextFile(await storePath(), JSON.stringify(store, null, 2));
  await loadTouchReactions();
}

// La misma reacción, del otro lado del cuerpo: huesos izquierdos <->
// derechos, y los ejes y/z con el signo invertido (la tabla de ejes del
// prompt los define espejados entre lados, y en cuello/cabeza/columna
// y/z son girar/ladear hacia la izquierda o la derecha). x no cambia.
export function mirrorEntries(entries: ParsedMovement["entries"]): ParsedMovement["entries"] {
  return entries.map((e) => ({
    bone: e.bone.startsWith("left")
      ? `right${e.bone.slice(4)}`
      : e.bone.startsWith("right")
        ? `left${e.bone.slice(5)}`
        : e.bone,
    axis: e.axis,
    intensity: e.axis === "x" ? e.intensity : -e.intensity,
  }));
}
