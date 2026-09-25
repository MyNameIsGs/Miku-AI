import { load } from "@tauri-apps/plugin-store";

// A6 del plan (idea de Sebastián): charla corta. El largo de cada
// respuesta lo decide ella según lo que tiene que decir (ver la guía en
// systemPrompt.ts); acá solo se le avisa si él la cortó con ⏹.
//
// También queda un registro local, para comparar antes y después con
// datos: largo de cada respuesta y si la cortaron. En .settings.dat
// (local, no se sincroniza), los últimos 500.

type Interruption = "botón" | "mensaje";

type ReplyRecord = {
  at: string;
  words: number;
  userWords: number;
  interrupted: Interruption | null;
  // Cuánto de la respuesta alcanzó a sonar cuando la cortaron (0-100).
  heardPct: number | null;
};

const LOG_KEY = "talkLog";
const LOG_MAX = 500;

// Una respuesta de la charla en curso. Puede haber dos a la vez: si él
// escribe mientras ella sigue hablando, la nueva se arma mientras la
// anterior todavía suena; cada una se registra al terminar la suya.
export type LiveReply = {
  record: ReplyRecord;
  // Empezó a sonar de verdad (no mientras espera en la cola detrás de otro audio).
  revealing: boolean;
  revealedChars: number;
  totalChars: number;
  done: boolean;
};

let current: LiveReply | null = null;

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function beginReply(reply: string, userMessage: string): LiveReply {
  current = {
    record: {
      at: new Date().toISOString(),
      words: countWords(reply),
      userWords: countWords(userMessage),
      interrupted: null,
      heardPct: null,
    },
    revealing: false,
    revealedChars: 0,
    totalChars: reply.length,
    done: false,
  };
  return current;
}

export function noteRevealProgress(live: LiveReply, partial: string) {
  if (live.done) return;
  live.revealing = true;
  live.revealedChars = partial.length;
}

// Llamar ANTES de cortar el audio: al cortarlo, se revela el texto entero.
// Solo cuenta si lo que estaba sonando era la respuesta de la charla.
export function noteInterruption(how: Interruption) {
  const live = current;
  if (!live || live.done || !live.revealing || live.record.interrupted) return;
  live.record.interrupted = how;
  live.record.heardPct = live.totalChars > 0 ? Math.round((live.revealedChars / live.totalChars) * 100) : null;
}

export async function endReply(live: LiveReply) {
  if (live.done) return;
  live.done = true;
  const record = live.record;
  console.log(
    `[Charla] respuesta de ${record.words} ${record.words === 1 ? "palabra" : "palabras"} (a un mensaje de ${record.userWords})${
      record.interrupted ? `; cortada por ${record.interrupted} al ${record.heardPct ?? "?"} %` : ""
    }`,
  );
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const log = (await store.get<ReplyRecord[]>(LOG_KEY)) ?? [];
    log.push(record);
    await store.set(LOG_KEY, log.slice(-LOG_MAX));
    await store.save();
  } catch (err) {
    console.error("Error guardando el registro de la charla:", err);
  }
}

// Para el prompt del turno nuevo: solo si él la cortó con ⏹ en la
// respuesta anterior (un hecho concreto, no un patrón de largo). El largo
// lo decide ella según lo que tiene que decir (pedido de Sebastián): no se
// le pasan conteos de palabras. Si él escribió mientras ella seguía
// hablando, queda en el registro local pero no se le dice.
export function takeTalkSignals(): string | null {
  noteInterruption("mensaje");
  const last = current?.record;
  if (!last || last.interrupted !== "botón") return null;
  const pct = last.heardPct !== null ? `, cuando ibas por el ${last.heardPct} % de lo que decías` : "";
  return `En tu respuesta anterior, Sebastián apretó el botón para cortarte${pct}.`;
}
