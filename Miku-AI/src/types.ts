export type MovementOrigin = "response" | "idle";

export type BoneTransition = {
  startValue: number;
  targetValue: number;
  startTime: number;
  duration: number; // si animated=true, se interpreta como período del ciclo
  origin: MovementOrigin;
  animated: boolean;
};

// Cuándo y adónde debe volver solo un hueso después de un quirk (movimiento idle espontáneo)
export type PendingQuirkRevert = {
  revertAt: number; // performance.now() objetivo
  revertToValue: number; // radianes -- lo que tenía ANTES del quirk
  revertDuration: number; // ms
};

export type ParsedMovement = {
  entries: { bone: string; axis: "x" | "y" | "z"; intensity: number }[];
  durationMs: number;
  animated: boolean;
};

export type FingerKey = "thumb" | "index" | "middle" | "ring" | "pinky";

export type FingerCurls = Record<FingerKey, number>;

export type ParsedHandGesture = {
  left?: string;
  right?: string;
  durationMs: number;
};

export type ParsedGestureCreation = {
  name: string;
  curls: FingerCurls;
  animated: boolean;
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatContent = string | ChatContentPart[];

// Tarea 6.1: tool calling nativo de OpenRouter. `function.arguments` viaja
// como string JSON tal cual lo devuelve la API -- se parsea recién al
// ejecutar la tool (ver lib/tools/index.ts), no acá.
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | { role: "user"; content: ChatContent }
  | { role: "assistant"; content: ChatContent; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };
