import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";
import { migrateEntriesV1toV2 } from "./boneRangesMigration";

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
  // Versión de los rangos de huesos con que están escritas las
  // intensidades (sin el campo = versión 1). Ver lib/boneRangesMigration.ts.
  rangos?: number;
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
      const loaded = JSON.parse(await readTextFile(path)) as Store;
      // Las diseñadas con los rangos de huesos viejos se convierten una vez
      // para verse igual (el archivo se sincroniza: queda anotado en cada una).
      let migrated = 0;
      for (const reaction of Object.values(loaded)) {
        if (reaction && (reaction.rangos ?? 1) < BONE_RANGES_VERSION) {
          reaction.entries = migrateEntriesV1toV2(reaction.entries);
          reaction.rangos = BONE_RANGES_VERSION;
          migrated++;
        }
      }
      if (migrated > 0) {
        await writeTextFile(path, JSON.stringify(loaded, null, 2));
        console.log(`[Tacto] ${migrated} reacciones convertidas a los rangos de huesos v${BONE_RANGES_VERSION}.`);
      }
      cache = loaded;
    }
  } catch (err) {
    console.error("[Tacto] No se pudieron cargar las reacciones de Miku:", err);
  }
}

export function getDesignedReaction(key: TouchReactionKey): DesignedTouchReaction | null {
  return cache[key] ?? null;
}

export async function saveDesignedReaction(key: TouchReactionKey, reaction: DesignedTouchReaction) {
  cache = { ...cache, [key]: { ...reaction, rangos: BONE_RANGES_VERSION } };
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
