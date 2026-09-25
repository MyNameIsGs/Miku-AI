import { useRef, RefObject } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import {
  EXPRESSION_SMOOTHING,
  GAZE_SMOOTHING,
  DOUBLE_BLINK_CHANCE,
} from "../config/constants";
import { FACE_PARTS, decodeFace, faceExpressionName, registerFaceParts } from "../lib/faceParts";
import { invoke } from "@tauri-apps/api/core";

const GAZE_OFFSETS: Record<string, { x: number; y: number }> = {
  lookUp: { x: 0, y: 0.7 },
  lookDown: { x: 0, y: -0.7 },
  lookLeft: { x: 0.7, y: 0 },
  lookRight: { x: -0.7, y: 0 },
};

// Seguir el cursor es más rápido que la mirada errante (que es un paseo
// lento de los ojos): tiene que sentirse como que lo sigue con la vista.
const CURSOR_GAZE_SMOOTHING = 0.15;

// Expresiones armadas que cierran los ojos (ver updateFace).
const EYE_CLOSING_EXPRESSIONS = ["happy", "relaxed"];

const VISEME_SHAPES = ["aa", "ih", "ou", "ee", "oh"];
// Cuánto tarda la boca en recorrer la mitad del camino hacia la forma
// siguiente (ver setViseme). Más alto = más suave pero más "perezosa":
// si se pasa, las vocales cortas no llegan a formarse del todo.
const VISEME_HALF_LIFE_MS = 30;

type UseFaceParams = {
  vrmRef: RefObject<VRM | null>;
  gazeTargetObjectRef: RefObject<THREE.Object3D | null>;
};

