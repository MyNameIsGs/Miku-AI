import { ToolDefinition } from "./types";

// Tarea 6.1: herramienta trivial (sin argumentos, sin riesgo) para validar
// la plomería del ciclo de tool calling antes de sumar tools que de verdad
// tocan el sistema.
export const obtenerHoraActual: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "obtener_hora_actual",
      description:
        "Devuelve la fecha y hora actuales del sistema de Sebastián, en español.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: () => {
    const now = new Date();
    return now.toLocaleString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  },
};
