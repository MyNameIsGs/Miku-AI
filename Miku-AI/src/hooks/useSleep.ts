import { RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ParsedMovement } from "../types";
import { loadMemoryContext } from "../lib/memory";
import { isGameModeActive } from "../lib/gameMode";
import { designWithSelfView } from "../lib/designMoment";
import {
  SleepDesign,
  SleepMoment,
  getSleepDesign,
  loadSleepDesigns,
  saveSleepDesign,
} from "../lib/sleepStore";
import { buildSleepDesignPrompt } from "../prompts/sleepPrompt";

// Punto 3 del plan: Miku se duerme cuando Sebastián no está, y se despierta
// cuando vuelve. Cómo se duerme y cómo se despierta lo diseña ella la
// primera vez que le pasa (ver lib/sleepStore.ts y lib/designMoment.ts).
//
// Mientras duerme no se consulta al modelo en los silencios (eso ya lo
// pausa useIdleQuirks cuando él no está).

// Tiempo sin teclado, mouse ni charla para dormirse (de noche, antes).
const SLEEP_AFTER_MS = 30 * 60 * 1000;
const SLEEP_AFTER_NIGHT_MS = 15 * 60 * 1000;
const isNight = (date: Date) => date.getHours() >= 23 || date.getHours() < 7;
// Cada cuánto se revisa (dormida, más seguido: tiene que despertar rápido).
const CHECK_AWAKE_EVERY_MS = 5000;
const CHECK_ASLEEP_EVERY_MS = 1500;
// Menos que esto sin input = volvió.
const BACK_IF_IDLE_UNDER_S = 3;
// La pose de dormir se programa con una vuelta muy lejana y se adelanta al
// despertar (mismo truco que la caricia, ver releaseQuirkRevertsNow).
const HOLD_WHILE_ASLEEP_MS = 24 * 60 * 60 * 1000;
// Duraciones aceptadas para lo que diseñe (dormirse es lento; si es
// animado, es el período de la respiración o el cabeceo).
const DURATION_RANGE_MS: Record<SleepMoment, [number, number]> = {
  dormir: [800, 6000],
  despertar: [300, 2500],
};
// Si el diseño falla, no se reintenta enseguida.
const DESIGN_RETRY_AFTER_MS = 10 * 60 * 1000;

type UseSleepParams = {
  scheduleMovement: (parsed: ParsedMovement, origin: "idle", autoRevertDelayMs?: number) => void;
  releaseQuirkRevertsNow: (keys: string[]) => void;
  revertAnimatedBonesExcept: (keepKeys: string[]) => void;
  getExpression: () => string;
  setExpression: (name: string) => void;
  showExpressionFor: (expression: string, forMs: number) => void;
  isSpeakingRef: RefObject<boolean>;
  lastInteractionTimeRef: RefObject<number>;
  processMemoryMarkers: (reply: string) => Promise<void>;
};

const movementOf = (design: SleepDesign): ParsedMovement | null =>
  design.entries.length > 0
    ? { entries: design.entries, durationMs: design.durationMs, animated: design.animated }
    : null;

