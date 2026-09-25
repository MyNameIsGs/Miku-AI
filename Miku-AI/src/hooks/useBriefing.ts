import { RefObject, useRef } from "react";
import { OPENROUTER_MODEL } from "../config/constants";
import { hasGivenBriefingToday, markBriefingGivenToday } from "../lib/briefing";
import { loadMemoryContext } from "../lib/memory";
import { loadPendientes, getDuePendientes } from "../lib/pendientes";
import { listUpcomingEventsAllAccounts } from "../lib/calendar/api";
import { listRecentMessagesAllAccounts } from "../lib/gmail/api";
import { buildBriefingPrompt } from "../prompts/briefingPrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { isStreamModeActive } from "../lib/streamMode";

type UseBriefingParams = {
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
};

// Tarea 8.7: briefing automático al sentarse -- la primera vez que
// Sebastián interactúa de verdad en el día (ver App.tsx, se llama desde el
// arranque de askMiku), junta calendario + correo + pendientes SIN pasar
// por tool calling (más rápido, un solo POST) y deja que Miku arme un
// único mensaje hablado, en vez de que cada aviso llegue por separado.
// Reusa la cola de speak() ya existente -- este mensaje queda encolado
// ANTES que la respuesta real a lo que haya dicho, así que se escucha
// primero.
export function useBriefing({ speak, voicePitchRef, voiceRateRef }: UseBriefingParams) {
  const inFlightRef = useRef(false);

  async function maybeGiveBriefing() {
    if (inFlightRef.current) return;
    // Tarea 8.3: en pleno stream no se leen correos ni eventos en voz alta
    // -- se posterga (sin marcarlo como dado) hasta la primera interacción
    // después de que termine.
    if (isStreamModeActive()) return;
    if (await hasGivenBriefingToday()) return;

    inFlightRef.current = true;
    // Se marca ANTES de terminar de armar el mensaje -- si algo falla a
    // mitad de camino, mejor perderse el briefing de hoy que reintentarlo
    // en cada mensaje siguiente (mismo criterio que el resto de los
    // watchers de fondo: fallar en silencio, no insistir).
    await markBriefingGivenToday();

    try {
      const [events, mails, allPendientes] = await Promise.all([
        listUpcomingEventsAllAccounts(7, 15).catch(() => []),
        listRecentMessagesAllAccounts(15, 3).catch(() => []),
        loadPendientes().catch(() => []),
      ]);
      const duePendientes = getDuePendientes(allPendientes);

      const { personality, world } = await loadMemoryContext();
      const prompt = buildBriefingPrompt({
        world,
        personality,
        events,
        mails,
        pendientes: duePendientes,
      });

      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: prompt }],
      }, { kind: "briefing" });
      const data = await response.json();
      const reply: string = (data.choices?.[0]?.message?.content ?? "").trim();

      if (reply) {
        await speak(reply, voicePitchRef.current, voiceRateRef.current, "neutral");
      }
    } catch (err) {
      console.error("Error armando el briefing automático:", err);
    } finally {
      inFlightRef.current = false;
    }
  }

  return { maybeGiveBriefing };
}
