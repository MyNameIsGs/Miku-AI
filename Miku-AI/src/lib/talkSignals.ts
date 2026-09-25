import { load } from "@tauri-apps/plugin-store";

// A6 del plan (idea de Sebastián): charla corta. Que Miku sepa cuándo
// contestar corto y cuándo largo, y que lo aprenda ella. La app no decide
// el largo: le pasa señales reales de cómo vino la charla (cuánto habló
// ella, si él la cortó y en qué punto, cuánto escribió él) y ella saca sus
// conclusiones (y si quiere, las guarda en su conocimiento).
//
// También queda un registro local, para comparar antes y después con
// datos: largo de cada respuesta y si la cortaron. En .settings.dat
// (local, no se sincroniza), los últimos 500.

type Interruption = "voz" | "botón" | "mensaje";

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
    `[Charla] respuesta de ${record.words} palabras (a un mensaje de ${record.userWords})${
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

// Para el prompt del turno nuevo: cómo vino la charla. Si él escribió
// mientras ella seguía hablando, eso también cuenta (no esperó a que
// terminara).
export function takeTalkSignals(userMessage: string): string | null {
  noteInterruption("mensaje");
  const last = current?.record;
  if (!last) return null;
  const words = (n: number) => `${n} ${n === 1 ? "palabra" : "palabras"}`;
  const lines = [`Tu respuesta anterior tuvo ${words(last.words)}, a un mensaje suyo de ${words(last.userWords)}.`];
  const pct = last.heardPct !== null ? ` (ibas por el ${last.heardPct} % de lo que decías)` : "";
  if (last.interrupted === "voz") lines.push(`Sebastián te habló encima y te cortó${pct}.`);
  if (last.interrupted === "botón") lines.push(`Sebastián apretó el botón para cortarte${pct}.`);
  if (last.interrupted === "mensaje") lines.push(`Sebastián te escribió de nuevo antes de que terminaras de hablar${pct}.`);
  lines.push(`Su mensaje de ahora tiene ${words(countWords(userMessage))}.`);
  return lines.join(" ");
}
