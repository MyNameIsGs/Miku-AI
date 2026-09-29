import { localIsoDate } from "./dates";

// Diario a hora fija (2026-09-29, pedido de Sebastián). Antes se escribía
// al cerrar la app, y casi nunca pasaba: apagar la PC con ella abierta no
// la "cierra". Ahora lo escribe a las DIARY_HOUR; si a esa hora no estaba
// abierta, lo escribe al abrirse al día siguiente con la fecha que le
// tocaba. Un "día" del diario va de las DIARY_HOUR de la noche anterior a
// las DIARY_HOUR de ese día: lo que se habla a las 23:30 entra en el de
// mañana, no se pierde.
//
// Todo lo de acá es puro (sin Tauri), para poder probarlo.

export const DIARY_HOUR = 23;

// Charla de la PC (ver dayLog.ts), voz del celular (voice_history.json) y
// cambios de ánimo (moodLog en mood.ts), con su hora.
export type DayTurn = { at: number; user: string; assistant: string };
export type PhoneVoiceEntry = { heard: string; reply: string; timestampMs: number };
export type DayMoodChange = { at: number; mood: string; origin: string; level?: string; source?: string };

function atHour(date: string, hour: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

// [desde, hasta) del día del diario `date`, en ms.
export function diaryWindow(date: string): { from: number; to: number } {
  return { from: atHour(shiftDate(date, -1), DIARY_HOUR), to: atHour(date, DIARY_HOUR) };
}

// Qué día le toca escribir ahora, o null. Hoy, si ya pasó la hora; si no,
// ayer, si esa noche no lo escribió (la PC estaba apagada). Más atrás no:
// un diario de hace tres días escrito de golpe no sería una reflexión.
export function pendingDiaryDate(now: Date, lastDiaryDate: string | null): string | null {
  const today = localIsoDate(now);
  const yesterday = shiftDate(today, -1);
  const last = lastDiaryDate ?? "";
  if (now.getTime() >= atHour(today, DIARY_HOUR)) return last >= today ? null : today;
  return last >= yesterday ? null : yesterday;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const MOOD_WORDS: Record<string, string> = {
  happy: "contenta",
  sad: "triste",
  angry: "enojada",
  relaxed: "tranquila",
  neutral: "normal",
};

function describeMoodChange(change: DayMoodChange): string {
  // `level` ya viene en palabras ("un poco contenta", ver describeMood);
  // los registros viejos no lo tienen.
  const level = change.level && change.level !== "neutral" ? change.level : (MOOD_WORDS[change.mood] ?? change.mood);
  if (change.origin === "se apagó solo") return `${hhmm(change.at)} — se te pasó, quedaste ${level}`;
  const why = change.origin === "tacto" ? "por un toque" : "por la charla";
  return `${hhmm(change.at)} — ${level}, ${why}`;
}

export type DaySummary = { pc: string; phone: string; mood: string; hasActivity: boolean };

// Lo del día, en texto para el prompt. Cada mensaje se recorta: es para
// acordarse de qué se habló, no para releerlo entero.
export function summarizeDay(
  date: string,
  turns: DayTurn[],
  phone: PhoneVoiceEntry[],
  moods: DayMoodChange[],
): DaySummary {
  const { from, to } = diaryWindow(date);
  const inDay = (at: number) => at >= from && at < to;

  const pcLines = turns
    .filter((t) => inDay(t.at))
    .flatMap((t) => [
      ...(t.user.trim() ? [`[${hhmm(t.at)}] Sebastián: ${clip(t.user.trim(), 400)}`] : []),
      ...(t.assistant.trim() ? [`Miku: ${clip(t.assistant.trim(), 400)}`] : []),
    ]);
  const phoneLines = phone
    .filter((e) => inDay(e.timestampMs))
    .flatMap((e) => [`[${hhmm(e.timestampMs)}] Sebastián: ${clip(e.heard.trim(), 400)}`, `Miku: ${clip(e.reply.trim(), 400)}`]);
  const moodLines = moods.filter((m) => inDay(m.at)).slice(-30).map(describeMoodChange);

  return {
    pc: pcLines.join("\n"),
    phone: phoneLines.join("\n"),
    mood: moodLines.join("\n"),
    hasActivity: pcLines.length + phoneLines.length + moodLines.length > 0,
  };
}
