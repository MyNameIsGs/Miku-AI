import { RefObject, useRef } from "react";
import { GMAIL_CHECK_INTERVAL_MS } from "../config/constants";
import { checkForNewMail } from "../lib/gmail/watcher";

type UseGmailWatcherParams = {
  // Misma firma que speech.speak -- ya encolada (ver useSpeech.ts), así
  // que un aviso de correo que llega mientras habla de otra cosa
  // simplemente espera su turno en vez de pisar el audio en curso. A
  // diferencia de Android (que no tiene cola y por eso tiene que saltear
  // el chequeo si hay una conversación en curso), acá no hace falta.
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
};

export function useGmailWatcher({
  speak,
  voicePitchRef,
  voiceRateRef,
}: UseGmailWatcherParams) {
  const lastCheckRef = useRef(performance.now());
  const isCheckingRef = useRef(false);

  // Se llama desde onBeforeRender con el "now" del frame -- mismo patrón
  // que checkIdleQuirk/checkReminders. isCheckingRef evita superponer dos
  // chequeos si uno tarda más que el intervalo (poco probable, pero un
  // problema de red puntual no debería acumular pedidos).
  function checkGmail(now: number) {
    if (isCheckingRef.current || now - lastCheckRef.current < GMAIL_CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;
    isCheckingRef.current = true;

    checkForNewMail()
      .then((announcement) => {
        if (announcement) {
          return speak(announcement, voicePitchRef.current, voiceRateRef.current, "neutral");
        }
      })
      .catch((err) => console.error("Error revisando correo nuevo:", err))
      .finally(() => {
        isCheckingRef.current = false;
      });
  }

  return { checkGmail };
}
