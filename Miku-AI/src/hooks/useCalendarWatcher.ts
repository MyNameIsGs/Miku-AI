import { RefObject, useRef } from "react";
import { CALENDAR_CHECK_INTERVAL_MS } from "../config/constants";
import { checkUpcomingEvents, checkMilestoneEvents } from "../lib/calendar/watcher";
import { isQuietHours } from "../lib/quietHours";

type UseCalendarWatcherParams = {
  // "Está por empezar" sigue siendo inmediato a propósito -- es urgente
  // de verdad, meterlo en el resumen agrupado le quitaría el sentido
  // (podría avisar después de que el evento ya arrancó). Única excepción:
  // idea #20, durante el horario de no molestar tampoco habla solo -- se
  // encola igual que el resto, en vez de interrumpir de madrugada.
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
  // Los avisos de anticipación larga (semana/3 días/día anterior) NO son
  // urgentes -- van al resumen agrupado en vez de interrumpir directo.
  queueAnnouncement: (text: string) => void;
};

export function useCalendarWatcher({
  speak,
  voicePitchRef,
  voiceRateRef,
  queueAnnouncement,
}: UseCalendarWatcherParams) {
  const lastCheckRef = useRef(performance.now());
  const isCheckingRef = useRef(false);

  // Mismo patrón que checkGmail -- se llama desde onBeforeRender con el
  // "now" del frame.
  function checkCalendar(now: number) {
    if (isCheckingRef.current || now - lastCheckRef.current < CALENDAR_CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;
    isCheckingRef.current = true;

    Promise.all([checkUpcomingEvents(), checkMilestoneEvents()])
      .then(async ([imminent, milestone]) => {
        if (imminent) {
          if (isQuietHours()) {
            queueAnnouncement(imminent);
          } else {
            await speak(imminent, voicePitchRef.current, voiceRateRef.current, "neutral");
          }
        }
        if (milestone) {
          queueAnnouncement(milestone);
        }
      })
      .catch((err) => console.error("Error revisando el calendario:", err))
      .finally(() => {
        isCheckingRef.current = false;
      });
  }

  return { checkCalendar };
}
