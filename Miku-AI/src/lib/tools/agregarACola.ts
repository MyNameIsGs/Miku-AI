import { ToolDefinition } from "./types";
import { searchTracks, addToQueue } from "../spotify/api";

// Distinta de reproducir_cancion: no interrumpe lo que esté sonando, solo
// agrega la canción a continuación en la cola.
export const agregarACola: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "agregar_a_cola",
      description:
        "Busca una canción en Spotify y la agrega a la cola de reproducción, sin interrumpir lo que esté sonando ahora. Úsala cuando pida que algo suene DESPUÉS, no de inmediato -- para eso está reproducir_cancion.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: 'La canción a agregar a la cola, por ejemplo "bad apple".',
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué canción agregar a la cola.";
    }

    try {
      const tracks = await searchTracks(consulta, 1);
      if (tracks.length === 0) {
        return `No encontré ninguna canción para "${consulta}".`;
      }
      const top = tracks[0];
      await addToQueue(top.uri);
      return `Agregué "${top.name}" de ${top.artists} a la cola.`;
    } catch (err) {
      return `Error al agregar a la cola de Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
