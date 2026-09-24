import { RefObject, useRef } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { MovementOrigin, ParsedMovement } from "../types";
import { detectTouchZone, TouchHit, TouchZone } from "../lib/touch";
import { recordTouch } from "../lib/touchLog";

type UseTouchReactionsParams = {
  vrmRef: RefObject<VRM | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scheduleMovement: (
    parsed: ParsedMovement,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) => void;
  getExpression: () => string;
  setExpression: (name: string) => void;
  isSpeakingRef: RefObject<boolean>;
  // Tocarla cuenta como interacción: reinicia el contador de los quirks idle.
  onInteraction: () => void;
};

type Reaction = {
  expression: string;
  entries: ParsedMovement["entries"];
  durationMs: number;
  // Cuánto se sostiene la pose antes de volver sola (y la expresión).
  holdMs: number;
  description: string;
};

// Signos: los mismos de la tabla de ejes que ya usa Miku en su prompt
// (systemPrompt.ts, calibrada con renders reales) -- x > 0 mira arriba /
// se echa hacia atrás, y > 0 gira hacia SU izquierda, z > 0 ladea hacia
// SU izquierda. (Los huesos normalizados de un VRM0 miran hacia -z en su
// propio espacio; la escena entera está girada 180° para que mire a la
// cámara.)
// Se usan cuello y columna, no "head": la cabeza tiene su propio balanceo
// ambiente (useMovement.updateMovement) y una transición sobre ella lo
// apagaría para siempre.
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
          { bone: "neck", axis: "y", intensity: -40 * s },
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
          { bone: "neck", axis: "y", intensity: 45 * s },
          { bone: "neck", axis: "x", intensity: -30 },
        ],
        durationMs: 400,
        holdMs: 1000,
        description: "te tocó la mano",
      };
    case "brazo":
      return {
        expression: "happy",
        entries: [{ bone: "neck", axis: "y", intensity: 35 * s }],
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

// Muchos toques seguidos, en cualquier lado: se harta y mira para otro lado.
const ANNOYED_TAP_COUNT = 5;
const ANNOYED_WINDOW_MS = 6000;
const ANNOYED_REACTION: Reaction = {
  expression: "angry",
  entries: [
    { bone: "neck", axis: "y", intensity: -60 },
    { bone: "spine", axis: "y", intensity: -40 },
  ],
  durationMs: 400,
  holdMs: 1500,
  description: "te tocó muchas veces seguidas hasta hartarte",
};

// Caricia: se apoya en la mano y cierra un poco los ojos. Se repite en
// ciclos mientras sigan acariciando.
const PET_REACTION: Reaction = {
  expression: "relaxed",
  entries: [
    { bone: "neck", axis: "z", intensity: 45 },
    { bone: "neck", axis: "x", intensity: -35 },
  ],
  durationMs: 500,
  holdMs: 1400,
  description: "te acarició la cabeza",
};

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
  getExpression,
  setExpression,
  isSpeakingRef,
  onInteraction,
}: UseTouchReactionsParams) {
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
    showExpression(reaction.expression, reaction.durationMs + reaction.holdMs);
    if (now < movementBusyUntilRef.current) return;
    scheduleMovement(
      { entries: reaction.entries, durationMs: reaction.durationMs, animated: false },
      "idle",
      reaction.holdMs,
    );
    movementBusyUntilRef.current = now + reaction.durationMs * 2 + reaction.holdMs;
  }

  // Clic sin arrastrar sobre el modelo (ver App.tsx: el arrastre mueve la
  // ventana). Devuelve si tocó a Miku, por si hace falta saberlo.
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
      recordTouch(ANNOYED_REACTION.description);
      // Hartazgo: gana aunque haya otra reacción en curso.
      movementBusyUntilRef.current = 0;
      play(ANNOYED_REACTION);
      return true;
    }

    const reaction = reactionFor(hit.zone, hit.side);
    recordTouch(reaction.description);
    play(reaction);
    return true;
  }

  function endPetting() {
    petEndTimerRef.current = null;
    isPettingRef.current = false;
    hoverSamplesRef.current = [];
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
      onInteraction();
      // Una por caricia, no por cada ciclo de reacción.
      recordTouch(PET_REACTION.description);
    }

    // Mientras dure: la expresión se sostiene, y la pose se repite en
    // ciclos (se apoya en la mano, se relaja, se vuelve a apoyar).
    play(PET_REACTION);
  }

  return { handleTap, handleHover };
}
