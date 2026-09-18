import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { getAudioDevices } from "./audioDeviceStore";

// Tarea 6.4 (extensión): cambia el dispositivo de salida de audio
// predeterminado de Windows. El schema se arma de nuevo en cada request
// (mismo patrón que abrir_aplicacion) para que la lista de dispositivos
// disponibles esté siempre actualizada y el LLM haga el emparejamiento por
// nombre él solo.
export function buildCambiarSalidaAudioTool(): ToolDefinition {
  const devices = getAudioDevices();
  const deviceNames = devices.map((d) => d.name).join(", ");

  return {
    schema: {
      type: "function",
      function: {
        name: "cambiar_salida_audio",
        description:
          devices.length > 0
            ? `Cambia el dispositivo de salida de audio predeterminado de Windows (a qué parlantes o auriculares suena todo). Dispositivos disponibles ahora mismo: ${deviceNames}. Elige el más parecido a lo que pide Sebastián. Si ninguno se parece, no llames a esta herramienta.`
            : "Cambia el dispositivo de salida de audio predeterminado de Windows. Ahora mismo no hay ningún dispositivo detectado -- no llames a esta herramienta.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description:
                "Nombre exacto del dispositivo, tal como aparece en la lista de disponibles.",
            },
          },
          required: ["nombre"],
        },
      },
    },
    execute: async (args) => {
      const nombre = String(args.nombre ?? "").trim();
      const device = getAudioDevices().find(
        (d) => d.name.toLowerCase() === nombre.toLowerCase(),
      );
      if (!device) {
        return `No encontré un dispositivo de audio llamado "${nombre}".`;
      }

      try {
        await invoke("set_default_audio_output", { deviceId: device.id });
        return `Cambié la salida de audio a "${device.name}".`;
      } catch (err) {
        return `Error al cambiar la salida de audio: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    },
  };
}
