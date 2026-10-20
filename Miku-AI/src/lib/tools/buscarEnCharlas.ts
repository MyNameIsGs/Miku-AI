import { ToolDefinition } from "./types";
import { readConversationLog } from "../conversationLog";
import { formatTurns, searchTurns } from "../conversationSearch";

// Su historial completo de charlas en la PC (ver lib/conversationLog.ts):
// no se carga en la charla, lo busca ella cuando le hace falta.
const MAX_CHARS = 6000;
const MAX_TURNS = 12;

export const buscarEnCharlas: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "buscar_en_charlas",
      description:
        "Busca en TODAS tus charlas anteriores con Sebastián en la PC (se guardan para siempre, con fecha y hora, aunque la app se haya cerrado o la PC se haya apagado). Úsala cuando te pregunte por algo que hablaron antes y no lo tengas en la charla de ahora, o cuando sientas que te falta lo último que hablaron. Con búsqueda: los momentos que hablan de eso. Con fecha: lo de ese día. Sin nada: lo último que hablaron. No incluye lo que hablaron por el celular.",
      parameters: {
        type: "object",
        properties: {
          busqueda: { type: "string", description: "Opcional. Palabras clave del tema (ej. \"juego Godot personaje\")." },
          fecha: { type: "string", description: "Opcional. YYYY-MM-DD (calcúlala desde la fecha de hoy si dice \"ayer\" o \"el lunes\")." },
        },
        required: [],
      },
    },
  },
  execute: async (args) => {
    try {
      const turns = await readConversationLog();
      if (turns.length === 0) return "Todavía no hay charlas guardadas.";
      const date = typeof args.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha) ? args.fecha : undefined;
      const query = typeof args.busqueda === "string" && args.busqueda.trim() ? args.busqueda.trim() : undefined;
      const found = searchTurns(turns, { query, date, limit: MAX_TURNS });
      if (found.length === 0) {
        return `No encontré nada${query ? ` sobre "${query}"` : ""}${date ? ` el ${date}` : ""} en tus charlas guardadas.`;
      }
      const text = formatTurns(found);
      return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
    } catch (err) {
      return `Error al leer tus charlas: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
