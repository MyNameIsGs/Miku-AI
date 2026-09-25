import { load } from "@tauri-apps/plugin-store";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";
import { migrateEntriesV1toV2 } from "./boneRangesMigration";

// Fase 7: quirks propios que Miku inventa y nombra en momentos de silencio,
// distinto de un movimiento espontáneo que hace una sola vez. Persisten en
// .settings.dat -- mismo mecanismo que customHandGestures en useMovement.ts
// -- porque son datos estructurados suyos, no prosa de personalidad
// (memory/). Sin semilla inicial: el store empieza vacío y ella los
// desarrolla por su cuenta.
export type QuirkState = "evaluando" | "confirmado";

export type StoredQuirk = {
  movement: ParsedMovement | null;
  handLeft?: string;
  handRight?: string;
  handDurationMs?: number;
  // Pedido de Sebastián: cuántos ciclos de vaivén corre un quirk ANIMADO
  // antes de asentarse solo -- decisión de Miku por quirk (ver
  // markers.ts), no un número fijo para todos. undefined = usa
  // DEFAULT_QUIRK_REVERT_CYCLES.
  revertAfterCycles?: number;
  // La cara del quirk ([EXPRESION] o [CARA] de la misma respuesta con que
  // lo creó, como un guiño), o sin el campo si no tiene.
  face?: string;
  state: QuirkState;
};

export type QuirksStore = Record<string, StoredQuirk>;

const STORE_KEY = "quirks";
// Con qué versión de los rangos de huesos están escritas las intensidades
// guardadas (sin la clave = versión 1). Ver lib/boneRangesMigration.ts.
const RANGES_VERSION_KEY = "quirksBoneRangesVersion";

// Una sola conversión por sesión aunque loadQuirks se llame dos veces a la
// vez al arrancar (panel + loop idle): si no, la segunda podría leer los
// quirks ya convertidos con la versión vieja todavía anotada y convertirlos
// de nuevo.
let rangesMigration: Promise<void> | null = null;

async function migrateQuirkRanges() {
  const store = await load(".settings.dat", { autoSave: false });
  const version = (await store.get<number>(RANGES_VERSION_KEY)) ?? 1;
  if (version >= BONE_RANGES_VERSION) return;
  // Se ven igual que antes, con los números de los rangos nuevos.
  const saved = (await store.get<QuirksStore>(STORE_KEY)) ?? {};
  for (const quirk of Object.values(saved)) {
    if (quirk.movement) {
      quirk.movement = { ...quirk.movement, entries: migrateEntriesV1toV2(quirk.movement.entries) };
    }
  }
  await store.set(STORE_KEY, saved);
  await store.set(RANGES_VERSION_KEY, BONE_RANGES_VERSION);
  await store.save();
  console.log(`[Quirks] ${Object.keys(saved).length} quirks convertidos a los rangos de huesos v${BONE_RANGES_VERSION}.`);
}

export async function loadQuirks(): Promise<QuirksStore> {
  try {
    rangesMigration ??= migrateQuirkRanges();
    await rangesMigration;
    const store = await load(".settings.dat", { autoSave: false });
    const saved = await store.get<QuirksStore>(STORE_KEY);
    return saved ?? {};
  } catch (err) {
    // Si falló la conversión, se reintenta en la próxima carga.
    rangesMigration = null;
    console.error("Error cargando quirks guardados:", err);
    return {};
  }
}

async function persistQuirks(quirks: QuirksStore) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, quirks);
    await store.save();
  } catch (err) {
    console.error("Error guardando quirks:", err);
  }
}

// Crear un quirk nuevo, o recrear uno existente, siempre lo deja en
// "evaluando" -- mismo criterio para ambos casos (ver diseño de la Fase 7).
export async function saveQuirk(
  quirks: QuirksStore,
  name: string,
  definition: Omit<StoredQuirk, "state">,
): Promise<QuirksStore> {
  const updated: QuirksStore = {
    ...quirks,
    [name]: { ...definition, state: "evaluando" },
  };
  await persistQuirks(updated);
  return updated;
}

export async function confirmQuirk(
  quirks: QuirksStore,
  name: string,
): Promise<QuirksStore> {
  if (!quirks[name]) return quirks;
  const updated: QuirksStore = {
    ...quirks,
    [name]: { ...quirks[name], state: "confirmado" },
  };
  await persistQuirks(updated);
  return updated;
}

// Panel de Configuración (idea nueva, pedida por Sebastián): dejarlo
// volver a "evaluando" a mano -- mismo estado al que ya vuelve solo un
// quirk recreado con [CREAR_QUIRK], pero disparado por Sebastián en vez
// de por Miku (por ejemplo, si confirmó algo bajo una evaluación que
// después resultó tener un bug real, como pasó con la de una sola foto).
export async function revertQuirkToEvaluando(
  quirks: QuirksStore,
  name: string,
): Promise<QuirksStore> {
  if (!quirks[name]) return quirks;
  const updated: QuirksStore = {
    ...quirks,
    [name]: { ...quirks[name], state: "evaluando" },
  };
  await persistQuirks(updated);
  return updated;
}

export async function deleteQuirk(
  quirks: QuirksStore,
  name: string,
): Promise<QuirksStore> {
  const { [name]: _removed, ...rest } = quirks;
  await persistQuirks(rest);
  return rest;
}

// Mientras un quirk está "evaluando" pesa más en la selección al azar, para
// que el loop idle lo elija con más frecuencia y así acumule ensayos más
// rápido que uno ya "confirmado". Valor de arranque, sin calibrar todavía
// contra uso real -- fácil de ajustar si en la práctica resulta demasiado
// (o poco) repetitivo.
const EVALUANDO_WEIGHT = 3;
const CONFIRMADO_WEIGHT = 1;

export function pickWeightedQuirk(quirks: QuirksStore): string | null {
  const names = Object.keys(quirks);
  if (names.length === 0) return null;
  const weighted = names.flatMap((name) =>
    Array(
      quirks[name].state === "evaluando" ? EVALUANDO_WEIGHT : CONFIRMADO_WEIGHT,
    ).fill(name),
  );
  return weighted[Math.floor(Math.random() * weighted.length)];
}
