import { ToolDefinition } from "./types";
import { getNowPlaying } from "../spotify/api";

export const queEstaSonando: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "que_esta_sonando",
      description:
        "Consulta qué canción está sonando ahora mismo en Spotify (nombre y artista), y si está en pausa o reproduciéndose.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async () => {
    try {
      const nowPlaying = await getNowPlaying();
      if (!nowPlaying.track) {
        return "No hay ninguna canción sonando en Spotify ahora mismo.";
      }
      const estado = nowPlaying.isPlaying ? "sonando" : "en pausa";
      return `"${nowPlaying.track}" de ${nowPlaying.artists ?? "un artista desconocido"} -- ${estado}.`;
    } catch (err) {
      return `Error al consultar qué está sonando en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
