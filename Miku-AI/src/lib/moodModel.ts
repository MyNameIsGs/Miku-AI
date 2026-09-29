// Modelo del ánimo de Miku (2026-09-28, pedido de Sebastián): en vez de un
// ánimo fijo que cambia de golpe y dura 8 horas, un nivel (0-100) que cada
// cosa empuja un poco, que se va apagando solo y cuya duración depende de lo
// que lo causó. Cuánto la afecta algo y cuánto le dura lo decide ella (al
// escribir [ESTADO_ANIMO] o al diseñar una reacción); acostumbrarse y
// hartarse son reglas de acá. Funciones puras: ver moodModel.test.ts.

export const VALID_MOODS = ["happy", "angry", "sad", "relaxed", "neutral"] as const;
export type Mood = (typeof VALID_MOODS)[number];

export type MoodAmount = "poco" | "bastante" | "mucho";
export type MoodDuration = "un_rato" | "unas_horas" | "todo_el_dia";
export const MOOD_AMOUNTS: MoodAmount[] = ["poco", "bastante", "mucho"];
export const MOOD_DURATIONS: MoodDuration[] = ["un_rato", "unas_horas", "todo_el_dia"];

const AMOUNT_POINTS: Record<MoodAmount, number> = { poco: 15, bastante: 35, mucho: 60 };
// Vida media: en ese tiempo el nivel baja a la mitad.
const DURATION_HALF_LIFE_MS: Record<MoodDuration, number> = {
  un_rato: 20 * 60 * 1000,
  unas_horas: 3 * 60 * 60 * 1000,
  todo_el_dia: 10 * 60 * 60 * 1000,
};

// Por debajo, neutral. Entre este y FACE_FROM siente "un poco" (lo sabe,
// pero la cara no cambia); desde FACE_FROM, su cara de ese ánimo; desde
// STRONG_FROM, su cara de "muy".
export const NEUTRAL_BELOW = 12;
export const FACE_FROM = 30;
export const STRONG_FROM = 65;

// Acostumbrarse: cada empujón igual reciente (misma fuente) resta efecto.
const HABITUATION_WINDOW_MS = 10 * 60 * 1000;
const HABITUATION_STEP = 0.6;
// Hartarse: la misma cosa muchas veces en poco tiempo ya no alegra, molesta.
const OVERLOAD_WINDOW_MS = 5 * 60 * 1000;
const OVERLOAD_COUNT = 5;

export type MoodState = { mood: Mood; intensity: number; halfLifeMs: number; setAt: number };
export type MoodPush = { mood: Mood; amount: MoodAmount; duration: MoodDuration; source: string };
export type MoodLevel = "neutral" | "un_poco" | "normal" | "muy";

export const NEUTRAL_STATE: MoodState = { mood: "neutral", intensity: 0, halfLifeMs: DURATION_HALF_LIFE_MS.un_rato, setAt: 0 };

// Nivel de ahora, ya apagado por el tiempo.
export function currentIntensity(state: MoodState, now: number): number {
  if (state.mood === "neutral") return 0;
  const elapsed = Math.max(0, now - state.setAt);
  return state.intensity * Math.pow(0.5, elapsed / state.halfLifeMs);
}

export function currentMood(state: MoodState, now: number): Mood {
  return currentIntensity(state, now) >= NEUTRAL_BELOW ? state.mood : "neutral";
}

export function moodLevel(state: MoodState, now: number): MoodLevel {
  const i = currentIntensity(state, now);
  if (state.mood === "neutral" || i < NEUTRAL_BELOW) return "neutral";
  if (i < FACE_FROM) return "un_poco";
  return i < STRONG_FROM ? "normal" : "muy";
}

// Cuántos empujones de esta fuente hubo en la ventana (sin contar este).
function recentFrom(history: { source: string; at: number }[], source: string, windowMs: number, now: number) {
  return history.filter((h) => h.source === source && now - h.at <= windowMs).length;
}

export type PushResult = { state: MoodState; note: string | null };

/**
 * Aplica un empujón al ánimo. `history` son los empujones anteriores (para
 * acostumbrarse y hartarse); quien llama agrega este después.
 */
export function applyPush(state: MoodState, push: MoodPush, history: { source: string; at: number }[], now: number): PushResult {
  let { mood, amount, duration } = push;
  let note: string | null = null;

  // Hartarse: algo agradable repetido demasiado seguido se vuelve molesto.
  const sameRecently = recentFrom(history, push.source, OVERLOAD_WINDOW_MS, now);
  if (sameRecently + 1 >= OVERLOAD_COUNT && (mood === "happy" || mood === "relaxed")) {
    mood = "angry";
    amount = "poco";
    duration = "un_rato";
    note = "ya es demasiado seguido: en vez de gustarte, te está molestando";
  }

  const habituated = recentFrom(history, push.source, HABITUATION_WINDOW_MS, now);
  const points = AMOUNT_POINTS[amount] / (1 + habituated * HABITUATION_STEP);
  const halfLife = DURATION_HALF_LIFE_MS[duration];
  const current = currentIntensity(state, now);

  let next: MoodState;
  if (mood === "neutral") {
    // Calmarse: baja lo que haya.
    const left = Math.max(0, current - points);
    next = { ...state, intensity: left, setAt: now, mood: left > 0 ? state.mood : "neutral" };
  } else if (state.mood === mood || current < NEUTRAL_BELOW) {
    // El mismo ánimo (o venía de neutral): sube, cada vez con menos margen.
    const base = state.mood === mood ? current : 0;
    next = { mood, intensity: base + points * (1 - base / 100), halfLifeMs: Math.max(halfLife, state.mood === mood ? state.halfLifeMs : 0), setAt: now };
  } else {
    // Otro ánimo: primero baja el que tiene; si sobra empuje, cambia.
    const left = current - points;
    next =
      left >= 0
        ? { ...state, intensity: left, setAt: now }
        : { mood, intensity: -left, halfLifeMs: halfLife, setAt: now };
  }
  return { state: next, note };
}

// Cómo se lo dice el prompt: "un poco contenta", "contenta", "muy contenta".
const MOOD_ADJ: Record<Exclude<Mood, "neutral">, string> = {
  happy: "contenta",
  angry: "enojada",
  sad: "triste",
  relaxed: "relajada",
};

export function describeMood(state: MoodState, now: number): string {
  const level = moodLevel(state, now);
  if (level === "neutral") return "neutral";
  const adj = MOOD_ADJ[state.mood as Exclude<Mood, "neutral">];
  return level === "un_poco" ? `un poco ${adj}` : level === "muy" ? `muy ${adj}` : adj;
}
