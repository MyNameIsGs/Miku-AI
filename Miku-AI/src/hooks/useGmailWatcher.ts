import { useRef } from "react";
import { GMAIL_CHECK_INTERVAL_MS, OPENROUTER_MODEL } from "../config/constants";
import { checkForNewMail } from "../lib/gmail/watcher";
import { buildMailPrompt } from "../prompts/mailPrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { parseMarkers } from "../lib/markers";
import { loadMemoryContext } from "../lib/memory";

type UseGmailWatcherParams = {
  // Ya no habla directo -- correo nuevo no es urgente, se acumula en el
  // resumen agrupado (ver useNotificationDigest.ts) en vez de interrumpir
  // apenas se detecta.
  queueAnnouncement: (text: string) => void;
};

export function useGmailWatcher({ queueAnnouncement }: UseGmailWatcherParams) {
  const lastCheckRef = useRef(performance.now());
  const isCheckingRef = useRef(false);

  // Se llama desde onBeforeRender con el "now" del frame -- mismo patrón
  // que checkIdleQuirk/checkReminders. isCheckingRef evita superponer dos
  // chequeos si uno tarda más que el intervalo (poco probable, pero un
  // problema de red puntual no debería acumular pedidos).
  //
  // Idea #8 (de verdad): checkForNewMail() ya no arma un texto con
  // plantilla fija -- devuelve los candidatos crudos, y acá se le pide al
  // LLM (una sola llamada, solo cuando hay correo genuinamente nuevo, no
  // en cada chequeo) que decida en personaje si vale la pena mencionarlo y
  // con qué palabras, igual criterio que ya usa el loop idle con los
  // pendientes vencidos.
  function checkGmail(now: number) {
    if (isCheckingRef.current || now - lastCheckRef.current < GMAIL_CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;
    isCheckingRef.current = true;

    checkForNewMail()
      .then(async (candidates) => {
        if (!candidates || candidates.length === 0) return;

        const { personality, world } = await loadMemoryContext();
        const prompt = buildMailPrompt({ world, personality, candidates });
        const response = await fetchOpenRouterWithRetry({
          model: OPENROUTER_MODEL,
          messages: [{ role: "system", content: prompt }],
        });
        const data = await response.json();
        const reply: string = data.choices?.[0]?.message?.content ?? "";
        const parsed = parseMarkers(reply, 0, 0);
        if (parsed.cleanText) {
          queueAnnouncement(parsed.cleanText);
        }
      })
      .catch((err) => console.error("Error revisando correo nuevo:", err))
      .finally(() => {
        isCheckingRef.current = false;
      });
  }

  return { checkGmail };
}
