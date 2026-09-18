import { useRef, RefObject } from "react";
import {
  IDLE_QUIRK_INTERVAL_MS,
  OPENROUTER_MODEL,
  DIRECT_QUIRK_RUN_CHANCE,
  DEFAULT_HAND_GESTURE_DURATION_MS,
} from "../config/constants";
import { buildIdlePrompt, getHeldPoseSummary } from "../prompts/idlePrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { parseMarkers } from "../lib/markers";
import { loadMemoryContext } from "../lib/memory";
import { describeSelfMovement } from "../lib/proprioception";
import {
  loadPendientes,
  getDuePendientes,
  markPendientesReminded,
} from "../lib/pendientes";
import {
  loadQuirks,
  saveQuirk,
  confirmQuirk,
  pickWeightedQuirk,
  StoredQuirk,
  QuirksStore,
} from "../lib/quirks";
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
  scheduleHandGesture: (
    side: "left" | "right",
    presetName: string,
    durationMs: number,
    origin: MovementOrigin,
  ) => void;
  // Tarea 6.7, Nivel 2: para poder hablar cuando saca a colación un
  // pendiente -- necesita lo mismo que una respuesta normal (voz base +
  // expresión), no solo el marcador de movimiento que ya tenía.
  speak: (
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
  // Fase 7: cuando un quirk todavía en evaluación se ejecuta, hay que
  // pedirle a App.tsx (dueño del renderer) que capture una foto después de
  // que el movimiento se asiente, y dejar la descripción numérica lista
  // para la próxima consulta idle -- mismo patrón que usa askMiku con sus
  // propios refs, pero separado para no pisarse con una conversación real.
  captureQuirkImageAfterDelay: (delayMs: number) => void;
  quirkSelfImageRef: RefObject<string | null>;
  pendingQuirkDescriptionRef: RefObject<string | null>;
};

