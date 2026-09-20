import { ToolDefinition } from "./types";
import { searchAlbums, playContext } from "../spotify/api";

// Mismo mecanismo que reproducir_playlist (context_uri), para álbumes
// completos.
export const reproducirAlbum: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "reproducir_album",
      description:
        "Busca un álbum de Spotify por nombre/artista y lo pone a sonar completo (en orden) en el dispositivo de Spotify activo de Sebastián. Úsala cuando pida un álbum puntual, no una canción suelta.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: 'El álbum a reproducir, por ejemplo "the dark side of the moon" o "melancolía de Kikuo".',
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué álbum reproducir.";
    }

    try {
      const albums = await searchAlbums(consulta, 1);
      if (albums.length === 0) {
        return `No encontré ningún álbum para "${consulta}".`;
      }
      const top = albums[0];
      await playContext(top.uri);
      return `Reproduciendo el álbum "${top.name}" de ${top.artists}.`;
    } catch (err) {
      return `Error al reproducir el álbum en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
