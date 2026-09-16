import { useRef, RefObject } from "react";
import { IDLE_QUIRK_INTERVAL_MS, OPENROUTER_MODEL } from "../config/constants";
import { buildIdlePrompt, getHeldPoseSummary } from "../prompts/idlePrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { parseMovementMarker } from "../lib/markers";
import { loadMemoryContext } from "../lib/memory";
import { BoneTransition, MovementOrigin, ParsedMovement } from "../types";

type UseIdleQuirksParams = {
  boneTransitionsRef: RefObject<Record<string, BoneTransition>>;
  boneRestRotationRef: RefObject<
    Record<string, { x: number; y: number; z: number }>
  >;
  scheduleMovement: (
    parsed: ParsedMovement,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) => void;
};

export function useIdleQuirks({
  boneTransitionsRef,
  boneRestRotationRef,
  scheduleMovement,
}: UseIdleQuirksParams) {
  // Tarea 3.1, Paso 3: silencio se mide desde lo último de estas dos cosas
  // que haya pasado -- una interacción real, o el último quirk (para que
  // los quirks no se disparen en cadena sin pausa).
  const lastInteractionTimeRef = useRef(performance.now());
  const lastQuirkTimeRef = useRef(performance.now());
  const isQuirkPendingRef = useRef(false);

  // --- Tarea 3.1, Paso 3: consulta aparte al LLM para un quirk idle. No
  // se agrega al historial de conversación (no es una respuesta a
  // Sebastián), y usa un prompt liviano -- solo identidad/personalidad y
  // el marcador de movimiento, sin el resto de la documentación de manos,
  // voz, etc., para no gastar tokens de más en algo que puede no producir
  // ningún movimiento. Los quirks son silenciosos (sin TTS) y no hay
  // ningún reseteo forzado a reposo -- eso se eliminó a propósito.
  async function askForIdleQuirk() {
    isQuirkPendingRef.current = true;
    try {
      const { personality, world } = await loadMemoryContext();
      const heldPoseSummary = getHeldPoseSummary(
        boneTransitionsRef.current,
        boneRestRotationRef.current,
      );
      const idleSystemPrompt = buildIdlePrompt({
        world,
        personality,
        heldPoseSummary,
      });

      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: idleSystemPrompt }],
      });

      const data = await response.json();
      const reply: string = data.choices?.[0]?.message?.content ?? "";
      console.log("[DEBUG-QUIRK] Respuesta idle cruda:", reply);

      const parsed = parseMovementMarker(reply);
      console.log("[DEBUG-QUIRK] Quirk parseado:", parsed);
      if (parsed) {
        // El doble de su propia duración de entrada antes de volver sola.
        scheduleMovement(parsed, "idle", parsed.durationMs);
      }
    } catch (err) {
      console.error("Error en el quirk idle:", err);
    } finally {
      lastQuirkTimeRef.current = performance.now();
      isQuirkPendingRef.current = false;
    }
  }

  // Se llama desde onBeforeRender con el "now" del frame. Si pasó
  // suficiente silencio (sin interacción ni quirk previo) y no hay ya un
  // quirk en curso, dispara uno nuevo -- es una llamada real al LLM, por
  // eso el intervalo es largo y no se dispara si ya hay uno pendiente.
  function checkIdleQuirk(now: number) {
    const silenceBase = Math.max(
      lastInteractionTimeRef.current,
      lastQuirkTimeRef.current,
    );
    if (
      !isQuirkPendingRef.current &&
      now - silenceBase > IDLE_QUIRK_INTERVAL_MS
    ) {
      askForIdleQuirk();
    }
  }

  return { lastInteractionTimeRef, checkIdleQuirk };
}
