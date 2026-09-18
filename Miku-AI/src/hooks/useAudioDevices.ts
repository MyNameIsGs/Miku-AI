import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AudioOutputDevice,
  setAudioDevices,
} from "../lib/tools/audioDeviceStore";

// Tarea 6.4 (extensión): a diferencia de las apps, no hay nada que
// Sebastián tenga que curar acá (sin ocultar, sin carpetas) -- la lista es
// directamente lo que Windows reporta como dispositivos de salida activos.
// Se refresca al arrancar; si conecta/desconecta auriculares durante la
// sesión, alcanza con volver a preguntarle una vez reiniciada la app.
export function useAudioDevices() {
  useEffect(() => {
    (async () => {
      try {
        const devices = await invoke<AudioOutputDevice[]>(
          "list_audio_output_devices",
        );
        setAudioDevices(devices);
      } catch (err) {
        console.error("Error listando dispositivos de audio:", err);
      }
    })();
  }, []);
}
