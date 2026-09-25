import { useRef, RefObject } from "react";
import {
  IDLE_QUIRK_INTERVAL_MS,
  OPENROUTER_MODEL,
  DIRECT_QUIRK_RUN_CHANCE,
  DEFAULT_HAND_GESTURE_DURATION_MS,
  DEFAULT_QUIRK_REVERT_CYCLES,
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
import { TOUCH_REACTION_LABELS, TouchReactionKey, processRedesignMarkers } from "../lib/touchReactionsStore";
import { reviewTouchReaction } from "../lib/touchReview";

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
  // Bug real: un gesto animado no se termina solo (ver useMovement.ts) --
  // sin esto, un quirk nuevo que no toca todos los huesos del anterior
  // deja partes de dos gestos animados mezclándose para siempre.
  revertAnimatedBonesExcept: (keepKeys: string[]) => void;
  scheduleHandGesture: (
    side: "left" | "right",
    presetName: string,
    durationMs: number,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) => void;
  // Idea #21: cuando saca a colación un pendiente vencido, ya no habla al
  // toque -- se acumula en el resumen agrupado (ver useNotificationDigest.ts)
  // igual que el correo nuevo y los avisos de Calendar no urgentes, en vez
  // de ser un cuarto mecanismo de aviso independiente.
  queueAnnouncement: (text: string) => void;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
  // Fase 7: cuando un quirk todavía en evaluación se ejecuta, hay que
  // pedirle a App.tsx (dueño del renderer) que capture fotos en distintos
  // momentos, y dejar la descripción numérica lista para la próxima
  // consulta idle -- mismo patrón que usa askMiku con sus propios refs,
  // pero separado para no pisarse con una conversación real.
  //
  // Varias fotos, no una sola: un quirk ANIMADO oscila sin parar, y una
  // sola captura cae en un punto arbitrario del ciclo (ver el comentario
  // largo en App.tsx) -- no muestra el vaivén ni necesariamente la pose
  // más representativa. DeepSeek no acepta video, así que la alternativa
  // real es varias fotos fijas en distintos puntos del mismo ciclo.
  captureQuirkImagesAfterDelays: (delaysMs: number[]) => void;
  quirkSelfImagesRef: RefObject<string[]>;
  pendingQuirkDescriptionRef: RefObject<string | null>;
  // [LLEVAR_MANO] en un gesto espontáneo (ver resolveReach en App.tsx):
  // devuelve el movimiento de los brazos ya resuelto, o null.
  resolveReach: (text: string, base: ParsedMovement | null) => ParsedMovement | null;
};

