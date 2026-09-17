import { ToolDefinition } from "./types";
import { OPENROUTER_MODEL } from "../../config/constants";
import { fetchOpenRouterWithRetry } from "../openrouter";

// Tarea 6.3: usa el server tool `openrouter:web_search` de OpenRouter (el
// plugin `{ id: "web" }` del body, no el sufijo `:online`, que es
// equivalente pero deprecado en la documentación). Para el modelo actual
// (no es de Anthropic/OpenAI/Google) el plugin busca SIEMPRE que se manda
// -- verificado con una prueba real: hasta "¿cuánto es 2+2?" disparó una
// búsqueda. Por eso esto NO va como `plugins` en la conversación principal
// (buscaría en cada mensaje) -- es su propia llamada aparte a OpenRouter,
// que solo se hace cuando Miku decide llamar esta tool. Así el control de
// cuándo buscar queda en el tool calling normal, no en el plugin.
const MAX_RESULTS = 3;

export const buscarEnWeb: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "buscar_en_web",
      description:
        "Busca en internet información actual o que no sepas de memoria (noticias, datos recientes, precios de referencia, temas puntuales). No sirve para precios en vivo ni para reservar nada -- devuelve un resumen de lo que se encontró, con fuentes.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description:
              "Qué buscar, en pocas palabras, como se escribiría en un buscador.",
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) {
      return "Error: no se especificó qué buscar.";
    }

    try {
      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Eres una herramienta de búsqueda web. Responde la consulta de forma breve y factual, citando las fuentes con enlaces markdown. Si la búsqueda no trae nada útil, dilo en vez de inventar una respuesta. No des precios en vivo ni asumas que se puede reservar nada con esta información -- son datos de referencia, no en tiempo real.",
          },
          { role: "user", content: consulta },
        ],
        plugins: [{ id: "web", max_results: MAX_RESULTS }],
      });

      const data = await response.json();
      const content: string | undefined = data.choices?.[0]?.message?.content;

      if (!content || !content.trim()) {
        return `No encontré nada útil buscando "${consulta}".`;
      }
      return content;
    } catch (err) {
      return `Error al buscar en la web: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
