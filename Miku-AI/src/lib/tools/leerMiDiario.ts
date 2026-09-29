import { ToolDefinition } from "./types";
import { readDiaryEntries } from "../diary";
import { findDiaryEntries } from "../diaryEntries";

// D5 (2026-09-28): su diario no se carga en la charla (es largo y es para
// ella); con esta tool lo lee cuando quiere recordar lo que escribió.
const MAX_CHARS = 4000;

export const leerMiDiario: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "leer_mi_diario",
      description:
        "Lee tu propio diario (lo que escribes cada noche sobre tu día): sin nada, tus últimas entradas; con fecha, la de esa noche; con búsqueda, las que hablan de eso. Úsala cuando quieras recordar lo que escribiste o te pregunten por un día.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Opcional. YYYY-MM-DD (calcúlala desde la fecha de hoy si dice \"ayer\" o \"el lunes\")." },
          busqueda: { type: "string", description: "Opcional. Palabras que tendría que tener la entrada." },
        },
        required: [],
      },
    },
  },
  execute: async (args) => {
    try {
      const entries = await readDiaryEntries();
      if (entries.length === 0) return "Tu diario todavía no tiene entradas.";
      const date = typeof args.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.fecha) ? args.fecha : undefined;
      const query = typeof args.busqueda === "string" && args.busqueda.trim() ? args.busqueda.trim() : undefined;
      const found = findDiaryEntries(entries, { date, query });
      if (found.length === 0) {
        return `No escribiste nada ${date ? `el ${date}` : ""}${date && query ? " " : ""}${query ? `sobre "${query}"` : ""}.`.replace("nada .", "nada.");
      }
      const text = found.map((e) => `## ${e.date}\n${e.text}`).join("\n\n");
      return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
    } catch (err) {
      return `Error al leer tu diario: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
