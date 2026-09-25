import { load } from "@tauri-apps/plugin-store";

// Tarea 8.10: estado de ánimo persistente entre conversaciones -- a
// diferencia de [EXPRESION] (dura un mensaje puntual), esto queda
// guardado en .settings.dat (mismo store que voicePitch/voiceRate,
// puramente local, no sincronizado por GitHub -- es "cómo está ella en
// ESTA PC ahora", no una memoria ni un rasgo de personalidad) y es el
// default de [EXPRESION] cuando una respuesta no trae una expresión
// propia (ver markers.ts). Mismo vocabulario cerrado que EXPRESION a
// propósito -- el humor termina siendo, en la práctica, "cuál es tu
// expresión de base hoy", no un concepto nuevo con su propio rango.
const STORE_KEY = "currentMood";
// Registro de cada cambio de ánimo con su origen (plan A8: medir cuánto lo
// usa antes de tocar el prompt de la charla). Local, los últimos 200.
const LOG_KEY = "moodLog";
const LOG_MAX = 200;

// "Persista horas" (pedido original), no días -- pasado esto sin que ella
// lo vuelva a tocar, decae solo a neutral. Evita que quede "triste" fija
// por días si nada la hace cambiar de humor.
const MOOD_DECAY_MS = 8 * 60 * 60 * 1000; // 8 horas

export const VALID_MOODS = ["happy", "angry", "sad", "relaxed", "neutral"] as const;
export type Mood = (typeof VALID_MOODS)[number];
// Qué le cambió el ánimo: algo de la charla, un tacto (una reacción que
// ella decidió que la afecta), o se apagó solo con el tiempo.
export type MoodOrigin = "charla" | "tacto" | "se apagó solo";

type StoredMood = { mood: Mood; setAt: string };
type MoodLogEntry = { at: string; mood: Mood; origin: MoodOrigin };

// Última lectura, para quien necesita el ánimo al instante (la reacción al
// tacto se decide en el mismo cuadro del clic, no puede esperar al store).
let cached: StoredMood | null = null;
let decayLogged = false;

function isExpired(stored: StoredMood) {
  return Date.now() - new Date(stored.setAt).getTime() > MOOD_DECAY_MS;
}

export function getCachedMood(): Mood {
  if (!cached || isExpired(cached)) return "neutral";
  return cached.mood;
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

export async function getCurrentMood(): Promise<Mood> {
  const store = await load(".settings.dat", { autoSave: false });
  const stored = await store.get<StoredMood>(STORE_KEY);
  cached = stored ?? null;
  if (!stored) return "neutral";

  if (isExpired(stored)) {
    // Se registra una sola vez que se apagó, no en cada lectura.
    if (!decayLogged && stored.mood !== "neutral") {
      decayLogged = true;
      appendLog({ at: new Date().toISOString(), mood: "neutral", origin: "se apagó solo" });
    }
    return "neutral";
  }
  return stored.mood;
}

export async function setMood(mood: string, origin: MoodOrigin = "charla") {
  const normalized = mood.trim().toLowerCase();
  if (!(VALID_MOODS as readonly string[]).includes(normalized)) return;

  const store = await load(".settings.dat", { autoSave: false });
  const value: StoredMood = { mood: normalized as Mood, setAt: new Date().toISOString() };
  cached = value;
  decayLogged = false;
  await store.set(STORE_KEY, value);
  await store.save();
  console.log(`[Ánimo] ${normalized} (por ${origin})`);
  await appendLog({ at: value.setAt, mood: value.mood, origin });
}
