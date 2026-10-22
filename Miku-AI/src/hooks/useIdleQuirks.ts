import { useRef, RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IDLE_QUIRK_INTERVAL_MS,
  OPENROUTER_MODEL,
  DIRECT_QUIRK_RUN_CHANCE,
  DEFAULT_HAND_GESTURE_DURATION_MS,
} from "../config/constants";
import { buildIdlePrompt, getHeldPoseSummary } from "../prompts/idlePrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { gestureHoldMs, gesturePlayMs, parseMarkers, playableGesture } from "../lib/markers";
import { parseRequestedFace } from "../lib/faceParts";
import { processSleepRedesignMarkers } from "../lib/sleepStore";
import { processMusicRedesignMarkers } from "../lib/musicStore";
import { processMoodFaceRedesignMarkers } from "../lib/moodFaceStore";
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
  // Varias fotos si el gesto va y vuelve ("repetir=N"): una sola no
  // muestra el movimiento. DeepSeek no acepta video, así que la
  // alternativa real es varias fotos fijas en distintos momentos.
  captureQuirkImagesAfterDelays: (delaysMs: number[]) => void;
  quirkSelfImagesRef: RefObject<string[]>;
  pendingQuirkDescriptionRef: RefObject<string | null>;
  // [LLEVAR_MANO] en un gesto espontáneo (ver resolveReach en App.tsx):
  // devuelve el movimiento de los brazos ya resuelto, o null.
  resolveReach: (text: string, base: ParsedMovement | null) => ParsedMovement | null;
  // Una cara por un rato (ver useFace.showExpressionFor): los gestos en
  // silencio y los quirks también pueden llevar cara (un guiño, por ejemplo).
  showExpressionFor: (expression: string, forMs: number) => void;
};

// Un gesto en silencio se hace una vez (o "repetir" veces) y vuelve, igual
// que en la charla (ver playableGesture en markers.ts). Si Miku no eligió
// cuánto sostenerlo ("mantener"), lo sostiene lo mismo que tardó en llegar.
function idleHoldMs(movement: ParsedMovement): number {
  return gestureHoldMs(movement, movement.durationMs);
}

// Cuánto dura la cara de un gesto en silencio: lo que dura el gesto hasta
// empezar a volver, nunca menos que esto.
const IDLE_FACE_MIN_MS = 2500;
function idleFaceMs(movement: ParsedMovement | null) {
  if (!movement) return IDLE_FACE_MIN_MS;
  return Math.max(IDLE_FACE_MIN_MS, gesturePlayMs(movement) + idleHoldMs(movement));
}