export function useSleep({
  scheduleMovement,
  releaseQuirkRevertsNow,
  revertAnimatedBonesExcept,
  getExpression,
  setExpression,
  showExpressionFor,
  isSpeakingRef,
  lastInteractionTimeRef,
  processMemoryMarkers,
}: UseSleepParams) {
  const asleepRef = useRef(false);
  const sleptAtRef = useRef(0);
  const poseKeysRef = useRef<string[]>([]);
  const sleepFaceRef = useRef<string | null>(null);
  const faceBeforeRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);
  const designInFlightRef = useRef(new Set<SleepMoment>());
  const designRetryAfterRef = useRef<Partial<Record<SleepMoment, number>>>({});

  useEffect(() => {
    loadSleepDesigns();
  }, []);

  function playSleep(design: SleepDesign) {
    const movement = movementOf(design);
    if (movement) {
      const keys = movement.entries.map((e) => `${e.bone}.${e.axis}`);
      revertAnimatedBonesExcept(keys);
      scheduleMovement(movement, "idle", HOLD_WHILE_ASLEEP_MS);
      poseKeysRef.current = keys;
    }
    if (design.expression) {
      faceBeforeRef.current = getExpression();
      sleepFaceRef.current = design.expression;
      setExpression(design.expression);
    }
  }

  // Se le pregunta cómo se duerme / se despierta, en ese momento real.
  async function requestDesign(moment: SleepMoment): Promise<SleepDesign | null> {
    if (designInFlightRef.current.has(moment)) return null;
    if (Date.now() < (designRetryAfterRef.current[moment] ?? 0)) return null;
    designInFlightRef.current.add(moment);
    try {
      // Pudo llegar recién por GitHub (diseñado en otra sesión).
      await loadSleepDesigns();
      const existing = getSleepDesign(moment);
      if (existing) return existing;

      const { world, personality, memories } = await loadMemoryContext();
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const timeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const prompt = buildSleepDesignPrompt({ world, personality, memories, todayIso, timeLabel, moment });
      const result = await designWithSelfView(prompt, "diseñar sueño");
      if (!result) throw new Error("sin respuesta");
      for (const reply of result.replies) await processMemoryMarkers(reply);
      const { design, replies } = result;
      if (!design.movement && !design.expression) {
        throw new Error(`respuesta sin [MOVIMIENTO] ni [EXPRESION]: ${replies[0].slice(0, 200)}`);
      }
      const [minMs, maxMs] = DURATION_RANGE_MS[moment];
      const saved = {
        expression: design.expression,
        entries: design.movement?.entries ?? [],
        durationMs: Math.min(maxMs, Math.max(minMs, design.movement?.durationMs ?? minMs)),
        animated: design.movement?.animated ?? false,
        createdAt: new Date().toISOString(),
      };
      await saveSleepDesign(moment, saved);
      console.log(`[Sueño] Miku diseñó cómo se ${moment === "dormir" ? "duerme" : "despierta"}:`, replies[replies.length - 1]);
      return getSleepDesign(moment);
    } catch (err) {
      console.warn(`[Sueño] No se pudo diseñar "${moment}"; se reintenta más tarde:`, err);
      designRetryAfterRef.current[moment] = Date.now() + DESIGN_RETRY_AFTER_MS;
      return null;
    } finally {
      designInFlightRef.current.delete(moment);
    }
  }

  function fallAsleep() {
    asleepRef.current = true;
    sleptAtRef.current = performance.now();
    console.log("[Sueño] Miku se quedó dormida.");
    const design = getSleepDesign("dormir");
    if (design) {
      playSleep(design);
    } else {
      // La primera vez: lo diseña ahora y se duerme así (si sigue dormida).
      requestDesign("dormir").then((designed) => {
        if (designed && asleepRef.current) playSleep(designed);
      });
    }
  }

  // Volvió (o le habló, o la tocó): se despierta.
  function wakeUp(reason: string) {
    if (!asleepRef.current) return;
    asleepRef.current = false;
    console.log(`[Sueño] Miku se despertó (${reason}).`);
    releaseQuirkRevertsNow(poseKeysRef.current);
    poseKeysRef.current = [];
    if (sleepFaceRef.current && getExpression() === sleepFaceRef.current) {
      setExpression(faceBeforeRef.current ?? "neutral");
    }
    sleepFaceRef.current = null;

    const wake = getSleepDesign("despertar");
    if (wake) {
      const movement = movementOf(wake);
      if (movement) scheduleMovement(movement, "idle", movement.durationMs);
      if (wake.expression) showExpressionFor(wake.expression, wake.durationMs * 2 + 1200);
    } else {
      // Esta vez vuelve a su postura sin más; se le pregunta para la próxima.
      requestDesign("despertar");
    }
  }

  // Se llama en cada cuadro (liviano: la consulta a Windows es cada tanto).
  function check(now: number) {
    const every = asleepRef.current ? CHECK_ASLEEP_EVERY_MS : CHECK_AWAKE_EVERY_MS;
    if (now - lastCheckRef.current < every) return;
    lastCheckRef.current = now;

    // Si algo le cambió la cara mientras duerme (un recordatorio hablado),
    // vuelve a la de dormir.
    if (
      asleepRef.current &&
      sleepFaceRef.current &&
      !isSpeakingRef.current &&
      getExpression() !== sleepFaceRef.current
    ) {
      setExpression(sleepFaceRef.current);
    }

    invoke<number>("segundos_sin_usar_pc")
      .then((idleSeconds) => {
        const lastTalk = lastInteractionTimeRef.current ?? 0;
        if (asleepRef.current) {
          if (idleSeconds < BACK_IF_IDLE_UNDER_S) wakeUp("volvió al teclado o al mouse");
          else if (lastTalk > sleptAtRef.current) wakeUp("le hablaron");
          return;
        }
        const sleepAfter = isNight(new Date()) ? SLEEP_AFTER_NIGHT_MS : SLEEP_AFTER_MS;
        if (
          idleSeconds * 1000 >= sleepAfter &&
          performance.now() - lastTalk >= sleepAfter &&
          !isGameModeActive()
        ) {
          fallAsleep();
        }
      })
      .catch(() => {});
  }

  return { check, wakeUp, asleepRef };
}
