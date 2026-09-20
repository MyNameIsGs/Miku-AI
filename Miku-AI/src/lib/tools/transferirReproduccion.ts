import { ToolDefinition } from "./types";
import { transferPlayback } from "../spotify/api";

// Útil porque Spotify está integrado en más de un dispositivo en este
// proyecto (desktop y Android) -- mover la reproducción de uno a otro sin
// cortar la canción.
export const transferirReproduccion: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "transferir_reproduccion",
      description:
        "Mueve la reproducción de Spotify a otro dispositivo (por ejemplo, del celular a la PC o viceversa), sin cortar lo que esté sonando.",
      parameters: {
        type: "object",
        properties: {
          dispositivo: {
            type: "string",
            description: 'A qué dispositivo mover la reproducción, por ejemplo "PC" o "celular" -- no hace falta el nombre exacto.',
          },
        },
        required: ["dispositivo"],
      },
    },
  },
  execute: async (args) => {
    const dispositivo = String(args.dispositivo ?? "").trim();
    if (!dispositivo) {
      return "Error: no se especificó a qué dispositivo transferir la reproducción.";
    }

    try {
      const name = await transferPlayback(dispositivo);
      return `Listo, la reproducción ahora está en "${name}".`;
    } catch (err) {
      return `Error al transferir la reproducción en Spotify: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
