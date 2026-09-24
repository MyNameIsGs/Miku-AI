import { useEffect, useRef, useState } from "react";
import { isGameModeActive } from "../lib/gameMode";

const VAD_POLL_URL = "http://127.0.0.1:8899/vad/poll";
const VAD_ENABLED_URL = "http://127.0.0.1:8899/vad/enabled";
const POLL_INTERVAL_MS = 150;

// Tarea 8.1: cuánto dura la ventana de "seguimiento" tras una respuesta
// real -- durante ese rato, hablar no necesita repetir "Hey Miku", se
// vuelve a escuchar directo. Sin calibrar contra uso real todavía.
const FOLLOW_UP_WINDOW_MS = 5000;

type UseVoiceActivityDetectionParams = {
  isVoiceReady: boolean;
  // true mientras se está grabando (botón de mic o wake-word ya activo) --
  // en ese modo, VAD busca SILENCIO sostenido para cortar sola.
  listening: boolean;
  // true mientras suena el audio de una respuesta -- en ese modo (y
  // durante la ventana de seguimiento, ver armFollowUpWindow), VAD busca
  // VOZ sostenida para saber que Sebastián quiere hablar.
  isSpeaking: boolean;
  // Silencio sostenido detectado mientras se grababa -- reemplaza soltar
  // el botón de mic a mano.
  onAutoStopRecording: () => void;
  // Voz sostenida detectada mientras Miku hablaba (barge-in real) o
  // durante la ventana de seguimiento tras su respuesta (sin repetir
  // "Hey Miku"). Quien llama decide qué hacer en cada caso -- acá solo se
  // avisa que "Sebastián empezó a hablar ahora".
  onSpeechDuringPlayback: () => void;
};

// Tarea 8.1: "voz sin manos de verdad" -- las tres piezas del VAD
// (auto-stop de grabación, barge-in, ventana de seguimiento) comparten el
// mismo detector de voz del lado de voice_server.py (Silero VAD, corriendo
// en el mismo stream de audio que ya tiene abierto el wake-word -- son
// modos mutuamente excluyentes del mismo hilo, nunca compiten). Este hook
// es el único responsable de prender/apagar ese detector según haga falta,
// y de traducir sus dos contadores (silenceId, speechStartId) en eventos.
export function useVoiceActivityDetection({
  isVoiceReady,
  listening,
  isSpeaking,
  onAutoStopRecording,
  onSpeechDuringPlayback,
}: UseVoiceActivityDetectionParams) {
  const [followUpActive, setFollowUpActive] = useState(false);
  const followUpTimeoutRef = useRef<number | null>(null);

  const lastSilenceIdRef = useRef<number | null>(null);
  const lastSpeechStartIdRef = useRef<number | null>(null);

  // En modo juego no se escucha "voz" mientras habla ni en la ventana de
  // seguimiento: el VAD no distingue la voz de Sebastián de una frase del
  // juego por los parlantes (en vivo, una del cliente de LoL calló a Miku a
  // mitad de respuesta y la puso a escuchar). Ahí, a Miku se le habla con
  // "Hey Miku", que tiene su propio modelo. isGameModeActive() se lee en
  // cada render: App se vuelve a dibujar cuando cambia el modo juego.
  const mode: "off" | "recording" | "speech_onset" = listening
    ? "recording"
    : (isSpeaking || followUpActive) && !isGameModeActive()
      ? "speech_onset"
      : "off";

  const stateRef = useRef({ mode, onAutoStopRecording, onSpeechDuringPlayback });
  useEffect(() => {
    stateRef.current = { mode, onAutoStopRecording, onSpeechDuringPlayback };
  }, [mode, onAutoStopRecording, onSpeechDuringPlayback]);

  function armFollowUpWindow() {
    if (followUpTimeoutRef.current) window.clearTimeout(followUpTimeoutRef.current);
    setFollowUpActive(true);
    followUpTimeoutRef.current = window.setTimeout(() => {
      setFollowUpActive(false);
      followUpTimeoutRef.current = null;
    }, FOLLOW_UP_WINDOW_MS);
  }

  // Si arranca a grabar por cualquier vía (wake-word, botón, o la propia
  // ventana de seguimiento) antes de que expire sola, la ventana ya
  // cumplió su propósito -- se corta, para no seguir "escuchando de más"
  // una vez que ya hay una grabación en curso.
  useEffect(() => {
    if (listening && followUpTimeoutRef.current) {
      window.clearTimeout(followUpTimeoutRef.current);
      followUpTimeoutRef.current = null;
      setFollowUpActive(false);
    }
  }, [listening]);

  // Prende/apaga el detector en el servidor según el modo actual -- nunca
  // corre en paralelo con nada más (ver el comentario largo arriba).
  useEffect(() => {
    if (!isVoiceReady) return;
    fetch(VAD_ENABLED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: mode !== "off" }),
    }).catch(() => {});
  }, [isVoiceReady, mode]);

  useEffect(() => {
    if (!isVoiceReady) return;

    const pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(VAD_POLL_URL);
        if (!res.ok) return;
        const data: { speechStartId: number; silenceId: number } = await res.json();

        if (lastSilenceIdRef.current === null) {
          // Primer poll: solo establece la base, no dispara nada -- mismo
          // criterio que useWakeWord.ts.
          lastSilenceIdRef.current = data.silenceId;
          lastSpeechStartIdRef.current = data.speechStartId;
          return;
        }

        const { mode, onAutoStopRecording, onSpeechDuringPlayback } = stateRef.current;

        if (mode === "recording" && data.silenceId !== lastSilenceIdRef.current) {
          onAutoStopRecording();
        }
        if (mode === "speech_onset" && data.speechStartId !== lastSpeechStartIdRef.current) {
          onSpeechDuringPlayback();
        }

        lastSilenceIdRef.current = data.silenceId;
        lastSpeechStartIdRef.current = data.speechStartId;
      } catch {
        // El servidor de voz puede estar reiniciándose; se reintenta en el próximo poll.
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(pollTimer);
  }, [isVoiceReady]);

  return { armFollowUpWindow };
}
