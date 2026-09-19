import { ToolDefinition } from "./types";
import { listRecentMessagesAllAccounts } from "../gmail/api";

// Nivel 3 de la Tarea 6.7, empezando de solo lectura: revisa TODAS las
// cuentas de Gmail que Sebastián haya conectado (usa varias) y devuelve
// remitente/asunto/fecha/fragmento corto de cada correo reciente, marcando
// de qué cuenta vino cada uno. Miku decide, con esta información, si algo
// parece una fecha de entrega o cita y merece anotarse con
// anotar_pendiente -- esta tool en sí nunca escribe nada.
export const revisarCorreo: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "revisar_correo",
      description:
        "Revisa los correos más recientes de TODAS las cuentas de Gmail que Sebastián tenga conectadas -- solo lectura, nunca envía, borra ni modifica nada. Devuelve de qué cuenta vino cada uno, remitente, asunto, fecha y un fragmento corto. Úsala cuando Sebastián pida revisar el correo, o cuando quieras fijarte si llegó algo con una fecha de entrega o cita que valga la pena anotar con anotar_pendiente.",
      parameters: {
        type: "object",
        properties: {
          dias: {
            type: "number",
            description: "Cuántos días hacia atrás revisar. Por defecto 7.",
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
      const messages = await listRecentMessagesAllAccounts(15, dias);
      if (messages.length === 0) {
        return `No hay correos nuevos en los últimos ${dias} días.`;
      }
      return messages
        .map(
          (m) =>
            `Cuenta: ${m.account}\nDe: ${m.from}\nAsunto: ${m.subject}\nFecha: ${m.date}\nFragmento: ${m.snippet}`,
        )
        .join("\n---\n");
    } catch (err) {
      return `Error al revisar el correo: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