// B3: cuánto sin teclado ni mouse (y sin hablarle) para darlo por ausente,
// y cada cuánto se revisa.
const AWAY_AFTER_MS = 10 * 60 * 1000;
const AWAY_CHECK_EVERY_MS = 30 * 1000;

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
  showExpressionFor,
}: UseIdleQuirksParams) {
  // Tarea 3.1, Paso 3: silencio se mide desde lo último de estas dos cosas
  // que haya pasado -- una interacción real, o el último quirk (para que
  // los quirks no se disparen en cadena sin pausa).
  const lastInteractionTimeRef = useRef(performance.now());
  const lastQuirkTimeRef = useRef(performance.now());
  const isQuirkPendingRef = useRef(false);
  // B3: Sebastián no está (ni teclado ni mouse en toda la PC, ni le habló
  // a Miku) -> no se consulta al modelo en los silencios: nadie lo ve y
  // cuesta tokens. Se revisa cada tanto, no en cada cuadro.
  const awayRef = useRef(false);
  const lastAwayCheckRef = useRef(0);

  // Fase 7: corre un quirk propio ya guardado, sin pasar por el LLM. Si
  // todavía está "evaluando", dispara la foto + descripción numérica que se
  // va a adjuntar a la PRÓXIMA consulta idle (sea otra ejecución directa o
  // una llamada real), para que ella pueda juzgarlo antes de confirmarlo.
  function runStoredQuirk(name: string, quirk: StoredQuirk) {
    // Los quirks viejos guardados con animado=si también se hacen una vez.
    const body = quirk.movement ? playableGesture(quirk.movement) : null;
    if (quirk.face) showExpressionFor(quirk.face, idleFaceMs(body));

    if (body) {
      // Antes de este quirk, apaga cualquier oscilación que haya quedado
      // colgada (un baile, una reacción al tacto) y que este no vaya a
      // tocar (ver revertAnimatedBonesExcept) -- si no, se mezclan.
      revertAnimatedBonesExcept(body.entries.map((e) => `${e.bone}.${e.axis}`));
      scheduleMovement(body, "idle", idleHoldMs(body));
    } else {
      revertAnimatedBonesExcept([]);
    }
    const handDuration = quirk.handDurationMs ?? DEFAULT_HAND_GESTURE_DURATION_MS;
    // Las manos vuelven junto con el cuerpo. scheduleHandGesture solo usa
    // este valor si el gesto de mano en sí es animado (dedos en movimiento).
    const handRevertDelayMs = body ? gesturePlayMs(body) + idleHoldMs(body) - handDuration : handDuration;
    if (quirk.handLeft) {
      scheduleHandGesture("left", quirk.handLeft, handDuration, "idle", Math.max(0, handRevertDelayMs));
    }
    if (quirk.handRight) {
      scheduleHandGesture("right", quirk.handRight, handDuration, "idle", Math.max(0, handRevertDelayMs));
    }

    if (quirk.state === "evaluando") {
      const maxDurationMs = Math.max(
        body ? gesturePlayMs(body) : 0,
        quirk.handLeft || quirk.handRight ? handDuration : 0,
      );
      if (body && (body.repeat ?? 1) > 1) {
        // Va y vuelve: una foto en cada extremo de la primera ida y vuelta,
        // y otra ya quieta en la pose.
        captureQuirkImagesAfterDelays([body.durationMs, body.durationMs * 2, maxDurationMs + 300]);
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
    face: string | null,
  ): Promise<QuirksStore> {
    let updated = quirks;

    if (parsedCreateQuirk) {
      const movement: ParsedMovement | null =
        parsedCreateQuirk.entries.length > 0
          ? {
              entries: parsedCreateQuirk.entries,
              durationMs: parsedCreateQuirk.durationMs,
              animated: false,
              repeat: parsedCreateQuirk.repeat,
              holdMs: parsedCreateQuirk.holdMs,
            }
          : null;
      updated = await saveQuirk(updated, parsedCreateQuirk.name, {
        movement,
        handLeft: parsedCreateQuirk.handLeft,
        handRight: parsedCreateQuirk.handRight,
        handDurationMs: parsedCreateQuirk.durationMs,
        ...(face ? { face } : {}),
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
          // Varias fotos si el quirk va y vuelve ("repetir"), una si no --
          // ver runStoredQuirk.
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
      const spontaneous = parsed.movement ? playableGesture(parsed.movement) : null;
      if (spontaneous || reachMovement) {
        // Mismo motivo que en runStoredQuirk: limpia cualquier oscilación
        // colgada que este movimiento no vaya a tocar.
        revertAnimatedBonesExcept(
          [...(spontaneous?.entries ?? []), ...(reachMovement?.entries ?? [])].map(
            (e) => `${e.bone}.${e.axis}`,
          ),
        );
      }
      if (spontaneous) {
        scheduleMovement(spontaneous, "idle", idleHoldMs(spontaneous));
      }
      if (reachMovement) {
        scheduleMovement(reachMovement, "idle", idleHoldMs(reachMovement));
      }

      // La cara del gesto ([CARA] o [EXPRESION]). Si creó un quirk, es la
      // del quirk y se muestra al correrlo; si no, va con este gesto.
      const face = parseRequestedFace(reply);
      if (face && !parsed.createQuirk) {
        showExpressionFor(face, idleFaceMs(spontaneous ?? reachMovement));
      }

      await processQuirkMarkers(quirks, parsed.createQuirk, parsed.quirkReady, face);

      // Reacciones al tacto y pendientes: de cualquiera de los dos pasos.
      const replies = decideReply !== null && decideReply !== reply ? [decideReply, reply] : [reply];
      for (const r of replies) {
        await processRedesignMarkers(r);
        await processSleepRedesignMarkers(r);
        await processMusicRedesignMarkers(r);
        await processMoodFaceRedesignMarkers(r);
      }

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
  function refreshAway(now: number) {
    if (now - lastAwayCheckRef.current < AWAY_CHECK_EVERY_MS) return;
    lastAwayCheckRef.current = now;
    invoke<number>("segundos_sin_usar_pc")
      .then((idleSeconds) => {
        const sinceTalkMs = performance.now() - lastInteractionTimeRef.current;
        const away = idleSeconds * 1000 > AWAY_AFTER_MS && sinceTalkMs > AWAY_AFTER_MS;
        if (away === awayRef.current) return;
        awayRef.current = away;
        console.log(
          away
            ? `[Silencio] Sebastián no está (${Math.round(idleSeconds / 60)} min sin teclado ni mouse): se pausan las consultas de silencio.`
            : "[Silencio] Sebastián volvió: siguen las consultas de silencio.",
        );
      })
      .catch(() => {});
  }

  function checkIdleQuirk(now: number) {
    refreshAway(now);
    if (awayRef.current) return;
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
