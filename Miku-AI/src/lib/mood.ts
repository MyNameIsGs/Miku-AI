import { load } from "@tauri-apps/plugin-store";
import {
  applyPush,
  currentMood,
  describeMood,
  Mood,
  MoodAmount,
  MoodDuration,
  moodLevel,
  MoodLevel,
  MoodPush,
  MoodState,
  NEUTRAL_STATE,
  VALID_MOODS,
} from "./moodModel";

export { VALID_MOODS };
export type { Mood, MoodLevel };

// Tarea 8.10 + modelo nuevo (2026-09-28, ver moodModel.ts): el ánimo es un
// nivel que cada cosa empuja, que se va apagando solo, y cuya duración
// depende de lo que lo causó. Queda en .settings.dat (local, no
// sincronizado: es cómo está ella en ESTA PC ahora, no una memoria).
const STORE_KEY = "currentMood";
// Registro de cada cambio de ánimo con su origen. Local, los últimos 200.
const LOG_KEY = "moodLog";
const LOG_MAX = 200;
// Empujones recientes (para acostumbrarse y hartarse): solo en memoria.
const HISTORY_KEEP_MS = 15 * 60 * 1000;

// Qué le cambió el ánimo: algo de la charla, un tacto, o se apagó solo.
export type MoodOrigin = "charla" | "tacto" | "se apagó solo";

// Lo que no dijo ella: la charla mueve bastante y dura unas horas; un tacto,
// poco y un rato (así quedan las reacciones que diseñó antes de esto).
const DEFAULTS: Record<Exclude<MoodOrigin, "se apagó solo">, { amount: MoodAmount; duration: MoodDuration }> = {
  charla: { amount: "bastante", duration: "unas_horas" },
  tacto: { amount: "poco", duration: "un_rato" },
};

type MoodLogEntry = { at: string; mood: Mood; origin: MoodOrigin; level?: string; source?: string };

let state: MoodState = NEUTRAL_STATE;
let history: { source: string; at: number }[] = [];
let loaded = false;
let lastShownMood: Mood = "neutral";

// Quién quiere enterarse al instante de un cambio (la píldora de la barra).
const listeners = new Set<(mood: Mood) => void>();
export function onMoodChange(listener: (mood: Mood) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Estados guardados antes del modelo nuevo ({mood, setAt} sin nivel): se
// leen como "contenta" normal que se apaga en unas horas.
function fromStored(raw: unknown): MoodState {
  const s = raw as Partial<MoodState> & { setAt?: string | number };
  if (!s || !s.mood || !(VALID_MOODS as readonly string[]).includes(s.mood)) return NEUTRAL_STATE;
  return {
    mood: s.mood,
    intensity: typeof s.intensity === "number" ? s.intensity : 50,
    halfLifeMs: typeof s.halfLifeMs === "number" ? s.halfLifeMs : 3 * 60 * 60 * 1000,
    setAt: typeof s.setAt === "number" ? s.setAt : new Date(s.setAt ?? 0).getTime(),
  };
}

async function appendLog(entry: MoodLogEntry) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const log = (await store.get<MoodLogEntry[]>(LOG_KEY)) ?? [];
    log.push(entry);
    await store.set(LOG_KEY, log.slice(-LOG_MAX));
    await store.save();
  } catch (err) {
    console.error("Error guardando el registro de ánimo:", err);
  }
}

// Si el ánimo que se ve cambió solo con el tiempo (se apagó), se avisa y
// se registra una vez.
function noticeDecay(now: number) {
  const mood = currentMood(state, now);
  if (mood === lastShownMood) return;
  lastShownMood = mood;
  listeners.forEach((listener) => listener(mood));
  if (mood === "neutral") appendLog({ at: new Date(now).toISOString(), mood, origin: "se apagó solo" });
}

// Para quien necesita el ánimo al instante (la reacción al tacto se decide
// en el mismo cuadro del clic): "neutral" si el nivel ya es muy bajo.
export function getCachedMood(): Mood {
  const now = Date.now();
  noticeDecay(now);
  return currentMood(state, now);
}

export function getMoodLevel(): MoodLevel {
  return moodLevel(state, Date.now());
}

// Qué cara de reposo le toca (ver moodFaceStore.ts): ninguna con "un poco"
// (la cara no cambia), la de su ánimo, o la de "muy" (happy_muy...). Por
// niveles, no porcentual (pedido de Sebastián: una cara a medias se ve rara).
export function getRestingFaceKey(): string {
  const now = Date.now();
  const level = moodLevel(state, now);
  if (level === "neutral" || level === "un_poco") return "neutral";
  const mood = currentMood(state, now);
  return level === "muy" ? `${mood}_muy` : mood;
}

// "un poco contenta", "contenta", "muy contenta" o "neutral".
export function describeCurrentMood(): string {
  return describeMood(state, Date.now());
}

export async function getCurrentMood(): Promise<Mood> {
  if (!loaded) {
    const store = await load(".settings.dat", { autoSave: false });
    state = fromStored(await store.get(STORE_KEY));
    lastShownMood = currentMood(state, Date.now());
    loaded = true;
  }
  return getCachedMood();
}

/**
 * Un empujón al ánimo: `amount` y `duration` los decide ella (en
 * [ESTADO_ANIMO] o en su reacción al tacto); si no los dio, los de su
 * origen. `source` identifica qué lo causó, para acostumbrarse y hartarse
 * (la misma reacción repetida). Devuelve una nota si se hartó.
 */
export async function pushMood(
  mood: string,
  origin: Exclude<MoodOrigin, "se apagó solo">,
  opts: { amount?: MoodAmount | null; duration?: MoodDuration | null; source?: string } = {},
): Promise<string | null> {
  const normalized = mood.trim().toLowerCase();
  if (!(VALID_MOODS as readonly string[]).includes(normalized)) return null;
  await getCurrentMood();

  const now = Date.now();
  const push: MoodPush = {
    mood: normalized as Mood,
    amount: opts.amount ?? DEFAULTS[origin].amount,
    duration: opts.duration ?? DEFAULTS[origin].duration,
    source: opts.source ?? origin,
  };
  const result = applyPush(state, push, history, now);
  state = result.state;
  history = [...history.filter((h) => now - h.at <= HISTORY_KEEP_MS), { source: push.source, at: now }];

  const shown = currentMood(state, now);
  lastShownMood = shown;
  listeners.forEach((listener) => listener(shown));
  const level = describeMood(state, now);
  console.log(`[Ánimo] ${level} (por ${origin}: ${push.mood}, ${push.amount}, ${push.duration}${result.note ? `; ${result.note}` : ""})`);

  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, state);
    await store.save();
  } catch (err) {
    console.error("Error guardando el ánimo:", err);
  }
  await appendLog({ at: new Date(now).toISOString(), mood: shown, origin, level, source: push.source });
  return result.note;
}

// Compatibilidad: un cambio de ánimo sin detalles (usa los de su origen).
export async function setMood(mood: string, origin: Exclude<MoodOrigin, "se apagó solo"> = "charla") {
  await pushMood(mood, origin);
}
