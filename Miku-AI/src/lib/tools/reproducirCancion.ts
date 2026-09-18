import { ToolDefinition } from "./types";
import { searchTracks, playTrack } from "../spotify/api";

// El valor nuevo sobre control_medios (Tarea 6.4, teclas multimedia): esa
// tool controla lo que YA está sonando, esta busca y arranca una canción
// puntual por nombre.
export const reproducirCancion: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "reproducir_cancion",
      description:
        "Busca una canción en Spotify por nombre/artista y la pone a sonar de inmediato en el dispositivo de Spotify activo de Sebastián (necesita tener Spotify abierto en algún lado, sea la app de escritorio, el teléfono o el navegador). Úsala cuando pida escuchar algo puntual, no solo buscar información.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: 'La canción a reproducir, por ejemplo "bad apple" o "melt de Kikuo".',
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué reproducir.";
    }

    try {
      const tracks = await searchTracks(consulta, 1);
      if (tracks.length === 0) {
        return `No encontré ninguna canción para "${consulta}".`;
      }
      const top = tracks[0];
      await playTrack(top.uri);
      return `Reproduciendo "${top.name}" de ${top.artists}.`;
    } catch (err) {
      return `Error al reproducir en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
