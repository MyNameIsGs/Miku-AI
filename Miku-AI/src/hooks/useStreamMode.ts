import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { setStreamModeActive } from "../lib/streamMode";

const OBS_POLL_INTERVAL_MS = 5000;

type ObsStatus = { streaming: boolean; recording: boolean };

export type StreamModeStatus = {
  active: boolean;
  // null = OBS respondió; si no, por qué no se pudo saber (OBS cerrado,
  // WebSocket desactivado, contraseña mal) -- se muestra en ajustes.
  obsError: string | null;
  streaming: boolean;
  recording: boolean;
};

// Tarea 8.3: modo stream automático -- le pregunta a OBS cada pocos
// segundos si está transmitiendo o grabando (obs_estado, ver
// obs_status.rs) y activa/desactiva el modo stream (lib/streamMode.ts)
// sin que Sebastián tenga que tocar nada. Si OBS no responde (cerrado, o
// con el WebSocket apagado), el modo queda desactivado: sin OBS abierto no
// hay stream posible.
export function useStreamMode() {
  const [status, setStatus] = useState<StreamModeStatus>({
    active: false,
    obsError: null,
    streaming: false,
    recording: false,
  });

  useEffect(() => {
    let cancelled = false;
    let wasActive = false;

    async function poll() {
      let next: StreamModeStatus;
      try {
        const obs = await invoke<ObsStatus>("obs_estado");
        next = {
          active: obs.streaming || obs.recording,
          obsError: null,
          streaming: obs.streaming,
          recording: obs.recording,
        };
      } catch (err) {
        next = { active: false, obsError: String(err), streaming: false, recording: false };
      }
      if (cancelled) return;

      setStreamModeActive(next.active);
      if (next.active !== wasActive) {
        console.log(`[Modo stream] ${next.active ? "activado" : "desactivado"}`);
        wasActive = next.active;
      }
      setStatus(next);
    }

    poll();
    const id = setInterval(poll, OBS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
