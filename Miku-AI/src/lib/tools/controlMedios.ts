import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";

const ACCIONES = ["play_pausa", "siguiente", "anterior"] as const;

// Tarea 6.4: teclas multimedia virtuales (ver media_control.rs) --
// funcionan sobre lo que esté sonando en ese momento (Spotify, el
// navegador, lo que sea), sin necesidad de saber qué aplicación es.
export const controlMedios: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "control_medios",
      description:
        "Controla la reproducción multimedia activa en la PC de Sebastián (pausar/reanudar, siguiente o anterior pista), sin importar qué aplicación esté sonando.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "play_pausa alterna entre reproducir y pausar; siguiente y anterior cambian de pista.",
          },
        },
        required: ["accion"],
      },
    },
  },
  execute: async (args) => {
    const accion = String(args.accion ?? "");
    if (!ACCIONES.includes(accion as (typeof ACCIONES)[number])) {
      return `Error: acción de medios desconocida "${accion}".`;
    }

    try {
      await invoke("control_medios", { accion });
      return `Listo: ${accion}.`;
    } catch (err) {
      return `Error al controlar la reproducción: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
