import { load } from "@tauri-apps/plugin-store";
import { ChatContent, ChatMessage } from "../types";

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
  if (!user || !assistant) return null;
  const userText = userTextOf(user.content);
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
      turns: saved.turns.map((t) => [
        { role: "user", content: t.user },
        { role: "assistant", content: t.assistant },
      ]),
      minutesAgo: Math.round(ageMs / 60000),
    };
  } catch (err) {
    console.error("Error leyendo la charla guardada:", err);
    return null;
  }
}
