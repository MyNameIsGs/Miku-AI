import { RefObject, useRef } from "react";
import { NOTIFICATION_DIGEST_INTERVAL_MS } from "../config/constants";
import { isQuietHours } from "../lib/quietHours";

// Resumen agrupado: correo nuevo, avisos de Calendar de anticipación
// larga, y (idea #21) pendientes vencidos que el loop idle decide sacar a
// colación, no son urgentes -- en vez de interrumpir apenas se detectan
// (como hacía antes cada mecanismo por separado), se acumulan acá y se
// leen juntos cada NOTIFICATION_DIGEST_INTERVAL_MS. El aviso de "evento
// por empezar" es la excepción a propósito: sigue yendo directo a
// speech.speak(), no pasa por acá -- ver useCalendarWatcher.ts.
type UseNotificationDigestParams = {
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
};

export function useNotificationDigest({
  speak,
  voicePitchRef,
  voiceRateRef,
}: UseNotificationDigestParams) {
  const pendingRef = useRef<string[]>([]);
  const lastFlushRef = useRef(performance.now());

  function queueAnnouncement(text: string) {
    pendingRef.current.push(text);
  }

  // Se llama desde onBeforeRender con el "now" del frame -- mismo patrón
  // que los demás chequeos periódicos.
  function checkDigest(now: number) {
    if (now - lastFlushRef.current < NOTIFICATION_DIGEST_INTERVAL_MS) return;
    // Idea #20: durante el horario de no molestar no se lee nada -- se
    // sigue acumulando (no se toca lastFlushRef) para leerlo todo junto
    // apenas termine la franja.
    if (isQuietHours()) return;
    lastFlushRef.current = now;

    if (pendingRef.current.length === 0) return;
    const items = pendingRef.current;
    pendingRef.current = [];

    const text =
      items.length === 1
        ? items[0]
        : `Te cuento un par de cosas. ${items.join(" ")}`;
    speak(text, voicePitchRef.current, voiceRateRef.current, "neutral").catch((err) =>
      console.error("Error leyendo el resumen agrupado:", err),
    );
  }

  return { queueAnnouncement, checkDigest };
}