export function useIdleQuirks({
  boneTransitionsRef,
  boneRestRotationRef,
  scheduleMovement,
  scheduleHandGesture,
  speak,
  voicePitchRef,
  voiceRateRef,
  captureQuirkImageAfterDelay,
  quirkSelfImageRef,
  pendingQuirkDescriptionRef,
}: UseIdleQuirksParams) {
  // Tarea 3.1, Paso 3: silencio se mide desde lo último de estas dos cosas
  // que haya pasado -- una interacción real, o el último quirk (para que
  // los quirks no se disparen en cadena sin pausa).
  const lastInteractionTimeRef = useRef(performance.now());
  const lastQuirkTimeRef = useRef(performance.now());
  const isQuirkPendingRef = useRef(false);

  // Fase 7: corre un quirk propio ya guardado, sin pasar por el LLM. Si
  // todavía está "evaluando", dispara la foto + descripción numérica que se
  // va a adjuntar a la PRÓXIMA consulta idle (sea otra ejecución directa o
  // una llamada real), para que ella pueda juzgarlo antes de confirmarlo.
  function runStoredQuirk(name: string, quirk: StoredQuirk) {
    if (quirk.movement) {
      scheduleMovement(quirk.movement, "idle", quirk.movement.durationMs);
    }
    const handDuration = quirk.handDurationMs ?? DEFAULT_HAND_GESTURE_DURATION_MS;
    if (quirk.handLeft) {
      scheduleHandGesture("left", quirk.handLeft, handDuration, "idle");
    }
    if (quirk.handRight) {
      scheduleHandGesture("right", quirk.handRight, handDuration, "idle");
    }

    if (quirk.state === "evaluando") {
      const maxDurationMs = Math.max(
        quirk.movement?.durationMs ?? 0,
        quirk.handLeft || quirk.handRight ? handDuration : 0,
      );
      if (maxDurationMs > 0) {
        captureQuirkImageAfterDelay(maxDurationMs + 300);
      }
      const handGestureForDescription =
        quirk.handLeft || quirk.handRight
          ? { left: quirk.handLeft, right: quirk.handRight, durationMs: handDuration }
          : null;
      pendingQuirkDescriptionRef.current = describeSelfMovement(
        quirk.movement,
        handGestureForDescription,
      );
      console.log(`[Quirk] Corriendo "${name}" (evaluando)`);
    } else {
      console.log(`[Quirk] Corriendo "${name}" (confirmado)`);
    }
  }

  async function processQuirkMarkers(
    quirks: QuirksStore,
    parsedCreateQuirk: ReturnType<typeof parseMarkers>["createQuirk"],
    parsedQuirkReady: string | null,
  ): Promise<QuirksStore> {
    let updated = quirks;

    if (parsedCreateQuirk) {
      const movement: ParsedMovement | null =
        parsedCreateQuirk.entries.length > 0
          ? {
              entries: parsedCreateQuirk.entries,
              durationMs: parsedCreateQuirk.durationMs,
              animated: parsedCreateQuirk.animated,
            }
          : null;
      updated = await saveQuirk(updated, parsedCreateQuirk.name, {
        movement,
        handLeft: parsedCreateQuirk.handLeft,
        handRight: parsedCreateQuirk.handRight,
        handDurationMs: parsedCreateQuirk.durationMs,
      });
      // El primer ensayo cuenta: lo corre apenas lo crea.
      runStoredQuirk(parsedCreateQuirk.name, updated[parsedCreateQuirk.name]);
    }

    if (parsedQuirkReady && updated[parsedQuirkReady]) {
      updated = await confirmQuirk(updated, parsedQuirkReady);
    }

    return updated;
  }

  // --- Tarea 3.1, Paso 3: consulta aparte al LLM para un quirk idle. No
  // se agrega al historial de conversación (no es una respuesta a
  // Sebastián), y usa un prompt liviano -- solo identidad/personalidad y
  // el marcador de movimiento, sin el resto de la documentación de manos,
  // voz, etc., para no gastar tokens de más en algo que puede no producir
  // ningún movimiento. Los quirks son silenciosos por defecto (sin TTS) y
  // no hay ningún reseteo forzado a reposo -- eso se eliminó a propósito.
  // Tarea 6.7: la única excepción es cuando hay un pendiente vencido o por
  // vencer -- ahí sí puede hablar, ver buildIdlePrompt.
  // Fase 7: antes de gastar una llamada al LLM, con cierta probabilidad
  // corre directamente uno de sus quirks ya inventados (con más peso hacia
  // los que todavía está evaluando) -- así el "vocabulario" de movimientos
  // idle deja de ser 100% invención libre a medida que ella acumula quirks
  // propios, sin costo de LLM en esos casos.
  async function askForIdleQuirk() {
    isQuirkPendingRef.current = true;
    try {
      const quirks = await loadQuirks();
      const chosenName = pickWeightedQuirk(quirks);

      if (chosenName && Math.random() < DIRECT_QUIRK_RUN_CHANCE) {
        runStoredQuirk(chosenName, quirks[chosenName]);
        return;
      }

      const { personality, world } = await loadMemoryContext();
      const heldPoseSummary = getHeldPoseSummary(
        boneTransitionsRef.current,
        boneRestRotationRef.current,
      );
      const allPendientes = await loadPendientes();
      const duePendientes = getDuePendientes(allPendientes);

      const quirkFeedback = pendingQuirkDescriptionRef.current;
      pendingQuirkDescriptionRef.current = null;
      const quirkImage = quirkSelfImageRef.current;
      quirkSelfImageRef.current = null;

      const idleSystemPrompt = buildIdlePrompt({
        world,
        personality,
        heldPoseSummary,
        duePendientes,
        quirks,
        quirkFeedback,
      });

      const messages: object[] = [{ role: "system", content: idleSystemPrompt }];
      if (quirkImage) {
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "Así te quedó el cuerpo la última vez que corrió, por su cuenta, un quirk que estás evaluando.",
            },
            { type: "image_url", image_url: { url: quirkImage } },
          ],
        });
      }

      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages,
      });

      const data = await response.json();
      const reply: string = data.choices?.[0]?.message?.content ?? "";

      const parsed = parseMarkers(
        reply,
        voicePitchRef.current,
        voiceRateRef.current,
      );

      if (parsed.movement) {
        // El doble de su propia duración de entrada antes de volver sola.
        scheduleMovement(parsed.movement, "idle", parsed.movement.durationMs);
      }

      await processQuirkMarkers(quirks, parsed.createQuirk, parsed.quirkReady);

      if (parsed.cleanText && duePendientes.length > 0) {
        await speak(parsed.cleanText, parsed.pitch, parsed.rate, parsed.expression);
        await markPendientesReminded(duePendientes.map((p) => p.id));
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
