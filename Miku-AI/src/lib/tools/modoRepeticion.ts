import { ToolDefinition } from "./types";
import { setRepeat, SpotifyRepeatMode } from "../spotify/api";

const MODOS = ["cancion", "lista", "apagado"] as const;
type Modo = (typeof MODOS)[number];

const MODO_A_SPOTIFY: Record<Modo, SpotifyRepeatMode> = {
  cancion: "track",
  lista: "context",
  apagado: "off",
};

export const modoRepeticion: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "modo_repeticion",
      description:
        "Cambia el modo de repetición de Spotify: repetir solo la canción actual en loop, repetir toda la playlist/álbum, o apagar la repetición.",
      parameters: {
        type: "object",
        properties: {
          modo: {
            type: "string",
            enum: [...MODOS],
            description: '"cancion" repite el track actual en loop, "lista" repite toda la playlist/álbum, "apagado" la desactiva.',
          },
        },
        required: ["modo"],
      },
    },
  },
  execute: async (args) => {
    const modo = String(args.modo ?? "") as Modo;
    if (!MODOS.includes(modo)) {
      return `Error: modo de repetición desconocido "${modo}".`;
    }

    try {
      await setRepeat(MODO_A_SPOTIFY[modo]);
      const mensajes: Record<Modo, string> = {
        cancion: "Repitiendo la canción actual.",
        lista: "Repitiendo toda la lista.",
        apagado: "Repetición desactivada.",
      };
      return mensajes[modo];
    } catch (err) {
      return `Error al cambiar la repetición en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
