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

// "Persista horas" (pedido original), no días -- pasado esto sin que ella
// lo vuelva a tocar, decae solo a neutral. Evita que quede "triste" fija
// por días si nada la hace cambiar de humor.
const MOOD_DECAY_MS = 8 * 60 * 60 * 1000; // 8 horas

export const VALID_MOODS = ["happy", "angry", "sad", "relaxed", "neutral"] as const;
export type Mood = (typeof VALID_MOODS)[number];

type StoredMood = { mood: Mood; setAt: string };

export async function getCurrentMood(): Promise<Mood> {
  const store = await load(".settings.dat", { autoSave: false });
  const stored = await store.get<StoredMood>(STORE_KEY);
  if (!stored) return "neutral";

  const elapsedMs = Date.now() - new Date(stored.setAt).getTime();
  if (elapsedMs > MOOD_DECAY_MS) return "neutral";
  return stored.mood;
}

export async function setMood(mood: string) {
  const normalized = mood.trim().toLowerCase();
  if (!(VALID_MOODS as readonly string[]).includes(normalized)) return;

  const store = await load(".settings.dat", { autoSave: false });
  const value: StoredMood = { mood: normalized as Mood, setAt: new Date().toISOString() };
  await store.set(STORE_KEY, value);
  await store.save();
}