export function useFace({ vrmRef, gazeTargetObjectRef }: UseFaceParams) {
  const activeExpressionRef = useRef<string>("neutral");
  // Escrito por quien reproduce el audio (hoy speak() en App.tsx), leído
  // aquí para pausar la mirada errante mientras Miku habla.
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
  // Diagnóstico del parpadeo (Sebastián dijo que "no parece funcionar", y en
  // el banco sí funciona): cuánto se cierra DE VERDAD el párpado en el
  // modelo en cada parpadeo, y con qué expresión. Resumen una vez por minuto.
  const blinkDiagRef = useRef({
    mesh: null as THREE.Mesh | null,
    morphIndex: -1,
    windowStart: 0,
    blinks: 0,
    closures: [] as number[],
    currentMax: 0,
    wasBlinking: false,
    expressions: {} as Record<string, number>,
  });
  // [CARA] (ver lib/faceParts.ts): peso actual de cada parte, suavizado
  // igual que las expresiones. Se registran en el VRM la primera vez.
  const facePartWeightsRef = useRef<Record<string, number>>(
    Object.fromEntries(Object.keys(FACE_PARTS).map((part) => [part, 0])),
  );
  const facePartsRegisteredRef = useRef(false);
  // Punto del mundo al que mirar en vez de la mirada errante (el cursor
  // cuando pasa cerca de ella, ver useCursorGaze.ts), o null.
  const gazeOverrideRef = useRef<THREE.Vector3 | null>(null);
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

  // Tarea 8.12: la reacción al tacto cambia la expresión un momento y
  // después tiene que devolver la que había -- necesita leerla.
  function getExpression(): string {
    return activeExpressionRef.current;
  }

  // Un paso de suavizado hacia targetShape -- se llama una vez por tick
  // del rAF de lipsync (hoy dentro de speak() en App.tsx, mientras dura
  // el audio), igual que hacía updateMouthFromVisemes antes de moverse.
  //
  // Suavizado por TIEMPO, no por cuadro: antes era un 70% del camino por
  // cuadro (llegaba en ~50 ms, y más brusco cuanto más FPS). Con la boca
  // armada desde el texto (una forma por letra, ~70 ms cada una) eso se
  // veía a saltos -- pidió Sebastián suavizarlo. Ahora cada forma se funde
  // con la siguiente: tarda VISEME_HALF_LIFE_MS en recorrer la mitad del
  // camino, a cualquier frame rate.
  const lastVisemeUpdateRef = useRef<number | null>(null);
  function setViseme(targetShape: string) {
    const expressionManager = vrmRef.current?.expressionManager;
    if (!expressionManager) return;
    const now = performance.now();
    // Primer cuadro del audio (o después de una pausa larga del bucle): un
    // paso de un cuadro normal, no un salto.
    const elapsedMs =
      lastVisemeUpdateRef.current === null ? 16 : Math.min(100, now - lastVisemeUpdateRef.current);
    lastVisemeUpdateRef.current = now;
    const blend = 1 - Math.pow(0.5, elapsedMs / VISEME_HALF_LIFE_MS);
    const maxIntensity = 1;
    const visemeWeights = visemeWeightsRef.current;
    for (const shape of VISEME_SHAPES) {
      const target = shape === targetShape ? maxIntensity : 0;
      visemeWeights[shape] += (target - visemeWeights[shape]) * blend;
      expressionManager.setValue(shape, visemeWeights[shape]);
    }
  }

  // Reset duro (sin suavizar) al terminar el audio.
  function resetVisemes() {
    lastVisemeUpdateRef.current = null;
    const expressionManager = vrmRef.current?.expressionManager;
    for (const shape of VISEME_SHAPES) {
      visemeWeightsRef.current[shape] = 0;
      expressionManager?.setValue(shape, 0);
    }
  }

  // Lee cuánto quedó cerrado el párpado en el cuadro anterior (lo que de
  // verdad se dibujó, después de overrideBlink) y arma el resumen.
  function traceBlink(now: number, isBlinking: boolean) {
    const diag = blinkDiagRef.current;
    const vrm = vrmRef.current;
    if (!vrm) return;
    if (!diag.mesh) {
      vrm.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const index = mesh.isMesh ? mesh.morphTargetDictionary?.["まばたき"] : undefined;
        if (!diag.mesh && index !== undefined) {
          diag.mesh = mesh;
          diag.morphIndex = index;
        }
      });
      diag.windowStart = now;
      if (!diag.mesh) return;
    }
    // El párpado de ESTE cuadro refleja lo que se pidió en el anterior.
    const closure = diag.mesh.morphTargetInfluences?.[diag.morphIndex] ?? 0;
    if (isBlinking && !diag.wasBlinking) {
      // Empieza un parpadeo: se cuenta con la expresión de ese momento.
      diag.blinks++;
      diag.currentMax = 0;
      const expr = activeExpressionRef.current.startsWith("cara:") ? "cara" : activeExpressionRef.current;
      diag.expressions[expr] = (diag.expressions[expr] ?? 0) + 1;
    }
    if (isBlinking || diag.wasBlinking) diag.currentMax = Math.max(diag.currentMax, closure);
    if (!isBlinking && diag.wasBlinking) diag.closures.push(diag.currentMax);
    diag.wasBlinking = isBlinking;
    if (now - diag.windowStart >= 60_000) {
      const seen = diag.closures.filter((c) => c > 0.5).length;
      const avg = diag.closures.length ? diag.closures.reduce((a, b) => a + b, 0) / diag.closures.length : 0;
      const exprs = Object.entries(diag.expressions).map(([e, n]) => `${e} ${n}`).join(", ") || "-";
      const msg = `[Parpadeo] último minuto: ${diag.blinks} parpadeos, ${seen} con el ojo cerrado de verdad (cierre medio ${Math.round(avg * 100)}%); expresiones: ${exprs}`;
      console.log(msg);
      invoke("log_to_terminal", { msg }).catch(() => {});
      diag.windowStart = now;
      diag.blinks = 0;
      diag.closures = [];
      diag.expressions = {};
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
    traceBlink(_now, blinkState.isBlinking);

    // Parpadea siempre, también con una expresión puesta (antes no: con una
    // expresión activa -- o sea, casi siempre que hablaba -- tenía los ojos
    // fijos). Las expresiones que cierran los ojos apagan el parpadeo solas,
    // en la misma medida (overrideBlink), así no se superponen.
    if (!blinkState.isBlinking) {
      blinkState.nextBlinkTime -= delta;
      if (blinkState.nextBlinkTime <= 0) {
        blinkState.isBlinking = true;
        blinkState.blinkElapsed = 0;
        blinkState.currentBlinkDuration = 0.12 + Math.random() * 0.08;
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
    // Una cara hecha de partes ([CARA]) reemplaza a la expresión armada.
    const faceParts = decodeFace(activeExpressionRef.current);
    const targetExpression = faceParts ? "neutral" : activeExpressionRef.current;
    for (const shape of Object.keys(expressionWeights)) {
      const target = shape === targetExpression ? 1 : 0;
      expressionWeights[shape] +=
        (target - expressionWeights[shape]) * EXPRESSION_SMOOTHING;
      expressionManager.setValue(shape, expressionWeights[shape]);
    }
    if (!facePartsRegisteredRef.current && vrmRef.current) {
      registerFaceParts(vrmRef.current);
      // "happy" cierra los ojos en >< y "relaxed" en ^^ (medido en render):
      // mientras estén puestas, el parpadeo se apaga en la misma medida, en
      // vez de superponerse a unos ojos ya cerrados.
      for (const name of EYE_CLOSING_EXPRESSIONS) {
        const expression = expressionManager.getExpression(name);
        if (expression) expression.overrideBlink = "blend";
      }
      facePartsRegisteredRef.current = true;
    }
    const partWeights = facePartWeightsRef.current;
    for (const part of Object.keys(partWeights)) {
      const target = faceParts?.[part] ?? 0;
      partWeights[part] += (target - partWeights[part]) * EXPRESSION_SMOOTHING;
      expressionManager.setValue(faceExpressionName(part), partWeights[part]);
    }

    const gazeTargetObject = gazeTargetObjectRef.current;
    const gazeOverride = gazeOverrideRef.current;
    if (gazeTargetObject && gazeOverride) {
      // Sigue al cursor. La mirada errante queda sincronizada con donde
      // está mirando, para que al soltar el cursor vuelva sin saltar.
      const position = gazeTargetObject.position;
      position.lerp(gazeOverride, CURSOR_GAZE_SMOOTHING);
      gazeStateRef.current.offsetCurrent.x = position.x;
      gazeStateRef.current.offsetCurrent.y = position.y - 1.4;
      gazeStateRef.current.target = null;
    } else if (gazeTargetObject) {
      const gazeState = gazeStateRef.current;
      // Volver a la distancia de siempre si venía de mirar el cursor.
      gazeTargetObject.position.z += (1 - gazeTargetObject.position.z) * GAZE_SMOOTHING;
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
    gazeOverrideRef,
    setExpression,
    getExpression,
    setViseme,
    resetVisemes,
    updateFace,
  };
}