export function useIdleQuirks({
  boneTransitionsRef,
  boneRestRotationRef,
  scheduleMovement,
  revertAnimatedBonesExcept,
  scheduleHandGesture,
  queueAnnouncement,
  voicePitchRef,
  voiceRateRef,
  captureQuirkImagesAfterDelays,
  quirkSelfImagesRef,
  pendingQuirkDescriptionRef,
  resolveReach,
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
    // Pedido de Sebastián: cuántos ciclos de vaivén dura un quirk ANIMADO
    // antes de asentarse solo es una decisión de Miku por quirk (ver
    // "ciclos=N" en markers.ts), no un número fijo para todos -- el valor
    // viejo (2, implícito) se sentía corto para algo como tararear.
    const cycles = quirk.revertAfterCycles ?? DEFAULT_QUIRK_REVERT_CYCLES;

    if (quirk.movement) {
      // Antes de este quirk, apaga cualquier oscilación animada que haya
      // quedado colgada de un quirk anterior y que este no vaya a tocar
      // (ver revertAnimatedBonesExcept) -- si no, se mezclan para siempre.
      revertAnimatedBonesExcept(
        quirk.movement.entries.map((e) => `${e.bone}.${e.axis}`),
      );
      // Para un movimiento animado, "duración" es el período de UN ciclo
      // -- el revert se programa recién después de `cycles` ciclos
      // completos. Para uno no animado, "ciclos" no aplica: sigue
      // sosteniendo la pose el mismo tiempo que tardó en llegar ahí,
      // igual que antes.
      const bodyRevertDelayMs = quirk.movement.animated
        ? quirk.movement.durationMs * (cycles - 1)
        : quirk.movement.durationMs;
      scheduleMovement(quirk.movement, "idle", bodyRevertDelayMs);
    } else {
      revertAnimatedBonesExcept([]);
    }
    const handDuration = quirk.handDurationMs ?? DEFAULT_HAND_GESTURE_DURATION_MS;
    // Mismo criterio para el wiggle de manos -- scheduleHandGesture solo
    // usa este valor si el preset en sí es animado, pasarlo siempre no
    // hace daño en el caso no animado.
    const handRevertDelayMs = handDuration * (cycles - 1);
    if (quirk.handLeft) {
      scheduleHandGesture("left", quirk.handLeft, handDuration, "idle", handRevertDelayMs);
    }
    if (quirk.handRight) {
      scheduleHandGesture("right", quirk.handRight, handDuration, "idle", handRevertDelayMs);
    }

    if (quirk.state === "evaluando") {
      const maxDurationMs = Math.max(
        quirk.movement?.durationMs ?? 0,
        quirk.handLeft || quirk.handRight ? handDuration : 0,
      );
      if (quirk.movement?.animated) {
        // Un ciclo completo de oscilación: centro (subiendo) -> pico ->
        // centro (bajando) -> valle. quirk.movement.durationMs es el
        // PERÍODO del ciclo (ver useMovement.ts), así que estas fracciones
        // caen en puntos reales del vaivén, no en un momento arbitrario.
        const cycleMs = quirk.movement.durationMs;
        captureQuirkImagesAfterDelays(
          [0.25, 0.5, 0.75, 1].map((fraction) => cycleMs * fraction),
        );
      } else if (maxDurationMs > 0) {
        captureQuirkImagesAfterDelays([maxDurationMs + 300]);
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
        revertAfterCycles: parsedCreateQuirk.revertAfterCycles,
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
  // vencer -- ahí sí puede decir algo, ver buildIdlePrompt (idea #21: ese
  // texto ya no se habla al toque, se encola en el resumen agrupado).
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
      const quirkImages = quirkSelfImagesRef.current;
      quirkSelfImagesRef.current = [];

      const ask = async (messages: object[], kind: "silencio (decidir)" | "silencio (diseñar)" = "silencio (diseñar)") => {
        const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind });
        const data = await response.json();
        return String(data.choices?.[0]?.message?.content ?? "");
      };

      // Paso "diseñar": el manual completo del cuerpo, las fotos del quirk
      // en evaluación si hay, y lo que ella dijo que quería hacer.
      const designMessages = (intent: string | null) => {
        const messages: object[] = [
          {
            role: "system",
            content: buildIdlePrompt({
              world,
              personality,
              heldPoseSummary,
              // Si viene de "decidir", los pendientes ya se los mostré ahí.
              duePendientes: intent ? [] : duePendientes,
              quirks,
              quirkFeedback,
              mode: "diseñar",
              intent,
            }),
          },
        ];
        if (quirkImages.length > 0) {
          // Varias fotos (si el quirk es animado, distintos puntos del mismo
          // ciclo de vaivén; si no, una sola) -- ver el comentario largo en
          // runStoredQuirk sobre por qué una sola no alcanza para animados.
          const introText =
            quirkImages.length > 1
              ? "Así se vio tu cuerpo en distintos momentos del mismo movimiento, la última vez que corrió por tu cuenta un quirk que estás evaluando -- de la primera a la última imagen, en orden. Cada imagen te muestra desde cuatro ángulos: frente, tu izquierda, espalda y tu derecha."
              : "Así te quedó el cuerpo la última vez que corrió, por su cuenta, un quirk que estás evaluando -- desde cuatro ángulos: frente, tu izquierda, espalda y tu derecha.";
          messages.push({
            role: "user",
            content: [
              { type: "text", text: introText },
              ...quirkImages.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          });
        }
        return messages;
      };

      // El silencio va en dos pasos (idea de Sebastián): sin el manual del
      // cuerpo decide si quiere hacer algo, y solo si quiere se le manda.
      // Con un quirk en evaluación va directo a diseñar: juzgarlo y
      // corregirlo necesita el manual.
      const needsDesign = quirkImages.length > 0 || Boolean(quirkFeedback);
      let decideReply: string | null = null;
      let reply: string;
      if (needsDesign) {
        reply = await ask(designMessages(null));
      } else {
        decideReply = await ask([
          {
            role: "system",
            content: buildIdlePrompt({ world, personality, heldPoseSummary, duePendientes, quirks, mode: "decidir" }),
          },
        ], "silencio (decidir)");
        const intent = decideReply.match(/\[QUIERO_MOVERME:\s*([\s\S]*?)\]/i)?.[1]?.trim() || null;
        if (intent) console.log(`[Silencio] Quiere moverse: "${intent}"`);
        reply = intent ? await ask(designMessages(intent)) : decideReply;

        // A4: pidió revisar una reacción al tacto con las novedades de su
        // cuerpo (una por consulta).
        const reviewKey = decideReply.match(/\[REVISAR_REACCION:\s*([^\]]+)\]/i)?.[1]?.trim().toLowerCase();
        if (reviewKey && reviewKey in TOUCH_REACTION_LABELS) {
          console.log(`[Silencio] Quiere revisar su reacción a "${reviewKey}"`);
          await reviewTouchReaction(reviewKey as TouchReactionKey).catch((err) =>
            console.error("Error revisando una reacción al tacto:", err),
          );
        }
      }

      // El cuerpo sale de la respuesta final.
      const parsed = parseMarkers(reply, voicePitchRef.current, voiceRateRef.current);

      // Se resuelve antes de mover nada, sobre la pose final (ver App.tsx).
      const reachMovement = resolveReach(reply, parsed.movement);
      if (parsed.movement || reachMovement) {
        // Mismo motivo que en runStoredQuirk: limpia cualquier oscilación
        // animada colgada de un quirk directo anterior que este movimiento
        // no vaya a tocar.
        revertAnimatedBonesExcept(
          [...(parsed.movement?.entries ?? []), ...(reachMovement?.entries ?? [])].map(
            (e) => `${e.bone}.${e.axis}`,
          ),
        );
      }
      // El doble de su propia duración de entrada antes de volver sola.
      if (parsed.movement) {
        scheduleMovement(parsed.movement, "idle", parsed.movement.durationMs);
      }
      if (reachMovement) {
        scheduleMovement(reachMovement, "idle", reachMovement.durationMs);
      }

      await processQuirkMarkers(quirks, parsed.createQuirk, parsed.quirkReady);

      // Reacciones al tacto y pendientes: de cualquiera de los dos pasos.
      const replies = decideReply !== null && decideReply !== reply ? [decideReply, reply] : [reply];
      for (const r of replies) await processRedesignMarkers(r);

      const spoken = replies
        .map((r) => parseMarkers(r, voicePitchRef.current, voiceRateRef.current).cleanText)
        .filter(Boolean)
        .join(" ");
      if (spoken && duePendientes.length > 0) {
        queueAnnouncement(spoken);
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
