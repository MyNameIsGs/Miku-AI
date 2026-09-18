import { useEffect, useRef } from "react";

const WAKE_WORD_POLL_URL = "http://127.0.0.1:8899/wake-word/poll";
const WAKE_WORD_ENABLED_URL = "http://127.0.0.1:8899/wake-word/enabled";
const POLL_INTERVAL_MS = 350;

type UseWakeWordParams = {
  isVoiceReady: boolean;
  listening: boolean;
  transcribing: boolean;
  isThinking: boolean;
  toggleListening: () => void;
};

// Tarea 5.4: la detección de "Hey Miku" corre en voice_server.py (Python,
// nanowakeword) porque el motor de Rust (livekit-wakeword + tract) daba
// resultados incorrectos con este modelo -- ver la investigación en el
// historial de la tarea. El frontend hace polling sobre un contador que se
// incrementa cada detección, mismo patrón que useVoiceServer.ts ya usa para
// saber cuándo el servidor de voz está listo.
export function useWakeWord({
  isVoiceReady,
  listening,
  transcribing,
  isThinking,
  toggleListening,
}: UseWakeWordParams) {
  const lastDetectionIdRef = useRef<number | null>(null);
  const stateRef = useRef({ listening, transcribing, isThinking, toggleListening });

  useEffect(() => {
    stateRef.current = { listening, transcribing, isThinking, toggleListening };
  }, [listening, transcribing, isThinking, toggleListening]);

  useEffect(() => {
    if (!isVoiceReady) return;

    let cancelled = false;

    const pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(WAKE_WORD_POLL_URL);
        if (!res.ok) return;
        const data: { detectionId: number } = await res.json();

        if (lastDetectionIdRef.current === null) {
          // Primer poll: solo establece la base, no dispara nada -- evita
          // reaccionar a una detección vieja de antes de que la UI cargara.
          lastDetectionIdRef.current = data.detectionId;
          return;
        }

        if (data.detectionId !== lastDetectionIdRef.current) {
          lastDetectionIdRef.current = data.detectionId;
          const { listening, transcribing, isThinking, toggleListening } = stateRef.current;
          if (!listening && !transcribing && !isThinking) {
            toggleListening();
          }
        }
      } catch {
        // El servidor de voz puede estar reiniciándose; se reintenta en el próximo poll.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      void cancelled;
    };
  }, [isVoiceReady]);

  // Mientras se está grabando, transcribiendo o pensando, no tiene sentido
  // seguir evaluando el micrófono para el wake word -- y evita que el propio
  // audio de la conversación dispare una detección encima de otra.
  useEffect(() => {
    if (!isVoiceReady) return;
    const shouldListen = !listening && !transcribing && !isThinking;
    fetch(WAKE_WORD_ENABLED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: shouldListen }),
    }).catch(() => {});
  }, [isVoiceReady, listening, transcribing, isThinking]);
}
