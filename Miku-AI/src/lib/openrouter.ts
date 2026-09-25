import { CallKind, recordUsage } from "./tokenUsage";
import { ChatMessage, ToolCall } from "../types";
import { getToolSchemas, executeTool } from "./tools";

export async function fetchOpenRouterWithRetry(
  body: object,
  // kind: para qué es la llamada, para medir cuánto gasta cada tipo (B2,
  // ver lib/tokenUsage.ts).
  { kind = "otro", onRetry }: { kind?: CallKind; onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void } = {},
): Promise<Response> {
  const delaysMs = [2000, 5000, 10000];
  let lastResponse: Response;

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    lastResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (lastResponse.status !== 429 || attempt === delaysMs.length) {
      if (lastResponse.ok) {
        // Se lee de una copia: quien llamó lee la respuesta como siempre.
        lastResponse
          .clone()
          .json()
          .then((data) => recordUsage(kind, data?.usage))
          .catch(() => {});
      }
      return lastResponse;
    }

    const delay = delaysMs[attempt];
    console.log(
      `[INFO] OpenRouter devolvió 429, reintentando en ${delay}ms (intento ${attempt + 1}/${delaysMs.length})...`,
    );
    onRetry?.(attempt + 1, delaysMs.length, delay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return lastResponse!;
}

const MAX_TOOL_CALL_ROUNDS = 3;

export type ToolCallingResult = {
  // Contenido de texto de la respuesta final, ya con los resultados de
  // todas las tools que haya pedido (o el texto de siempre, si no pidió
  // ninguna).
  finalContent: string;
  // Todos los mensajes que se generaron durante el ciclo -- el/los
  // assistant con tool_calls, los tool con sus resultados, y el assistant
  // final -- en orden. Se guardan como bloque indivisible en el historial
  // de conversación (ver App.tsx): recortar el historial nunca debe partir
  // este grupo por la mitad, porque OpenRouter rechaza un mensaje "tool"
  // sin su assistant con tool_calls correspondiente (o viceversa).
  appendedMessages: ChatMessage[];
};

// Tarea 6.1: ciclo de tool calling nativo de OpenRouter. `initialMessages`
// ya viene armado como [system, ...historial, user]. Manda `tools` y
// `tool_choice: "auto"` en cada vuelta; si finish_reason === "tool_calls",
// ejecuta cada tool localmente contra la lista blanca de lib/tools y vuelve
// a preguntar con el resultado. Corta con error si se excede
// MAX_TOOL_CALL_ROUNDS, para no encadenarse indefinidamente.
export async function runToolCallingCycle(
  model: string,
  initialMessages: object[],
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<ToolCallingResult> {
  const messages = [...initialMessages];
  const appendedMessages: ChatMessage[] = [];

  for (let round = 1; round <= MAX_TOOL_CALL_ROUNDS; round++) {
    const response = await fetchOpenRouterWithRetry(
      {
        model,
        messages,
        tools: getToolSchemas(),
        tool_choice: "auto",
      },
      { kind: "charla", onRetry },
    );

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error(
        `Respuesta de OpenRouter sin mensaje (status ${response.status}): ${JSON.stringify(data)}`,
      );
    }

    // El array puede traer más de una llamada en la misma vuelta -- nunca
    // asumir que es una sola (verificado en la Tarea 6.0).
    const toolCalls: ToolCall[] | undefined = message.tool_calls;
    const hasToolCalls =
      choice.finish_reason === "tool_calls" &&
      Array.isArray(toolCalls) &&
      toolCalls.length > 0;

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: message.content ?? "",
      ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMessage);
    appendedMessages.push(assistantMessage);

    if (!hasToolCalls) {
      return {
        finalContent:
          typeof assistantMessage.content === "string"
            ? assistantMessage.content
            : "",
        appendedMessages,
      };
    }

    for (const toolCall of toolCalls!) {
      // `function.arguments` llega como string JSON, no como objeto
      // (verificado en la Tarea 6.0) -- se parsea dentro de executeTool.
      const result = await executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
      );
      const toolMessage: ChatMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      };
      messages.push(toolMessage);
      appendedMessages.push(toolMessage);
    }
  }

  throw new Error(
    `Se alcanzó el límite de ${MAX_TOOL_CALL_ROUNDS} vueltas de tool calling sin llegar a una respuesta final.`,
  );
}
