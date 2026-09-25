import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";
import { BODY_TOOLS_VERSION } from "../config/bodyChangelog";
import { Mood } from "./mood";
import { decodeFace } from "./faceParts";
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
  // Con qué versión de las herramientas de su cuerpo la diseñó o la revisó
  // por última vez (ver config/bodyChangelog.ts). Menor que la actual (o
  // sin el campo): puede revisarla con lo nuevo, si ella quiere.
  cuerpo?: number;
  // A8: si ella decidió que este tacto (con este ánimo) le cambia el ánimo,
  // a cuál. Sin el campo o null: no la afecta.
  moodEffect?: string | null;
  // A8: cómo reacciona según su ánimo, diseñado por ella la primera vez que
  // le pasa estando así. "igual" = decidió que reacciona como siempre.
  // Solo en la reacción de base (la de neutral), no dentro de otra variante.
  variantes?: Partial<Record<Exclude<Mood, "neutral">, DesignedTouchReaction | "igual">>;
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
  // Rediseñar la de base no borra las variantes por ánimo que ya tenía.
  const variantes = reaction.variantes ?? cache[key]?.variantes;
  cache = {
    ...cache,
    [key]: { ...reaction, rangos: BONE_RANGES_VERSION, cuerpo: BODY_TOOLS_VERSION, ...(variantes ? { variantes } : {}) },
  };
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// Cómo es una reacción, en palabras y valores (para mostrársela a ella).
export function describeReaction(reaction: DesignedTouchReaction): string {
  const face = reaction.expression ? decodeFace(reaction.expression) : null;
  const faceText = face
    ? `cara por partes: ${Object.entries(face).map(([part, w]) => `${part}=${Math.round(w * 100)}`).join(", ")}`
    : reaction.expression
      ? `expresión: ${reaction.expression}`
      : "sin cambio de expresión";
  const movementText =
    reaction.entries.length > 0
      ? `movimiento: ${reaction.entries.map((e) => `${e.bone}.${e.axis}=${e.intensity}`).join(", ")}, duracion=${(reaction.durationMs / 1000).toFixed(1)}s${reaction.animated ? ", animado=si" : ""}`
      : "sin movimiento";
  const sideText = reaction.side ? ` (la diseñaste del lado ${reaction.side === "left" ? "izquierdo" : "derecho"}; del otro se espeja)` : "";
  const moodText = reaction.moodEffect ? `\n- te cambia el ánimo a: ${reaction.moodEffect}` : "";
  return `- ${faceText}\n- ${movementText}${sideText}${moodText}`;
}

// A8: la reacción para un ánimo. `needsVariant` = todavía no decidió cómo
// reacciona estando así (se usa la de siempre mientras tanto).
export function getReactionForMood(
  key: TouchReactionKey,
  mood: Mood,
): { reaction: DesignedTouchReaction; needsVariant: boolean } | null {
  const base = cache[key];
  if (!base) return null;
  if (mood === "neutral") return { reaction: base, needsVariant: false };
  const variant = base.variantes?.[mood];
  if (variant === undefined) return { reaction: base, needsVariant: true };
  return { reaction: variant === "igual" ? base : variant, needsVariant: false };
}

export async function saveReactionVariant(
  key: TouchReactionKey,
  mood: Exclude<Mood, "neutral">,
  variant: DesignedTouchReaction | "igual",
) {
  const base = cache[key];
  if (!base) return;
  const stored = variant === "igual" ? "igual" : { ...variant, rangos: BONE_RANGES_VERSION, cuerpo: BODY_TOOLS_VERSION };
  cache = { ...cache, [key]: { ...base, variantes: { ...base.variantes, [mood]: stored } } };
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

// Las que diseñó antes de las últimas novedades de su cuerpo.
export function reactionsPendingReview(): TouchReactionKey[] {
  return (Object.keys(cache) as TouchReactionKey[]).filter((key) => (cache[key]?.cuerpo ?? 0) < BODY_TOOLS_VERSION);
}

// Revisó una y decidió dejarla como estaba: no se le vuelve a ofrecer
// hasta que haya novedades nuevas.
export async function markReactionReviewed(key: TouchReactionKey) {
  const reaction = cache[key];
  if (!reaction) return;
  cache = { ...cache, [key]: { ...reaction, cuerpo: BODY_TOOLS_VERSION } };
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

// Qué es cada una, para que Miku sepa de cuál habla.
export const TOUCH_REACTION_LABELS: Record<TouchReactionKey, string> = {
  cabeza: "un toquecito en la cabeza",
  cara: "que te toque la mejilla",
  coletas: "que te tire de una coleta",
  mano: "que te toque la mano",
  brazo: "que te toque el brazo",
  torso: "que te toque el torso",
  falda: "que te toque la falda",
  pierna: "que te toque la pierna",
  caricia: "que te acaricie la cabeza",
  harta: "muchos toques seguidos",
};

// Las que ya diseñó (del caché: loadTouchReactions ya corrió al arrancar).
export function designedReactionKeys(): TouchReactionKey[] {
  return Object.keys(cache) as TouchReactionKey[];
}

// [REDISEÑAR_REACCION: zona]: Miku decide cambiar una reacción suya. Se
// borra y la próxima vez que Sebastián la toque ahí la diseña de nuevo, en
// ese momento real -- igual que "Que la rediseñe" del panel, pero decidido
// por ella (antes tenía que pedírselo a él).
export async function processRedesignMarkers(text: string): Promise<TouchReactionKey[]> {
  const keys = [...text.matchAll(/\[REDISE[ÑN]AR_REACCION:\s*([^\]]+)\]/gi)]
    .flatMap((m) => m[1].split(","))
    .map((k) => k.trim().toLowerCase())
    .filter((k): k is TouchReactionKey => k in TOUCH_REACTION_LABELS);
  for (const key of keys) {
    await deleteDesignedReaction(key);
    console.log(`[Tacto] Miku decidió rediseñar su reacción a "${key}".`);
  }
  return keys;
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
