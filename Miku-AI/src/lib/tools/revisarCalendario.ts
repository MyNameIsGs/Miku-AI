import { ToolDefinition } from "./types";
import { listUpcomingEventsAllAccounts } from "../calendar/api";

// Idea #7 del plan, mismo criterio que revisar_correo: solo lectura,
// revisa TODAS las cuentas de Calendar conectadas. Miku decide con esto
// si algo vale la pena mencionar o anotar como pendiente -- esta tool en
// sí nunca crea, edita ni borra eventos.
export const revisarCalendario: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "revisar_calendario",
      description:
        "Revisa los próximos eventos de TODOS los calendarios de Google que Sebastián tenga conectados -- solo lectura, nunca crea, edita ni borra nada. Devuelve de qué cuenta es cada evento, título, cuándo empieza y el lugar si tiene. Úsala cuando Sebastián pregunte qué tiene agendado, o quieras revisar si hay algo próximo que valga la pena mencionar.",
      parameters: {
        type: "object",
        properties: {
          dias: {
            type: "number",
            description: "Cuántos días hacia adelante revisar. Por defecto 7.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args) => {
    const dias =
      typeof args.dias === "number" && args.dias > 0 ? args.dias : 7;

    try {
      const events = await listUpcomingEventsAllAccounts(dias, 15);
      if (events.length === 0) {
        return `No hay eventos agendados en los próximos ${dias} días.`;
      }
      return events
        .map(
          (e) =>
            `Cuenta: ${e.account}\nEvento: ${e.summary}\nCuándo: ${e.start}${
              e.location ? `\nLugar: ${e.location}` : ""
            }`,
        )
        .join("\n---\n");
    } catch (err) {
      return `Error al revisar el calendario: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
