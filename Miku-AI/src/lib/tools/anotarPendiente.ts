import { ToolDefinition } from "./types";
import { addPendiente } from "../pendientes";

// Tarea 6.7, Nivel 1: Sebastián le cuenta algo que va a pasar y ella lo
// guarda con fecha estimada -- distinto de GUARDAR_MEMORIA (prosa sin
// vencimiento) porque esto necesita poder compararse con "hoy" más
// adelante (ver getDuePendientes en lib/pendientes.ts).
export const anotarPendiente: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "anotar_pendiente",
      description:
        "Guarda algo que Sebastián contó que va a pasar en el futuro (un pedido en camino, una cita, algo pendiente de hacer) para poder recordárselo por tu cuenta más adelante. No la uses para cosas ya pasadas o sin ninguna fecha en mente -- para eso está guardar en tu memoria normal.",
      parameters: {
        type: "object",
        properties: {
          descripcion: {
            type: "string",
            description:
              "Qué es el pendiente, en pocas palabras (ej. 'sabores nuevos de Gamersupps en camino').",
          },
          fecha_estimada: {
            type: "string",
            description:
              "Fecha estimada en formato YYYY-MM-DD. Calcúlala tú misma a partir de la fecha de hoy (la tienes en tu contexto) y lo que haya dicho Sebastián (ej. 'en dos semanas', 'el viernes que viene').",
          },
        },
        required: ["descripcion", "fecha_estimada"],
      },
    },
  },
  execute: async (args) => {
    const descripcion = String(args.descripcion ?? "").trim();
    const fechaEstimada = String(args.fecha_estimada ?? "").trim();

    if (!descripcion) {
      return "Error: no se especificó qué es el pendiente.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEstimada)) {
      return `Error: "${fechaEstimada}" no es una fecha válida en formato YYYY-MM-DD.`;
    }

    try {
      await addPendiente(descripcion, fechaEstimada);
      return `Anotado: "${descripcion}" (estimado para ${fechaEstimada}).`;
    } catch (err) {
      return `Error guardando el pendiente: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
