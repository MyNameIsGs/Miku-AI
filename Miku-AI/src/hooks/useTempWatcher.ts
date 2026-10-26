import { RefObject, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { evaluateTemps, initialTempWatchState, Temperatures } from "../lib/hardwareTemps";
import { flashLights } from "../lib/lights";

type UseTempWatcherParams = {
  // Como "evento por empezar", esto es urgente: va directo a speak, no al
  // resumen agrupado. Y a diferencia de ese, tampoco se calla en modo
  // juego, stream ni de madrugada -- jugando es justo cuando más se calienta.
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
  // Mientras la voz arranca, speak no suena y el aviso se perdería (ya
  // quedaría marcado como dicho): las lecturas se ignoran hasta entonces.
  isVoiceReady: boolean;
};

// Las lecturas llegan cada 10 s como evento desde Rust (ver
// src-tauri/src/hardware_temps.rs: no se usa onBeforeRender porque en modo
// juego la ventana está escondida y el render se detiene).
export function useTempWatcher({ speak, voicePitchRef, voiceRateRef, isVoiceReady }: UseTempWatcherParams) {
  const stateRef = useRef(initialTempWatchState());
  // El listener se registra una sola vez; speak y la voz cambian en cada render.
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const readyRef = useRef(isVoiceReady);
  readyRef.current = isVoiceReady;

  useEffect(() => {
    const unlisten = listen<Temperatures>("temperaturas", async (event) => {
      if (!readyRef.current) return;
      const { state, messages } = evaluateTemps(stateRef.current, event.payload, Date.now());
      stateRef.current = state;
      for (const text of messages) {
        flashLights();
        await speakRef.current(text, voicePitchRef.current, voiceRateRef.current, "neutral").catch((err) =>
          console.error("Error avisando de la temperatura:", err),
        );
      }
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, [voicePitchRef, voiceRateRef]);
}
