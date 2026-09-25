import { RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { MovementOrigin, ParsedMovement } from "../types";
import { detectTouchZone, TouchHit, TouchZone } from "../lib/touch";
import { recordTouch } from "../lib/touchLog";
import {
  TouchReactionKey,
  describeReaction,
  getDesignedReaction,
  getReactionForMood,
  loadTouchReactions,
  mirrorEntries,
  saveDesignedReaction,
  saveReactionVariant,
} from "../lib/touchReactionsStore";
import { loadMemoryContext } from "../lib/memory";
import { Mood, getCachedMood, getCurrentMood, setMood } from "../lib/mood";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { parseMoodMarker, parseMovementMarker } from "../lib/markers";
import { getReachResolver, getSelfViewCapturer } from "../lib/selfViewStore";
import { parseFaceMarker } from "../lib/faceParts";
import { OPENROUTER_MODEL } from "../config/constants";
import { buildTouchReactionPrompt } from "../prompts/touchReactionPrompt";

type UseTouchReactionsParams = {
  vrmRef: RefObject<VRM | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scheduleMovement: (
    parsed: ParsedMovement,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) => void;
  releaseQuirkRevertsNow: (keys: string[]) => void;
  getExpression: () => string;
  setExpression: (name: string) => void;
  isSpeakingRef: RefObject<boolean>;
  // Tocarla cuenta como interacción: reinicia el contador de los quirks idle.
  onInteraction: () => void;
  // Cuando Miku diseña una reacción puede querer recordar el momento
  // ([GUARDAR_MEMORIA]) -- se procesa igual que en una respuesta normal.
  processMemoryMarkers: (reply: string) => Promise<void>;
};

type Reaction = {
  // null = la reacción no cambia la expresión.
  expression: string | null;
  entries: ParsedMovement["entries"];
  durationMs: number;
  animated?: boolean;
  // Cuánto se sostiene la pose antes de volver sola (y la expresión).
  holdMs: number;
  description: string;
  // A8: a qué ánimo la deja este tacto, si ella decidió que la afecta.
  moodEffect?: string | null;
};

// Ánimo en palabras, para contárselo.
const MOOD_WORDS: Record<Mood, string> = {
  happy: "contenta",
  angry: "enojada",
  sad: "triste",
  relaxed: "relajada",
  neutral: "tranquila, sin un ánimo en particular",
};

// Reacciones de RESPALDO, escritas a mano: se usan solo mientras Miku no
// diseñó la suya para esa zona (ver requestDesign más abajo y
// touchReactionsStore.ts) -- la primera vez que la tocan en cada zona.
//
// Signos: los mismos de la tabla de ejes que ya usa Miku en su prompt
// (systemPrompt.ts, calibrada con renders reales) -- x > 0 mira arriba /
// se echa hacia atrás, y > 0 gira hacia SU izquierda, z > 0 ladea hacia
// SU izquierda. (Los huesos normalizados de un VRM0 miran hacia -z en su
// propio espacio; la escena entera está girada 180° para que mire a la
// cámara.)
// Se usan cuello y columna, no "head" (antes una transición sobre la cabeza
// le apagaba el vaivén ambiente; ya no, pero así quedaron). Intensidades en
// los rangos de la versión 2 (config/boneRanges.ts), con los mismos grados
// que tenían en la versión 1.
function reactionFor(zone: TouchZone, side: "left" | "right"): Reaction {
  const s = side === "left" ? 1 : -1;
  switch (zone) {
    case "cabeza":
      return {
        expression: "happy",
        entries: [{ bone: "neck", axis: "x", intensity: -40 }],
        durationMs: 350,
        holdMs: 900,
        description: "te dio un toquecito en la cabeza",
      };
    case "cara":
      // Puchero: gira la cara para el otro lado del dedo.
      return {
        expression: "angry",
        entries: [
          { bone: "neck", axis: "y", intensity: -67 * s },
          { bone: "neck", axis: "z", intensity: -25 * s },
        ],
        durationMs: 250,
        holdMs: 800,
        description: "te tocó la mejilla",
      };
    case "coletas":
      // La cabeza se va para el lado de la coleta tirada.
      return {
        expression: "angry",
        entries: [{ bone: "neck", axis: "z", intensity: 60 * s }],
        durationMs: 250,
        holdMs: 900,
        description: "te tiró de una coleta",
      };
    case "mano":
      // Mira su propia mano.
      return {
        expression: "happy",
        entries: [
          { bone: "neck", axis: "y", intensity: 75 * s },
          { bone: "neck", axis: "x", intensity: -30 },
        ],
        durationMs: 400,
        holdMs: 1000,
        description: "te tocó la mano",
      };
    case "brazo":
      return {
        expression: "happy",
        entries: [{ bone: "neck", axis: "y", intensity: 58 * s }],
        durationMs: 400,
        holdMs: 800,
        description: "te tocó el brazo",
      };
    case "torso":
      return {
        expression: "angry",
        entries: [
          { bone: "spine", axis: "x", intensity: 60 },
          { bone: "neck", axis: "x", intensity: 20 },
        ],
        durationMs: 300,
        holdMs: 1200,
        description: "te tocó el torso",
      };
    case "falda":
      return {
        expression: "angry",
        entries: [
          { bone: "spine", axis: "x", intensity: 60 },
          { bone: "neck", axis: "x", intensity: -50 },
        ],
        durationMs: 300,
        holdMs: 1200,
        description: "te tocó la falda",
      };
    case "pierna":
      return {
        expression: "neutral",
        entries: [{ bone: "neck", axis: "x", intensity: -50 }],
        durationMs: 400,
        holdMs: 800,
        description: "te tocó la pierna",
      };
  }
}

// Qué pasó, en segunda persona, para pedirle a Miku que diseñe su reacción.
// "Izquierda/derecha" son las de ella, no las de la pantalla.
function describeForDesign(key: TouchReactionKey, side: "left" | "right" | null): string {
  const lado = side === "left" ? "izquierda" : "derecha";
  const ladoM = side === "left" ? "izquierdo" : "derecho";
  switch (key) {
    case "cabeza":
      return "te dio un toquecito en la cabeza";
    case "cara":
      return `te tocó la mejilla ${lado}`;
    case "coletas":
      return `te tiró de la coleta ${lado}`;
    case "mano":
      return `te tocó la mano ${lado}`;
    case "brazo":
      return `te tocó el brazo ${ladoM}`;
    case "torso":
      return "te tocó el torso";
    case "falda":
      return "te tocó la falda";
    case "pierna":
      return `te tocó la pierna ${lado}`;
    case "caricia":
      return "te está acariciando la cabeza, de un lado a otro, y sigue haciéndolo";
    case "harta":
      return "te tocó muchas veces seguidas, un toque detrás de otro";
    case "agitar":
      return "agarró tu ventana y te sacudió de un lado a otro, rápido, varias veces seguidas";
  }
}

// Lo que propuso Miku para una reacción: [EXPRESION], [MOVIMIENTO] y
// [LLEVAR_MANO] (este último ya resuelto en ángulos, se guarda junto con el
// resto). Nada de eso = no propuso nada.
export function interpretDesign(reply: string): {
  movement: ParsedMovement | null;
  expression: string | null;
  // A8: si decidió que este tacto le cambia el ánimo ([ESTADO_ANIMO]).
  moodEffect: string | null;
} {
  const explicitMovement = parseMovementMarker(reply);
  const reachMovement = getReachResolver()?.(reply, explicitMovement) ?? null;
  const movement =
    explicitMovement || reachMovement
      ? {
          entries: [...(reachMovement?.entries ?? []), ...(explicitMovement?.entries ?? [])],
          durationMs: explicitMovement?.durationMs ?? reachMovement!.durationMs,
          animated: explicitMovement?.animated ?? false,
        }
      : null;
  const expressionMatch = reply.match(/\[EXPRESION:\s*(happy|angry|sad|relaxed|neutral)\]/i);
  const face = parseFaceMarker(reply);
  return {
    movement,
    expression: face ?? (expressionMatch ? expressionMatch[1].toLowerCase() : null),
    moodEffect: parseMoodMarker(reply),
  };
}

// Zonas con lado: la reacción se diseña de un lado y del otro se espeja.
export const SIDED_KEYS: TouchReactionKey[] = ["cara", "coletas", "mano", "brazo", "pierna"];

// Si el diseño falla (sin conexión, respuesta sin marcadores), no se
// reintenta en cada toque: se espera este tiempo.
const DESIGN_RETRY_AFTER_MS = 5 * 60 * 1000;

// Duraciones aceptadas para lo que diseñe Miku (la de la caricia puede ser
// más larga: si es animada, es el período del vaivén).
export const DESIGN_DURATION_RANGE_MS: [number, number] = [150, 1500];
export const DESIGN_PET_DURATION_RANGE_MS: [number, number] = [150, 3000];

// Muchos toques seguidos, en cualquier lado: se harta y mira para otro lado.
const ANNOYED_TAP_COUNT = 5;
const ANNOYED_WINDOW_MS = 6000;
const ANNOYED_REACTION: Reaction = {
  expression: "angry",
  entries: [
    { bone: "neck", axis: "y", intensity: -100 },
    { bone: "spine", axis: "y", intensity: -96 },
  ],
  durationMs: 400,
  holdMs: 1500,
  description: "te tocó muchas veces seguidas hasta hartarte",
};

// Agitar la ventana: se marea (ojos apretados, la cabeza se bambolea).
// Respaldo hasta que ella diseñe la suya.
const SHAKE_REACTION: Reaction = {
  expression: "cara:ojos_apretados=0.9,boca_puchero=0.5",
  entries: [
    { bone: "head", axis: "z", intensity: 45 },
    { bone: "neck", axis: "z", intensity: 30 },
  ],
  durationMs: 600,
  animated: true,
  holdMs: 1800,
  description: "agarró la ventana y te sacudió de un lado a otro",
};
// Una sacudida larga no dispara una reacción tras otra.
const SHAKE_COOLDOWN_MS = 3000;

// Caricia: se apoya en la mano y cierra un poco los ojos, y se queda así
// MIENTRAS dure la caricia -- vuelve recién cuando se suelta (antes se
// repetía en ciclos de ~2 s y en una caricia larga volvía a la posición
// inicial a mitad de camino; lo notó Sebastián).
const PET_REACTION: Reaction = {
  expression: "relaxed",
  entries: [
    { bone: "neck", axis: "z", intensity: 45 },
    { bone: "neck", axis: "x", intensity: -35 },
  ],
  durationMs: 500,
  holdMs: 0, // no se usa: la pose dura lo que dure la caricia
  description: "te acarició la cabeza",
};
// "Para siempre" a efectos prácticos: la vuelta real la dispara
// endPetting con releaseQuirkRevertsNow.
const PET_HOLD_UNTIL_RELEASED_MS = 60 * 60 * 1000;

// Detección de caricia: mouse moviéndose de lado a lado sobre la cabeza,
// sin clic (el clic sostenido mueve la ventana).
const PET_WINDOW_MS = 1000;
const PET_MIN_DISTANCE_PX = 200;
const PET_MIN_REVERSALS = 2;
// Sin movimiento sobre la cabeza por este tiempo = terminó la caricia.
const PET_END_MS = 700;
const HOVER_RAYCAST_INTERVAL_MS = 50;

export function useTouchReactions({
  vrmRef,
  cameraRef,
  canvasRef,
  scheduleMovement,
  releaseQuirkRevertsNow,
  getExpression,
  setExpression,
  isSpeakingRef,
  onInteraction,
  processMemoryMarkers,
}: UseTouchReactionsParams) {
  useEffect(() => {
    loadTouchReactions();
    // Deja el ánimo leído, para decidir la reacción en el mismo clic.
    getCurrentMood().catch(() => {});
  }, []);

  // Por reacción y ánimo ("caricia" o "caricia@sad").
  const designInFlightRef = useRef(new Set<string>());
  const designRetryAfterRef = useRef<Record<string, number>>({});

  // Mientras una reacción está en curso (ida + pose + vuelta) no se
  // programa otra: scheduleMovement guarda "a dónde volver" con el valor
  // actual del hueso, y a mitad de reacción ese valor ya es la pose -- se
  // quedaría torcida para siempre.
  const movementBusyUntilRef = useRef(0);
  // Expresión que había antes del primer toque de la racha actual.
  const baseExpressionRef = useRef<string | null>(null);
  const expressionTimerRef = useRef<number | null>(null);
  const recentTapsRef = useRef<number[]>([]);

  const hoverSamplesRef = useRef<{ t: number; x: number }[]>([]);
  const lastHoverRaycastRef = useRef(0);
  const lastHoverHitRef = useRef<TouchHit | null>(null);
  const isPettingRef = useRef(false);
  const petEndTimerRef = useRef<number | null>(null);
  // Huesos de la pose de caricia puesta (para soltarla al terminar), o
  // null si no hay ninguna puesta.
  const petPoseKeysRef = useRef<string[] | null>(null);
  const petDurationRef = useRef(PET_REACTION.durationMs);
  // La reacción de esta caricia (la de Miku o el respaldo), decidida una
  // sola vez al empezar.
  const petReactionRef = useRef<Reaction | null>(null);

  // Primera vez en esta zona (o situación): se le pide a Miku que diseñe su
  // reacción, en segundo plano. Mientras, se usa el respaldo -- desde el
  // próximo toque, la suya.
  // A8: con un ánimo distinto de neutral, es la primera vez que le pasa
  // ESTANDO ASÍ: diseña una variante, o dice que reacciona igual que siempre.
  function requestDesign(key: TouchReactionKey, side: "left" | "right" | null, mood: Mood = "neutral") {
    const flightKey = mood === "neutral" ? key : `${key}@${mood}`;
    if (designInFlightRef.current.has(flightKey)) return;
    if (Date.now() < (designRetryAfterRef.current[flightKey] ?? 0)) return;
    designInFlightRef.current.add(flightKey);

    (async () => {
      try {
        // Al arrancar, la memoria se baja de GitHub en paralelo con la
        // primera carga de este archivo: si la reacción llegó recién ahora
        // (diseñada en otra sesión), se usa esa y no se pide otra.
        await loadTouchReactions();
        if (mood === "neutral" ? getDesignedReaction(key) : !getReactionForMood(key, mood)?.needsVariant) return;
        const base = mood === "neutral" ? null : getDesignedReaction(key);

        const { world, personality, memories } = await loadMemoryContext();
        const today = new Date();
        const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const prompt = buildTouchReactionPrompt({
          world,
          personality,
          memories,
          todayIso,
          what: describeForDesign(key, side),
          sustained: key === "caricia",
          mood: MOOD_WORDS[mood],
          baseReaction: base ? describeReaction(base) : null,
        });
        const ask = async (messages: object[]) => {
          const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind: "tacto" });
          const data = await response.json();
          return String(data.choices?.[0]?.message?.content ?? "");
        };
        const firstReply = await ask([{ role: "system", content: prompt }]);

        // Decidió que, aun estando así, reacciona como siempre.
        // Si además dijo que, estando así, le cambia el ánimo, se guarda la
        // misma reacción con ese efecto (con "igual" se perdería).
        if (base && mood !== "neutral" && /\[IGUAL_QUE_SIEMPRE\]/i.test(firstReply)) {
          const sameMoodEffect = parseMoodMarker(firstReply);
          const { variantes: _omit, ...baseOnly } = base;
          await saveReactionVariant(
            key,
            mood,
            sameMoodEffect ? { ...baseOnly, moodEffect: sameMoodEffect, createdAt: new Date().toISOString() } : "igual",
          );
          console.log(`[Tacto] Estando ${mood}, Miku reacciona igual que siempre a "${key}"${sameMoodEffect ? ` (y la deja ${sameMoodEffect})` : ""}.`);
          if (sameMoodEffect && sameMoodEffect !== getCachedMood()) await setMood(sameMoodEffect, "tacto");
          await processMemoryMarkers(firstReply);
          return;
        }

        let design = interpretDesign(firstReply);
        if (!design.movement && !design.expression) {
          throw new Error(`respuesta sin [MOVIMIENTO] ni [EXPRESION]: ${firstReply.slice(0, 200)}`);
        }

        // Antes diseñaba a ciegas (así salió la de la falda con las manos
        // por detrás). Ahora ve cómo le queda, desde el reposo y en cuatro
        // vistas, y puede corregirla una vez antes de que se guarde. Si la
        // foto o la segunda consulta fallan, queda la primera versión.
        let revisedReply: string | null = null;
        const capture = getSelfViewCapturer();
        if (capture && design.movement) {
          try {
            const { image, bodySense } = capture("cuatro", "cuerpo", { ...design.movement, animated: false }, true);
            const sense = bodySense ? `\nMedido en tu cuerpo:\n${bodySense}\n` : "";
            const reviewText = `Así se vería tu cuerpo con esa reacción, ya terminada, desde cuatro ángulos: frente, tu izquierda, espalda y tu derecha${design.movement.animated ? " (es animada: esto es el extremo del vaivén)" : ""}.${sense} Si te convence tal cual, responde solo [LISTO]. Si quieres ajustarla, responde otra vez con la reacción completa ([EXPRESION] o [CARA], [MOVIMIENTO] y/o [LLEVAR_MANO]): reemplaza a la anterior. No repitas [GUARDAR_MEMORIA].`;
            const secondReply = await ask([
              { role: "system", content: prompt },
              { role: "assistant", content: firstReply },
              { role: "user", content: [{ type: "text", text: reviewText }, { type: "image_url", image_url: { url: image } }] },
            ]);
            const revised = interpretDesign(secondReply);
            if (revised.movement || revised.expression) {
              design = {
                movement: revised.movement,
                expression: revised.expression ?? design.expression,
                moodEffect: revised.moodEffect ?? design.moodEffect,
              };
              revisedReply = secondReply;
            }
          } catch (err) {
            console.warn(`[Tacto] No se pudo mostrarle la reacción "${key}"; queda la primera versión:`, err);
          }
        }

        const [minMs, maxMs] =
          key === "caricia" ? DESIGN_PET_DURATION_RANGE_MS : DESIGN_DURATION_RANGE_MS;
        const designed = {
          expression: design.expression,
          entries: design.movement?.entries ?? [],
          durationMs: Math.min(maxMs, Math.max(minMs, design.movement?.durationMs ?? 400)),
          animated: design.movement?.animated ?? false,
          side: SIDED_KEYS.includes(key) ? side : null,
          createdAt: new Date().toISOString(),
          moodEffect: design.moodEffect,
        };
        if (mood === "neutral") await saveDesignedReaction(key, designed);
        else await saveReactionVariant(key, mood, designed);
        // Lo diseñó para este toque: si decidió que le cambia el ánimo, ya
        // la cambia (sin esperar al próximo).
        if (design.moodEffect && design.moodEffect !== getCachedMood()) await setMood(design.moodEffect, "tacto");
        console.log(
          `[Tacto] Miku diseñó su reacción para "${key}"${mood !== "neutral" ? ` estando ${mood}` : ""}${revisedReply ? " (y la ajustó al verse)" : ""}:`,
          revisedReply ?? firstReply,
        );
        await processMemoryMarkers(firstReply);
        if (revisedReply) await processMemoryMarkers(revisedReply);
      } catch (err) {
        console.warn(`[Tacto] No se pudo diseñar la reacción para "${flightKey}"; se reintenta más tarde:`, err);
        designRetryAfterRef.current[flightKey] = Date.now() + DESIGN_RETRY_AFTER_MS;
      } finally {
        designInFlightRef.current.delete(flightKey);
      }
    })();
  }

  // La reacción de Miku para esa zona si ya la diseñó (espejada si la
  // diseñó del otro lado); si no, el respaldo, y se le pide que la diseñe.
  // A8: según su ánimo del momento. Si todavía no decidió cómo reacciona
  // estando así, se usa la de siempre y se le pregunta (en segundo plano).
  function resolveReaction(
    key: TouchReactionKey,
    side: "left" | "right" | null,
    fallback: Reaction,
  ): Reaction {
    const mood = getCachedMood();
    const found = getReactionForMood(key, mood);
    if (!found) {
      requestDesign(key, side);
      return fallback;
    }
    if (found.needsVariant) requestDesign(key, side, mood);
    const designed = found.reaction;
    const needsMirror = designed.side !== null && side !== null && designed.side !== side;
    return {
      expression: designed.expression,
      entries: needsMirror ? mirrorEntries(designed.entries) : designed.entries,
      durationMs: designed.durationMs,
      animated: designed.animated,
      holdMs: fallback.holdMs,
      description: fallback.description,
      moodEffect: designed.moodEffect ?? null,
    };
  }

  // Lo que se anota del toque (se lo cuento en la próxima charla), con el
  // cambio de ánimo si lo hubo.
  function touchNote(reaction: Reaction): string {
    return reaction.moodEffect && reaction.moodEffect !== getCachedMood()
      ? `${reaction.description} (y eso te dejó ${MOOD_WORDS[reaction.moodEffect as Mood] ?? reaction.moodEffect})`
      : reaction.description;
  }

  // A8: el tacto le cambia el ánimo solo si ella lo decidió al diseñar la
  // reacción (y solo si no está ya así).
  function applyMoodEffect(reaction: Reaction) {
    if (reaction.moodEffect && reaction.moodEffect !== getCachedMood()) {
      setMood(reaction.moodEffect, "tacto").catch((err) => console.error("Error cambiando el ánimo:", err));
    }
  }

  function detect(clientX: number, clientY: number): TouchHit | null {
    const vrm = vrmRef.current;
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    if (!vrm || !camera || !canvas) return null;
    return detectTouchZone(vrm, camera, canvas, clientX, clientY);
  }

  function showExpression(expression: string, forMs: number) {
    if (baseExpressionRef.current === null) {
      baseExpressionRef.current = getExpression();
    }
    setExpression(expression);
    if (expressionTimerRef.current !== null) clearTimeout(expressionTimerRef.current);
    expressionTimerRef.current = window.setTimeout(() => {
      expressionTimerRef.current = null;
      const base = baseExpressionRef.current ?? "neutral";
      baseExpressionRef.current = null;
      // Si mientras tanto empezó a hablar (y puso su propia expresión), no
      // se pisa: speak() la maneja.
      if (getExpression() === expression && !isSpeakingRef.current) {
        setExpression(base);
      }
    }, forMs);
  }

  function play(reaction: Reaction) {
    const now = performance.now();
    applyMoodEffect(reaction);
    if (reaction.expression) {
      showExpression(reaction.expression, reaction.durationMs + reaction.holdMs);
    }
    if (now < movementBusyUntilRef.current || reaction.entries.length === 0) return;
    scheduleMovement(
      {
        entries: reaction.entries,
        durationMs: reaction.durationMs,
        animated: reaction.animated ?? false,
      },
      "idle",
      reaction.holdMs,
    );
    movementBusyUntilRef.current = now + reaction.durationMs * 2 + reaction.holdMs;
  }

  // Clic sin arrastrar sobre el modelo (ver App.tsx: el arrastre mueve la
  // ventana). Devuelve si tocó a Miku, por si hace falta saberlo.
  // Sebastián agitó la ventana (ver useWindowWind): gana aunque haya otra
  // reacción en curso, como el hartazgo.
  const lastShakeAtRef = useRef(0);
  function handleShake() {
    const now = performance.now();
    if (now - lastShakeAtRef.current < SHAKE_COOLDOWN_MS) return;
    lastShakeAtRef.current = now;
    onInteraction();
    movementBusyUntilRef.current = 0;
    const reaction = resolveReaction("agitar", null, SHAKE_REACTION);
    recordTouch(touchNote(reaction));
    play(reaction);
  }

  function handleTap(clientX: number, clientY: number): boolean {
    const hit = detect(clientX, clientY);
    if (!hit) return false;
    onInteraction();

    const now = performance.now();
    recentTapsRef.current = [
      ...recentTapsRef.current.filter((t) => now - t < ANNOYED_WINDOW_MS),
      now,
    ];
    if (recentTapsRef.current.length >= ANNOYED_TAP_COUNT) {
      recentTapsRef.current = [];
      // Hartazgo: gana aunque haya otra reacción en curso.
      movementBusyUntilRef.current = 0;
      const annoyed = resolveReaction("harta", null, ANNOYED_REACTION);
      recordTouch(touchNote(annoyed));
      play(annoyed);
      return true;
    }

    const key: TouchReactionKey = hit.zone;
    const reaction = resolveReaction(
      key,
      SIDED_KEYS.includes(key) ? hit.side : null,
      reactionFor(hit.zone, hit.side),
    );
    recordTouch(touchNote(reaction));
    play(reaction);
    return true;
  }

  function endPetting() {
    petEndTimerRef.current = null;
    isPettingRef.current = false;
    hoverSamplesRef.current = [];
    const poseKeys = petPoseKeysRef.current;
    if (poseKeys) {
      petPoseKeysRef.current = null;
      releaseQuirkRevertsNow(poseKeys);
      movementBusyUntilRef.current = performance.now() + petDurationRef.current;
    }
  }

  // Movimiento del mouse sin botón apretado sobre el canvas.
  function handleHover(clientX: number, clientY: number) {
    const now = performance.now();
    if (now - lastHoverRaycastRef.current >= HOVER_RAYCAST_INTERVAL_MS) {
      lastHoverRaycastRef.current = now;
      lastHoverHitRef.current = detect(clientX, clientY);
    }
    if (lastHoverHitRef.current?.zone !== "cabeza") return;

    const samples = [...hoverSamplesRef.current, { t: now, x: clientX }].filter(
      (sample) => now - sample.t <= PET_WINDOW_MS,
    );
    hoverSamplesRef.current = samples;

    if (petEndTimerRef.current !== null) clearTimeout(petEndTimerRef.current);
    petEndTimerRef.current = window.setTimeout(endPetting, PET_END_MS);

    if (!isPettingRef.current) {
      let distance = 0;
      let reversals = 0;
      let lastDirection = 0;
      for (let i = 1; i < samples.length; i++) {
        const dx = samples[i].x - samples[i - 1].x;
        distance += Math.abs(dx);
        if (Math.abs(dx) < 2) continue;
        const direction = Math.sign(dx);
        if (lastDirection !== 0 && direction !== lastDirection) reversals++;
        lastDirection = direction;
      }
      if (distance < PET_MIN_DISTANCE_PX || reversals < PET_MIN_REVERSALS) return;
      isPettingRef.current = true;
      petReactionRef.current = resolveReaction("caricia", null, PET_REACTION);
      onInteraction();
      // Una por caricia, no por cada ciclo de reacción (el anotado y el
      // cambio de ánimo, si ella lo decidió).
      recordTouch(touchNote(petReactionRef.current));
      applyMoodEffect(petReactionRef.current);
    }

    // Mientras dure: la expresión se sostiene (cada movimiento del mouse
    // la renueva) y la pose se pone una sola vez, sin vuelta automática.
    // Si justo había otra reacción en curso, se pone apenas termine.
    const pet = petReactionRef.current ?? PET_REACTION;
    if (pet.expression) {
      showExpression(pet.expression, PET_END_MS + pet.durationMs);
    }
    if (!petPoseKeysRef.current && pet.entries.length > 0 && now >= movementBusyUntilRef.current) {
      scheduleMovement(
        { entries: pet.entries, durationMs: pet.durationMs, animated: pet.animated ?? false },
        "idle",
        PET_HOLD_UNTIL_RELEASED_MS,
      );
      petPoseKeysRef.current = pet.entries.map((e) => `${e.bone}.${e.axis}`);
      petDurationRef.current = pet.durationMs;
      movementBusyUntilRef.current = Infinity;
    }
  }

  return { handleTap, handleHover, handleShake };
}
