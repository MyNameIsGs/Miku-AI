import { openUrl } from "@tauri-apps/plugin-opener";
import { ToolDefinition } from "./types";

// Tarea 6.3: usa el plugin `opener` ya instalado -- necesita el permiso
// "opener:allow-open-url" en capabilities/default.json.
export const abrirUrl: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "abrir_url",
      description:
        "Abre una página web en el navegador predeterminado de Sebastián.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "La URL completa a abrir, incluyendo https://.",
          },
        },
        required: ["url"],
      },
    },
  },
  execute: async (args) => {
    const url = String(args.url ?? "").trim();
    if (!url) {
      return "Error: no se especificó qué URL abrir.";
    }

    try {
      await openUrl(url);
      return `Abrí ${url} en el navegador.`;
    } catch (err) {
      return `Error al abrir la URL: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
