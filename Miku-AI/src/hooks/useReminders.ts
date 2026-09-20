import { RefObject, useEffect } from "react";
import { registerReminderFireHandler, checkDueReminders } from "../lib/reminders/store";

type UseRemindersParams = {
  // Misma firma que speech.speak -- ya encolada (ver useSpeech.ts), así
  // que un recordatorio que vence mientras ella está hablando o pensando
  // simplemente espera su turno en vez de pisar el audio en curso.
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
};

export function useReminders({
  speak,
  voicePitchRef,
  voiceRateRef,
}: UseRemindersParams) {
  useEffect(() => {
    registerReminderFireHandler((reminder) => {
      speak(
        reminder.message,
        voicePitchRef.current,
        voiceRateRef.current,
        "neutral",
      ).catch((err) => console.error("Error al hablar un recordatorio:", err));
    });
  }, [speak, voicePitchRef, voiceRateRef]);

  // Se llama cada frame desde onBeforeRender -- es una comparación de
  // timestamps en memoria, nada de I/O, así que no hace falta throttle
  // como el intervalo de 2.5 minutos del quirk idle (que sí dispara una
  // llamada real al LLM).
  function checkReminders() {
    checkDueReminders(Date.now());
  }

  return { checkReminders };
}
