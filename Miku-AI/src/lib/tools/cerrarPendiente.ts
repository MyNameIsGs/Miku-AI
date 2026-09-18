import { ToolDefinition } from "./types";
import { closePendienteByDescripcion } from "../pendientes";

// Tarea 6.7, Nivel 1: cierra un pendiente cuando Sebastián confirma que ya
// pasó o se resolvió. Busca por coincidencia parcial de texto, no por id
// -- Miku nunca ve ids opacos, ve descripciones (ver systemPrompt.ts).
export const cerrarPendiente: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "cerrar_pendiente",
      description:
        "Marca un pendiente como resuelto. Úsala cuando Sebastián te diga que algo que le habías recordado ya pasó, llegó, o se cumplió.",
      parameters: {
        type: "object",
        properties: {
          descripcion: {
            type: "string",
            description:
              "Cómo describir el pendiente a cerrar, aunque no sea exacto -- se busca por coincidencia parcial entre los pendientes activos.",
          },
        },
        required: ["descripcion"],
      },
    },
  },
  execute: async (args) => {
    const query = String(args.descripcion ?? "").trim();
    if (!query) {
      return "Error: no se especificó qué pendiente cerrar.";
    }

    try {
      const closed = await closePendienteByDescripcion(query);
      if (!closed) {
        return `No encontré un pendiente activo que coincida con "${query}".`;
      }
      return `Cerrado: "${closed.descripcion}".`;
    } catch (err) {
      return `Error cerrando el pendiente: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
