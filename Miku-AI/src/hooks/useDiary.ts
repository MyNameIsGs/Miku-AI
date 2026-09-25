import { RefObject, useRef } from "react";
import { OPENROUTER_MODEL } from "../config/constants";
import { hasWrittenDiaryToday, markDiaryWrittenToday, appendDiaryEntry } from "../lib/diary";
import { loadMemoryContext } from "../lib/memory";
import { buildDiaryPrompt } from "../prompts/diaryPrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { ChatMessage } from "../types";

type UseDiaryParams = {
  conversationHistoryRef: RefObject<ChatMessage[][]>;
};

// Reduce el historial de turnos a un texto legible simple -- solo lo que
// se dijeron los dos, sin marcadores ni el ruido de las vueltas de tool
// calling (esas quedan afuera a propósito, no aportan nada a una
// reflexión sobre cómo se sintió el día).
function summarizeConversation(turns: ChatMessage[][]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    for (const msg of turn) {
      if (msg.role === "user") {
        const text = typeof msg.content === "string" ? msg.content : "(mensaje con imagen adjunta)";
        if (text.trim()) lines.push(`Sebastián: ${text}`);
      } else if (msg.role === "assistant" && !msg.tool_calls) {
        const text = typeof msg.content === "string" ? msg.content : "";
        if (text.trim()) lines.push(`Miku: ${text}`);
      }
    }
  }
  return lines.join("\n");
}

// Tarea 8.9: diario nocturno propio de Miku -- se llama desde
// useVoiceServer (registerBeforeSync) al cerrar la app, ANTES de
// sync_memory_to_github, para que diario.md quede incluido en ese mismo
// commit. Solo escribe si hubo actividad real en la sesión (sin eso, un
// día sin uso no genera una entrada vacía) y como mucho una vez por día
// (ver hasWrittenDiaryToday).
export function useDiary({ conversationHistoryRef }: UseDiaryParams) {
  const inFlightRef = useRef(false);

  async function maybeWriteDiaryEntry() {
    if (inFlightRef.current) return;
    if (conversationHistoryRef.current.length === 0) return;
    if (await hasWrittenDiaryToday()) return;

    inFlightRef.current = true;
    // Mismo criterio que el resto de los chequeos de fondo: se marca ANTES
    // de terminar, mejor perderse la entrada de hoy que reintentar en cada
    // cierre si algo falla.
    await markDiaryWrittenToday();

    try {
      const { personality, world, memories } = await loadMemoryContext();
      const conversationSummary = summarizeConversation(conversationHistoryRef.current);
      const prompt = buildDiaryPrompt({ world, personality, memories, conversationSummary });

      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: prompt }],
      }, { kind: "diario" });
      const data = await response.json();
      const reply: string = (data.choices?.[0]?.message?.content ?? "").trim();

      if (reply) {
        await appendDiaryEntry(reply);
      }
    } catch (err) {
      console.error("Error escribiendo el diario nocturno:", err);
    } finally {
      inFlightRef.current = false;
    }
  }

  return { maybeWriteDiaryEntry };
}
