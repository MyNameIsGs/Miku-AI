import { useEffect, useRef, RefObject } from "react";
import * as THREE from "three";
import { load } from "@tauri-apps/plugin-store";
import { BONE_RANGES_DEG, FINGER_KEY_TO_VRM_NAME, FINGER_PHALANX_MAX_DEG } from "../config/boneRanges";
import { HAND_PRESET_SEEDS } from "../config/handPresets";
import {
  MovementOrigin,
  BoneTransition,
  PendingQuirkRevert,
  ParsedMovement,
  FingerKey,
  FingerCurls,
} from "../types";

function intensityToDegrees(
  intensity: number,
  minDeg: number,
  maxDeg: number,
): number {
  const clamped = Math.max(-100, Math.min(100, intensity));
  if (clamped >= 0) return (clamped / 100) * maxDeg;
  return (-clamped / 100) * minDeg;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

type UseMovementParams = {
  movementBonesRef: RefObject<Record<string, THREE.Object3D | null>>;
  fingerBonesRef: RefObject<Record<string, THREE.Object3D | null>>;
  boneRestRotationRef: RefObject<
    Record<string, { x: number; y: number; z: number }>
  >;
  chestBoneRef: RefObject<THREE.Object3D | null>;
  headBoneRef: RefObject<THREE.Object3D | null>;
};

export function useMovement({
  movementBonesRef,
  fingerBonesRef,
  boneRestRotationRef,
  chestBoneRef,
  headBoneRef,
}: UseMovementParams) {
  const boneTransitionsRef = useRef<Record<string, BoneTransition>>({});
  const pendingQuirkRevertsRef = useRef<Record<string, PendingQuirkRevert>>({});
  // Mismo problema que los huesos de cuerpo (ver revertAnimatedBonesExcept),
  // pero para el wiggle de dedos: animatedHandSidesRef nunca se apagaba
  // sola, un lado quedaba wiggleando para siempre hasta el próximo gesto
  // para ESE mismo lado. Un registro por lado, no por hueso -- el wiggle
  // ya es por lado, no por dedo individual.
  const pendingHandRevertsRef = useRef<
    Partial<Record<"left" | "right", { revertAt: number; revertDuration: number }>>
  >({});

  // --- Tarea 3.1, Paso 2b: gestos de mano personalizados y animación ---
  // Gestos creados por Miku, persistidos en .settings.dat (no en memory.ts:
  // son datos estructurados, no texto libre de personalidad).
  const customHandGesturesRef = useRef<
    Record<string, FingerCurls & { animated: boolean }>
  >({});
  const isCustomGesturesLoaded = useRef(false);
  // Qué lado tiene activo un gesto animado en este momento (los dedos
  // oscilan mientras esto sea true; se apaga al programar cualquier otro
  // gesto para ese mismo lado, animado o no).
  const animatedHandSidesRef = useRef<Record<"left" | "right", boolean>>({
    left: false,
    right: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const savedGestures =
          await store.get<Record<string, FingerCurls & { animated: boolean }>>(
            "customHandGestures",
          );
        if (savedGestures) customHandGesturesRef.current = savedGestures;
        isCustomGesturesLoaded.current = true;
      } catch (err) {
        console.error("Error cargando gestos de mano guardados:", err);
      }
    })();
  }, []);

  // Tarea 3.1, Paso 3: autoRevertDelayMs es opcional -- cuando se usa (para
  // quirks idle), después de duracion+autoRevertDelayMs el hueso vuelve
  // solo a lo que tenía ANTES de este movimiento (no al reposo absoluto,
  // respeta una pose permanente que estuviera sostenida).
  function scheduleMovement(
    parsed: ParsedMovement,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) {
    const now = performance.now();
    for (const { bone, axis, intensity } of parsed.entries) {
      const range = BONE_RANGES_DEG[bone]?.[axis];
      const boneNode = movementBonesRef.current[bone];
      if (!range || !boneNode) continue;

      const key = `${bone}.${axis}`;
      const restRad = boneRestRotationRef.current[bone]?.[axis] ?? 0;
      const offsetRad =
        (intensityToDegrees(intensity, range[0], range[1]) * Math.PI) / 180;
      const targetRad = restRad + offsetRad;
      const currentValue = boneNode.rotation[axis];

      boneTransitionsRef.current[key] = {
        startValue: currentValue,
        targetValue: targetRad,
        startTime: now,
        duration: parsed.durationMs,
        origin,
        animated: parsed.animated,
      };

      // Idea de Sebastián: un quirk (animado o no) no debería durar para
      // siempre, tiene que tener un límite propio -- antes esto se
      // saltaba a propósito para animados, porque "nunca revertir" era el
      // único comportamiento posible para animados en general (ver
      // updateMovement). Ahora también programan su revert -- mismo
      // tiempo que ya usan los no-animados (2x su propia duración: la
      // duración es el período de un ciclo completo, así que son ~2
      // ciclos de vaivén antes de asentarse solos). Solo aplica a
      // llamadas que YA pasan autoRevertDelayMs -- hoy eso es únicamente
      // runStoredQuirk/askForIdleQuirk (quirks idle); un gesto animado en
      // una respuesta normal de conversación sigue sin límite, no es lo
      // que se pidió acá.
      if (autoRevertDelayMs !== undefined) {
        pendingQuirkRevertsRef.current[key] = {
          revertAt: now + parsed.durationMs + autoRevertDelayMs,
          revertToValue: parsed.animated ? restRad : currentValue,
          revertDuration: parsed.durationMs,
        };
      }
    }
  }

  // Bug real encontrado por Sebastián en vivo: un gesto animado nunca
  // "termina" solo (ver el comentario en updateMovement) -- sigue
  // oscilando hasta que llega una orden nueva para ESE MISMO hueso+eje.
  // Si un quirk nuevo no toca alguno de los huesos que el quirk ANTERIOR
  // sí animaba (ej. tarareo_quieta mueve cabeza/cuello/columna, y
  // microsuspiro no), esos huesos se quedan oscilando para siempre,
  // mezclados con el gesto nuevo -- y de paso ensucian la foto que se usa
  // para evaluar el quirk nuevo, sin que la descripción numérica lo
  // refleje. Se llama antes de programar un quirk idle nuevo, con la
  // lista de huesos que SÍ va a tocar ese quirk -- todo lo demás que
  // siga animado vuelve suavemente a su reposo.
  function revertAnimatedBonesExcept(keepKeys: string[]) {
    const now = performance.now();
    const keep = new Set(keepKeys);
    for (const key of Object.keys(boneTransitionsRef.current)) {
      const transition = boneTransitionsRef.current[key];
      if (!transition.animated || keep.has(key)) continue;
      const [boneName, axis] = key.split(".") as [string, "x" | "y" | "z"];
      const boneNode = movementBonesRef.current[boneName];
      if (!boneNode) continue;
      const restRad = boneRestRotationRef.current[boneName]?.[axis] ?? 0;
      boneTransitionsRef.current[key] = {
        startValue: boneNode.rotation[axis],
        targetValue: restRad,
        startTime: now,
        duration: transition.duration,
        origin: "idle",
        animated: false,
      };
    }
  }

  // Tarea 8.12: una pose que dura "lo que dure algo" (la caricia): se
  // programa con una vuelta automática muy lejana -- así igual queda
  // anotado a dónde volver -- y cuando termina, esto la adelanta a ahora.
  function releaseQuirkRevertsNow(keys: string[]) {
    const now = performance.now();
    for (const key of keys) {
      const pending = pendingQuirkRevertsRef.current[key];
      if (pending) pending.revertAt = now;
    }
  }

  // --- Tarea 3.1, Paso 2b: busca un gesto por nombre, primero entre los
  // presets semilla y después entre los personalizados que Miku creó.
  function getHandGestureDefinition(
    name: string,
  ): { curls: FingerCurls; animated: boolean } | undefined {
    if (HAND_PRESET_SEEDS[name]) {
      return { curls: HAND_PRESET_SEEDS[name], animated: false };
    }
    const custom = customHandGesturesRef.current[name];
    if (custom) {
      const { animated, ...curls } = custom;
      return { curls, animated };
    }
    return undefined;
  }

  function scheduleHandGesture(
    side: "left" | "right",
    presetName: string,
    durationMs: number,
    origin: MovementOrigin,
    // Mismo criterio que scheduleMovement: si se pasa, un gesto animado
    // se apaga solo (2x su duración) en vez de wigglear para siempre.
    // Solo lo usan los quirks idle -- un gesto de mano en una respuesta
    // normal de conversación sigue sin límite.
    autoRevertDelayMs?: number,
  ) {
    const def = getHandGestureDefinition(presetName);
    if (!def) return;
    const { curls } = def;

    // Marca/desmarca el lado como animado -- programar CUALQUIER gesto
    // nuevo para este lado reemplaza el estado anterior, sea animado o no.
    animatedHandSidesRef.current[side] = def.animated;

    if (def.animated && autoRevertDelayMs !== undefined) {
      pendingHandRevertsRef.current[side] = {
        revertAt: performance.now() + durationMs + autoRevertDelayMs,
        revertDuration: durationMs,
      };
    } else {
      delete pendingHandRevertsRef.current[side];
    }

    const now = performance.now();
    for (const fingerKey of Object.keys(curls) as FingerKey[]) {
      const vrmFingerName = FINGER_KEY_TO_VRM_NAME[fingerKey];
      const curl = curls[fingerKey];

      (["Proximal", "Intermediate", "Distal"] as const).forEach((phalanx) => {
        const boneName = `${side}${vrmFingerName}${phalanx}`;
        const boneNode = fingerBonesRef.current[boneName];
        if (!boneNode) return;

        const maxDeg = FINGER_PHALANX_MAX_DEG[phalanx];
        const sideSign = side === "right" ? 1 : -1;
        // Confirmado con el calibrador: el pulgar cierra en el eje Y, los
        // otros 4 dedos en Z -- pero el signo de cierre es el mismo
        // (negativo) para todos, pulgar incluido.
        const axis: "y" | "z" = fingerKey === "thumb" ? "y" : "z";
        const targetDeg = sideSign * -(curl / 100) * maxDeg;

        const restRad = boneRestRotationRef.current[boneName]?.[axis] ?? 0;
        const targetRad = restRad + (targetDeg * Math.PI) / 180;
        const key = `${boneName}.${axis}`;
        const currentValue = boneNode.rotation[axis];

        boneTransitionsRef.current[key] = {
          startValue: currentValue,
          targetValue: targetRad,
          startTime: now,
          duration: durationMs,
          origin,
          animated: false,
        };
      });
    }
  }

  // --- Tarea 3.1, Paso 2b: guardar un gesto de mano creado por Miku ---
  async function saveCustomHandGesture(
    name: string,
    curls: FingerCurls,
    animated: boolean,
  ) {
    customHandGesturesRef.current[name] = { ...curls, animated };
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("customHandGestures", customHandGesturesRef.current);
      await store.save();
    } catch (err) {
      console.error("Error guardando gesto de mano personalizado:", err);
    }
  }

  // Corre dentro de onBeforeRender, antes de vrm.update(delta) -- ver el
  // contrato del loop en useVRMScene. Agrupa todo lo que escribe
  // rotaciones de huesos: el balanceo de respiración de pecho/cabeza, los
  // reverts automáticos de quirks pendientes, y las transiciones de
  // huesos en curso (oscilación senoidal para animado=si, y el balanceo
  // ambiente de ±1.5° / el wiggle de dedos para gestos animados).
  function updateMovement(now: number, _delta: number, elapsed: number) {
    const chestBone = chestBoneRef.current;
    const headBone = headBoneRef.current;

    if (chestBone) {
      chestBone.rotation.x = Math.sin(elapsed * 1.2) * 0.025;
    }

    if (headBone) {
      headBone.rotation.y =
        Math.sin(elapsed * 0.4) * 0.08 + Math.sin(elapsed * 0.17) * 0.04;
      headBone.rotation.x = Math.sin(elapsed * 0.3) * 0.03;
    }

    // Tarea 3.1, Paso 3: procesa los regresos automáticos de quirks
    // pendientes -- cuando llega su momento, programa una transición
    // normal de vuelta a lo que tenía antes del quirk.
    for (const key of Object.keys(pendingQuirkRevertsRef.current)) {
      const revert = pendingQuirkRevertsRef.current[key];
      if (now >= revert.revertAt) {
        delete pendingQuirkRevertsRef.current[key];
        const [boneName, axis] = key.split(".") as [string, "x" | "y" | "z"];
        const boneNode = movementBonesRef.current[boneName];
        if (!boneNode) continue;
        boneTransitionsRef.current[key] = {
          startValue: boneNode.rotation[axis],
          targetValue: revert.revertToValue,
          startTime: now,
          duration: revert.revertDuration,
          origin: "idle",
          animated: false,
        };
      }
    }

    // Mismo mecanismo que pendingQuirkRevertsRef, pero para el wiggle de
    // dedos (ver el comentario largo en scheduleHandGesture): cuando llega
    // su momento, apaga animatedHandSidesRef para ese lado Y programa una
    // transición normal de cada falange de vuelta a su rotación de
    // reposo -- si no, el wiggle se apaga pero la mano queda congelada en
    // la pose exagerada del gesto animado, en vez de relajarse.
    for (const sideKey of Object.keys(pendingHandRevertsRef.current) as (
      | "left"
      | "right"
    )[]) {
      const pending = pendingHandRevertsRef.current[sideKey];
      if (!pending || now < pending.revertAt) continue;
      delete pendingHandRevertsRef.current[sideKey];
      animatedHandSidesRef.current[sideKey] = false;
      (Object.keys(FINGER_KEY_TO_VRM_NAME) as FingerKey[]).forEach((fingerKey) => {
        const vrmFingerName = FINGER_KEY_TO_VRM_NAME[fingerKey];
        const axis: "y" | "z" = fingerKey === "thumb" ? "y" : "z";
        (["Proximal", "Intermediate", "Distal"] as const).forEach((phalanx) => {
          const boneName = `${sideKey}${vrmFingerName}${phalanx}`;
          const boneNode = fingerBonesRef.current[boneName];
          if (!boneNode) return;
          const restRad = boneRestRotationRef.current[boneName]?.[axis] ?? 0;
          const key = `${boneName}.${axis}`;
          boneTransitionsRef.current[key] = {
            startValue: boneNode.rotation[axis],
            targetValue: restRad,
            startTime: now,
            duration: pending.revertDuration,
            origin: "idle",
            animated: false,
          };
        });
      });
    }

    for (const key of Object.keys(boneTransitionsRef.current)) {
      const transition = boneTransitionsRef.current[key];
      const [boneName, axis] = key.split(".") as [string, "x" | "y" | "z"];
      const boneNode =
        movementBonesRef.current[boneName] ?? fingerBonesRef.current[boneName];
      if (!boneNode) continue;

      let value: number;
      if (transition.animated) {
        // Oscila entre el punto de partida y el objetivo, ida y
        // vuelta, con "duration" como período del ciclo completo -- no
        // se "termina" nunca, sigue así hasta la próxima orden para
        // este mismo hueso.
        const cyclePos =
          ((now - transition.startTime) % transition.duration) /
          transition.duration;
        const oscillation = Math.sin(cyclePos * 2 * Math.PI);
        const amplitude = (transition.targetValue - transition.startValue) / 2;
        const center =
          transition.startValue +
          (transition.targetValue - transition.startValue) / 2;
        value = center + amplitude * oscillation;
      } else {
        const t = (now - transition.startTime) / transition.duration;
        const eased = smoothstep(t);
        value =
          transition.startValue +
          (transition.targetValue - transition.startValue) * eased;
      }

      const isFinger = !movementBonesRef.current[boneName];
      let sway = 0;
      if (!isFinger) {
        // Balanceo ambiente del cuerpo (Paso 1) -- que ninguna pose,
        // ni siquiera una "permanente", quede completamente congelada.
        let seed = 0;
        for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i);
        const freq = 0.3 + (seed % 7) * 0.05;
        const phase = seed % 10;
        const swayRad = (1.5 * Math.PI) / 180;
        sway = Math.sin(elapsed * freq + phase) * swayRad;
      } else {
        // Tarea 3.1, Paso 2b: oscilación de dedos para gestos
        // "animados" -- más rápida y notoria que el balanceo ambiente
        // del cuerpo, porque aquí SÍ debe leerse como un movimiento
        // activo, no como un tic de fondo.
        const side: "left" | "right" = boneName.startsWith("left")
          ? "left"
          : "right";
        if (animatedHandSidesRef.current[side]) {
          let seed = 0;
          for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i);
          const freq = 1.5 + (seed % 5) * 0.3;
          const phase = seed % 10;
          const wiggleRad = (8 * Math.PI) / 180;
          sway = Math.sin(elapsed * freq + phase) * wiggleRad;
        }
      }

      boneNode.rotation[axis] = value + sway;
    }
  }

  return {
    boneTransitionsRef,
    animatedHandSidesRef,
    customHandGesturesRef,
    scheduleMovement,
    releaseQuirkRevertsNow,
    revertAnimatedBonesExcept,
    scheduleHandGesture,
    saveCustomHandGesture,
    updateMovement,
  };
}
