import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";

// Tarea 8.4: dictado por voz en cualquier app (ver text_input.rs) -- manda
// el texto como eventos de teclado a la ventana que tenga el foco en ese
// momento, letra por letra. No enfoca ni cambia de ventana por su cuenta:
// escribe donde Sebastián ya esté parado (el Bloc de notas, un chat, un
// campo de búsqueda).
export const escribirTexto: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "escribir_texto",
      description:
        "Escribe (teclea) el texto dado en la ventana que tenga el foco en este momento -- como si lo tipeara Sebastián a mano. Úsala SOLO cuando pida explícitamente que le escribas o dictes algo en la ventana activa (ej. \"escribe esto en el chat\", \"dicta: ...\"), nunca para responderle a él ni para acciones dentro de esta conversación -- una pregunta o pedido normal no es dictado.",
      parameters: {
        type: "object",
        properties: {
          texto: {
            type: "string",
            description: "El texto exacto a escribir, tal como debe aparecer tecleado.",
          },
        },
        required: ["texto"],
      },
    },
  },
  execute: async (args) => {
    const texto = String(args.texto ?? "");
    if (!texto) {
      return "Error: no se especificó qué escribir.";
    }

    try {
      await invoke("escribir_texto", { texto });
      return "Listo, ya lo escribí.";
    } catch (err) {
      return `Error al escribir el texto: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
