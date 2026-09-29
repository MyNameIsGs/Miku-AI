import { load } from "@tauri-apps/plugin-store";
import { MAX_HISTORY_TURNS } from "../config/constants";
import { ChatContent, ChatMessage } from "../types";
import { appendDayTurn } from "./dayLog";

// Punto 2 del plan: que no pierda el hilo si la app se cierra y se vuelve a
// abrir al rato. Se guardan los últimos turnos de la charla y, si el último
// es reciente, se restauran al abrir.
//
// Solo texto: de cada turno, lo que dijo Sebastián y la respuesta final de
// Miku -- sin imágenes (pesan y ya cumplieron su función) ni las vueltas de
// tool calling (el par assistant(tool_calls) + tool tiene que ir completo o
// la API lo rechaza; el resultado ya quedó dicho en la respuesta final).
// Local, en .settings.dat: no se sincroniza.

const STORE_KEY = "chatHistory";
// Pasado esto, la charla anterior ya no es "la de hace un rato": se empieza
// de cero, como siempre.
const RESTORE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

type SavedTurn = { user: string; assistant: string };
type SavedHistory = { savedAt: string; turns: SavedTurn[] };

// De Sebastián, solo lo que escribió o dijo: la primera parte de texto (lo
// demás son agregados de la app, como la foto de "así quedó tu cuerpo").
function userTextOf(content: ChatContent): string {
  if (typeof content === "string") return content;
  const first = content.find((part) => part.type === "text");
  return first && first.type === "text" ? first.text : "";
}

function textOf(content: ChatContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
}

function toSavedTurn(turn: ChatMessage[]): SavedTurn | null {
  const user = turn.find((m) => m.role === "user");
  const assistant = [...turn].reverse().find((m) => m.role === "assistant");
  if (!assistant) return null;
  // Sin mensaje de Sebastián: algo que ella dijo por su cuenta (ver rememberSpokenOnOwn).
  const userText = user ? userTextOf(user.content) : "";
  const assistantText = textOf(assistant.content);
  return userText || assistantText ? { user: userText, assistant: assistantText } : null;
}

export async function saveChatHistory(turns: ChatMessage[][]) {
  try {
    const saved: SavedHistory = {
      savedAt: new Date().toISOString(),
      turns: turns.map(toSavedTurn).filter((t): t is SavedTurn => t !== null),
    };
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, saved);
    await store.save();
  } catch (err) {
    console.error("Error guardando la charla:", err);
  }
}

// Los turnos de la charla anterior si es reciente, y hace cuánto fue (en
// minutos), o null.
export async function loadRecentChatHistory(): Promise<{ turns: ChatMessage[][]; minutesAgo: number } | null> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const saved = await store.get<SavedHistory>(STORE_KEY);
    if (!saved || saved.turns.length === 0) return null;
    const ageMs = Date.now() - new Date(saved.savedAt).getTime();
    if (!(ageMs >= 0 && ageMs <= RESTORE_MAX_AGE_MS)) return null;
    return {
      turns: saved.turns.map((t): ChatMessage[] =>
        t.user
          ? [
              { role: "user", content: t.user },
              { role: "assistant", content: t.assistant },
            ]
          : [{ role: "assistant", content: t.assistant }],
      ),
      minutesAgo: Math.round(ageMs / 60000),
    };
  } catch (err) {
    console.error("Error leyendo la charla guardada:", err);
    return null;
  }
}

// Los turnos guardados, aplanados a la forma que espera la API: tool_calls
// y tool_call_id pasan tal cual cuando corresponden (el grupo assistant +
// tools de un turno viaja entero, ver lib/openrouter.ts).
export function toApiMessages(turns: ChatMessage[][]): object[] {
  return turns.flat().map((m) => {
    if (m.role === "tool") return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
    if (m.role === "assistant") return { role: "assistant", content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
    return { role: "user", content: m.content };
  });
}

// Lo que dice por su cuenta (aviso de correo, de calendario, recordatorio,
// pausa de juego, saludo del día) también es parte de la charla: antes solo
// sonaba, y si Sebastián le respondía ("tranquila, fui yo"), ella no sabía
// a qué, y contestaba sobre lo último que tenía, de antes. Va como un
// mensaje suyo sin uno de él antes (probado con DeepSeek: lo acepta y lo
// entiende).
export function rememberSpokenOnOwn(historyRef: { current: ChatMessage[][] }, text: string) {
  if (!text.trim()) return;
  historyRef.current.push([{ role: "assistant", content: text }]);
  if (historyRef.current.length > MAX_HISTORY_TURNS) {
    historyRef.current = historyRef.current.slice(-MAX_HISTORY_TURNS);
  }
  saveChatHistory(historyRef.current);
  appendDayTurn("", text);
}
