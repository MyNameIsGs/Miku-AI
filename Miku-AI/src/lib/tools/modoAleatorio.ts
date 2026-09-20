import { ToolDefinition } from "./types";
import { setShuffle } from "../spotify/api";

export const modoAleatorio: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "modo_aleatorio",
      description:
        "Activa o desactiva el modo aleatorio de Spotify para lo que esté sonando ahora (una playlist, un álbum, etc.). Reproducir algo no lo pone en aleatorio por sí solo -- si Sebastián lo pide combinado con una playlist, usa esta tool además de reproducir_playlist.",
      parameters: {
        type: "object",
        properties: {
          activar: {
            type: "boolean",
            description: "true para activar el modo aleatorio, false para desactivarlo.",
          },
        },
        required: ["activar"],
      },
    },
  },
  execute: async (args) => {
    const activar = Boolean(args.activar);
    try {
      await setShuffle(activar);
      return activar ? "Modo aleatorio activado." : "Modo aleatorio desactivado.";
    } catch (err) {
      return `Error al cambiar el modo aleatorio en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
