import { useRef, RefObject } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import {
  EXPRESSION_SMOOTHING,
  GAZE_SMOOTHING,
  DOUBLE_BLINK_CHANCE,
} from "../config/constants";

const GAZE_OFFSETS: Record<string, { x: number; y: number }> = {
  lookUp: { x: 0, y: 0.7 },
  lookDown: { x: 0, y: -0.7 },
  lookLeft: { x: 0.7, y: 0 },
  lookRight: { x: -0.7, y: 0 },
};

const VISEME_SHAPES = ["aa", "ih", "ou", "ee", "oh"];

type UseFaceParams = {
  vrmRef: RefObject<VRM | null>;
  gazeTargetObjectRef: RefObject<THREE.Object3D | null>;
};

export function useFace({ vrmRef, gazeTargetObjectRef }: UseFaceParams) {
  const activeExpressionRef = useRef<string>("neutral");
  // Escrito por quien reproduce el audio (hoy speak() en App.tsx), leído
  // acá para pausar la mirada errante mientras Miku habla.
  const isSpeakingRef = useRef(false);

  const expressionWeightsRef = useRef<Record<string, number>>({
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
  });
  const blinkStateRef = useRef({
    nextBlinkTime: 2 + Math.random() * 3,
    blinkElapsed: 0,
    isBlinking: false,
    currentBlinkDuration: 0.15,
    doubleBlinkPending: false,
  });
  const gazeStateRef = useRef({
    offsetCurrent: { x: 0, y: 0 },
    target: null as string | null,
    nextChangeTime: 3 + Math.random() * 4,
  });
  const visemeWeightsRef = useRef<Record<string, number>>({
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
  });

  function setExpression(name: string) {
    activeExpressionRef.current = name;
  }

  // Un paso de suavizado hacia targetShape -- se llama una vez por tick
  // del rAF de lipsync (hoy dentro de speak() en App.tsx, mientras dura
  // el audio), igual que hacía updateMouthFromVisemes antes de moverse.
  function setViseme(targetShape: string) {
    const expressionManager = vrmRef.current?.expressionManager;
    if (!expressionManager) return;
    const smoothing = 0.7;
    const maxIntensity = 1;
    const visemeWeights = visemeWeightsRef.current;
    for (const shape of VISEME_SHAPES) {
      const target = shape === targetShape ? maxIntensity : 0;
      visemeWeights[shape] += (target - visemeWeights[shape]) * smoothing;
      expressionManager.setValue(shape, visemeWeights[shape]);
    }
  }

  // Reset duro (sin suavizar) al terminar el audio.
  function resetVisemes() {
    const expressionManager = vrmRef.current?.expressionManager;
    for (const shape of VISEME_SHAPES) {
      visemeWeightsRef.current[shape] = 0;
      expressionManager?.setValue(shape, 0);
    }
  }

  // Corre dentro de onBeforeRender, antes de vrm.update(delta) -- ver el
  // contrato del loop en useVRMScene. No usa "now" (los temporizadores de
  // parpadeo/mirada se miden con delta), pero se mantiene el parámetro
  // (como _now) para la misma firma que updateMovement(now, delta, ...).
  //
  // Recordatorio: lookUp/lookDown/lookLeft/lookRight están vacíos en este
  // .vrm (0 binds). La mirada se resuelve solo con vrm.lookAt.target -- no
  // reintroducir esas expresiones.
  function updateFace(_now: number, delta: number) {
    const expressionManager = vrmRef.current?.expressionManager;
    if (!expressionManager) return;

    const expressionWeights = expressionWeightsRef.current;
    const blinkState = blinkStateRef.current;
    const expressionActive =
      activeExpressionRef.current !== "neutral" ||
      Object.values(expressionWeights).some((w) => w > 0.05);

    if (!blinkState.isBlinking) {
      if (!expressionActive) {
        blinkState.nextBlinkTime -= delta;
        if (blinkState.nextBlinkTime <= 0) {
          blinkState.isBlinking = true;
          blinkState.blinkElapsed = 0;
          blinkState.currentBlinkDuration = 0.12 + Math.random() * 0.08;
        }
      }
    } else {
      blinkState.blinkElapsed += delta;
      const t = blinkState.blinkElapsed / blinkState.currentBlinkDuration;
      const blinkValue = t < 0.5 ? t * 2 : (1 - t) * 2;
      expressionManager.setValue(
        "blink",
        Math.max(0, Math.min(1, blinkValue)),
      );

      if (blinkState.blinkElapsed >= blinkState.currentBlinkDuration) {
        blinkState.isBlinking = false;
        expressionManager.setValue("blink", 0);

        if (blinkState.doubleBlinkPending) {
          blinkState.doubleBlinkPending = false;
          blinkState.nextBlinkTime = 0.1 + Math.random() * 0.15;
        } else {
          blinkState.doubleBlinkPending = Math.random() < DOUBLE_BLINK_CHANCE;
          blinkState.nextBlinkTime = 2 + Math.random() * 4;
        }
      }
    }
    const targetExpression = activeExpressionRef.current;
    for (const shape of Object.keys(expressionWeights)) {
      const target = shape === targetExpression ? 1 : 0;
      expressionWeights[shape] +=
        (target - expressionWeights[shape]) * EXPRESSION_SMOOTHING;
      expressionManager.setValue(shape, expressionWeights[shape]);
    }

    const gazeTargetObject = gazeTargetObjectRef.current;
    if (gazeTargetObject) {
      const gazeState = gazeStateRef.current;
      if (!isSpeakingRef.current) {
        gazeState.nextChangeTime -= delta;
        if (gazeState.nextChangeTime <= 0) {
          const directions = [
            "center",
            "lookUp",
            "lookDown",
            "lookLeft",
            "lookRight",
          ];
          const choice =
            directions[Math.floor(Math.random() * directions.length)];
          gazeState.target = choice === "center" ? null : choice;
          gazeState.nextChangeTime = 3 + Math.random() * 5;
        }
      } else {
        gazeState.target = null;
      }

      const targetOffset = gazeState.target
        ? GAZE_OFFSETS[gazeState.target]
        : { x: 0, y: 0 };
      gazeState.offsetCurrent.x +=
        (targetOffset.x - gazeState.offsetCurrent.x) * GAZE_SMOOTHING;
      gazeState.offsetCurrent.y +=
        (targetOffset.y - gazeState.offsetCurrent.y) * GAZE_SMOOTHING;
      gazeTargetObject.position.x = gazeState.offsetCurrent.x;
      gazeTargetObject.position.y = 1.4 + gazeState.offsetCurrent.y;
    }
  }

  return {
    isSpeakingRef,
    setExpression,
    setViseme,
    resetVisemes,
    updateFace,
  };
}
