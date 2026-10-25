import { CallKind, recordUsage } from "./tokenUsage";
import { ChatMessage, ToolCall } from "../types";
import { getToolSchemas, executeTool } from "./tools";

// Una consulta con SOLO mensajes de sistema (diario, avisos de correo,
// repaso del día, silencios...) hace que DeepSeek siga escribiendo el prompt
// o razone en voz alta en la respuesta, en vez de contestar: así se colaron
// al diario pedazos de instrucciones y "Hmm, el usuario me pide...", y en
// los avisos frases como "no le mencionaré esto". Medido el 2026-10-14 con
// el prompt real del diario: 4 de 4 mal sin mensaje de usuario, 4 de 4 bien
// con él. Se agrega uno neutro, que no cambia lo que se le pide.
const NUDGE_USER_MESSAGE = { role: "user", content: "Responde según las instrucciones." };

function withUserTurn(body: object): object {
  const messages = (body as { messages?: { role?: string }[] }).messages;
  if (!Array.isArray(messages) || messages.some((m) => m.role !== "system")) return body;
  return { ...body, messages: [...messages, NUDGE_USER_MESSAGE] };
}

// Tope de la respuesta si quien llama no puso otro. Sin tope, OpenRouter
// reserva el máximo del modelo (131072) y con poco saldo rechaza el pedido
// entero (402), aunque la respuesta real fuera de 500 tokens (medido
// 2026-10-25). Las respuestas de Miku rondan los 300-1500.
const DEFAULT_MAX_TOKENS = 4096;

function withMaxTokens(body: object): object {
  return "max_tokens" in body ? body : { ...body, max_tokens: DEFAULT_MAX_TOKENS };
}

export async function fetchOpenRouterWithRetry(
  body: object,
  // kind: para qué es la llamada, para medir cuánto gasta cada tipo (B2,
  // ver lib/tokenUsage.ts).
  {
    kind = "otro",
    onRetry,
    signal,
  }: {
    kind?: CallKind;
    onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void;
    // Para cancelar la respuesta a mitad de camino (botón de cancelar
    // mientras piensa): corta el pedido y la espera entre reintentos.
    signal?: AbortSignal;
  } = {},
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
        body: JSON.stringify(withMaxTokens(withUserTurn(body))),
        signal,
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
    signal?.throwIfAborted();
  }

  return lastResponse!;
}

// Con 3 se cortaban turnos normales (2026-10-25): las luces se cambian de a
// una acción por llamada (un color por ánimo, un grupo tras otro) y el
// error salía como "El modelo no contestó".
const MAX_TOOL_CALL_ROUNDS = 8;

// Al pasar el tope no se tira error: una vuelta más sin herramientas, con
// este aviso, para que conteste con lo que hizo. Con tool_choice "none" solo,
// DeepSeek devolvía vacío; con el aviso, 3 de 3 contaron lo hecho y lo que
// faltó (medido 2026-10-25).
const OUT_OF_TOOL_ROUNDS_NOTE = {
  role: "system",
  content:
    "Ya usaste todas las herramientas que se pueden en este turno. No pidas más: contesta ahora con lo que hiciste y, si quedó algo sin hacer, dilo.",
};

// Aviso de cada tool que empieza y termina, para el rastro de la caja de
// subtítulo mientras piensa (diseño v1). Solo informa, no cambia el ciclo.
export type ToolEvent = { id: string; name: string; status: "running" | "done" };

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
// a preguntar con el resultado. Pasado MAX_TOOL_CALL_ROUNDS se le pide la
// respuesta final sin herramientas, para no encadenarse indefinidamente.
export async function runToolCallingCycle(
  model: string,
  initialMessages: object[],
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
  onToolEvent?: (event: ToolEvent) => void,
  signal?: AbortSignal,
): Promise<ToolCallingResult> {
  const messages = [...initialMessages];
  const appendedMessages: ChatMessage[] = [];

  for (let round = 1; round <= MAX_TOOL_CALL_ROUNDS + 1; round++) {
    const lastRound = round > MAX_TOOL_CALL_ROUNDS;
    const response = await fetchOpenRouterWithRetry(
      {
        model,
        messages: lastRound ? [...messages, OUT_OF_TOOL_ROUNDS_NOTE] : messages,
        tools: getToolSchemas(),
        tool_choice: lastRound ? "none" : "auto",
      },
      { kind: "charla", onRetry, signal },
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
    // En la última vuelta se ignoran (por si el proveedor no respeta "none").
    const hasToolCalls =
      !lastRound &&
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
      // Una tool ya en curso no se interrumpe, pero no se empieza otra.
      signal?.throwIfAborted();
      // `function.arguments` llega como string JSON, no como objeto
      // (verificado en la Tarea 6.0) -- se parsea dentro de executeTool.
      onToolEvent?.({ id: toolCall.id, name: toolCall.function.name, status: "running" });
      const result = await executeTool(
        toolCall.function.name,
        toolCall.function.arguments,
      );
      onToolEvent?.({ id: toolCall.id, name: toolCall.function.name, status: "done" });
      const toolMessage: ChatMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      };
      messages.push(toolMessage);
      appendedMessages.push(toolMessage);
    }
  }

  // No se llega: la última vuelta siempre devuelve.
  throw new Error("Ciclo de tool calling terminado sin respuesta final.");
}
