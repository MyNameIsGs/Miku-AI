import { ToolDefinition } from "./types";
import { searchTracks } from "../spotify/api";

// Distinta de reproducir_cancion: solo busca y devuelve opciones, no pone
// nada a sonar. Para cuando Sebastián quiere saber qué hay antes de elegir.
export const buscarCancion: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "buscar_cancion",
      description:
        "Busca canciones en Spotify por nombre, artista, o ambos, sin reproducir nada. Úsala cuando Sebastián quiera saber qué opciones hay antes de elegir una, no cuando ya sepa qué quiere escuchar.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: 'Qué buscar, por ejemplo "bad apple" o "canciones de Kikuo".',
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué buscar.";
    }

    try {
      const tracks = await searchTracks(consulta, 5);
      if (tracks.length === 0) {
        return `No encontré ninguna canción para "${consulta}".`;
      }
      return tracks.map((t) => `${t.name} - ${t.artists}`).join("\n");
    } catch (err) {
      return `Error al buscar en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
