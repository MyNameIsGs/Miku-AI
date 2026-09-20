import { ToolDefinition } from "./types";
import { findPlaylist, playContext } from "../spotify/api";

// Reproduce una playlist completa (a diferencia de reproducir_cancion,
// que reproduce un track suelto) -- usa context_uri en vez de uris, así
// Spotify deja sonando la colección completa en orden.
export const reproducirPlaylist: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "reproducir_playlist",
      description:
        "Busca una playlist de Spotify por nombre y la pone a sonar completa (en orden) en el dispositivo de Spotify activo de Sebastián. Úsala cuando pida una playlist puntual, no una canción suelta.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: 'El nombre de la playlist a reproducir, por ejemplo "mi playlist de gym" o "lofi beats".',
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué playlist reproducir.";
    }

    try {
      const playlist = await findPlaylist(consulta);
      if (!playlist) {
        return `No encontré ninguna playlist para "${consulta}".`;
      }
      await playContext(playlist.uri);
      return `Reproduciendo la playlist "${playlist.name}"${playlist.owner ? ` de ${playlist.owner}` : ""}.`;
    } catch (err) {
      return `Error al reproducir la playlist en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
