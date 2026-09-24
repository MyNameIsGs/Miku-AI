import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { BONE_RANGES_DEG } from "../config/boneRanges";
import { ParsedMovement } from "../types";

// [LLEVAR_MANO]: Miku dice ADÓNDE quiere la mano ("mejilla", "cintura",
// "hacia ti") y el código calcula los ángulos de brazo y antebrazo -- un
// brazo de dos tramos resuelto con cinemática inversa, dentro de los
// rangos humanos (config/boneRanges.ts). Antes tenía que acertar 5-6
// números por brazo y adivinar cómo se combinaban (sus notas muestran
// cuatro intentos para poner las manos frente a la falda).
//
// El resultado son entradas normales de [MOVIMIENTO] (intensidades), así
// que todo lo demás -- transiciones, vuelta, foto posterior, descripción --
// funciona igual. Se resuelve con la pose ACTUAL del cuerpo: si está
// inclinada o con la cabeza girada, la mejilla está donde está de verdad.

type Side = "left" | "right";
type Vec3 = [number, number, number];

// Posición de la MUÑECA para cada lugar, en el marco del cuerpo de Miku
// (x = hacia el lado de esa mano, y = arriba, z = adelante), en metros,
// relativa a un hueso -- sigue a ese hueso si se movió. Los "hacia" son
// direcciones: el brazo se estira en esa dirección.
type Place =
  | { kind: "point"; bone: "head" | "neck" | "chest" | "hips"; offset: Vec3; description: string }
  | { kind: "direction"; dir: Vec3 | "camera"; description: string };

export const REACH_PLACES: Record<string, Place> = {
  cabeza: { kind: "point", bone: "head", offset: [0.07, 0.19, 0.0], description: "la mano sobre tu cabeza" },
  mejilla: { kind: "point", bone: "head", offset: [0.11, -0.04, 0.05], description: "la mano en tu mejilla (la de ese lado)" },
  boca: { kind: "point", bone: "head", offset: [0.03, -0.07, 0.12], description: "la mano frente a tu boca" },
  barbilla: { kind: "point", bone: "head", offset: [0.03, -0.08, 0.1], description: "la mano bajo tu barbilla" },
  pecho: { kind: "point", bone: "chest", offset: [0.0, -0.02, 0.1], description: "la mano en tu pecho" },
  cintura: { kind: "point", bone: "hips", offset: [0.15, 0.08, 0.03], description: "la mano en tu cintura (la de ese lado)" },
  falda: { kind: "point", bone: "hips", offset: [0.05, -0.1, 0.14], description: "la mano frente a tu falda" },
  adelante: { kind: "direction", dir: [0.15, -0.1, 1], description: "el brazo estirado hacia adelante" },
  arriba: { kind: "direction", dir: [0.12, 1, 0.05], description: "el brazo estirado hacia arriba" },
  costado: { kind: "direction", dir: [1, -0.15, 0], description: "el brazo estirado hacia tu costado" },
  hacia_ti: { kind: "direction", dir: "camera", description: "el brazo estirado hacia quien te mira (Sebastián)" },
};

// Marco del cuerpo -> mundo, para una mano. Medido: en reposo Miku mira a
// +z del mundo y su izquierda es +x, así que en reposo coinciden (con x
// espejado para la mano derecha). Si el hueso de referencia se movió
// (cabeza girada, torso inclinado), se le aplica ese giro: los huesos
// normalizados en reposo tienen la orientación de su raíz, así que lo que
// giró respecto de la raíz es cuánto se movió.
export function makeBodyToWorld(vrm: VRM, side: Side) {
  const s = side === "left" ? 1 : -1;
  const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
  const restFrame = (hips?.parent ?? vrm.scene).getWorldQuaternion(new THREE.Quaternion());
  return (v: Vec3, relativeTo?: THREE.Object3D) => {
    const vec = new THREE.Vector3(v[0] * s, v[1], v[2]);
    if (relativeTo) {
      const moved = relativeTo.getWorldQuaternion(new THREE.Quaternion()).multiply(restFrame.clone().invert());
      vec.applyQuaternion(moved);
    }
    return vec;
  };
}

// Dónde está ahora (mundo) un lugar de tipo punto, para esa mano -- con la
// pose actual. null si es una dirección ("adelante") o falta el hueso.
export function placeWorldPoint(vrm: VRM, side: Side, placeName: string): THREE.Vector3 | null {
  const place = REACH_PLACES[placeName];
  if (!place || place.kind !== "point") return null;
  const anchor = vrm.humanoid?.getNormalizedBoneNode(place.bone);
  if (!anchor) return null;
  return anchor.getWorldPosition(new THREE.Vector3()).add(makeBodyToWorld(vrm, side)(place.offset, anchor));
}

export type ParsedReach = { left?: string; right?: string; durationMs: number };

export function parseReachMarker(text: string, defaultDurationMs: number): ParsedReach | null {
  const match = text.match(/\[LLEVAR_MANO:\s*([\s\S]*?)\]/i);
  if (!match) return null;
  let left: string | undefined;
  let right: string | undefined;
  let durationMs = defaultDurationMs;
  for (const part of match[1].split(",").map((p) => p.trim()).filter(Boolean)) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || !rawValue) continue;
    const key = rawKey.toLowerCase();
    const value = rawValue.toLowerCase().replace(/\s+/g, "_");
    if (key === "duracion") {
      const num = parseFloat(value.replace(/s$/i, ""));
      if (!Number.isNaN(num) && num > 0) durationMs = num * 1000;
    } else if (key === "izq" && REACH_PLACES[value]) left = value;
    else if (key === "der" && REACH_PLACES[value]) right = value;
  }
  return left || right ? { left, right, durationMs } : null;
}

const AXES = ["x", "y", "z"] as const;

function toIntensity(deg: number, [minDeg, maxDeg]: [number, number]): number {
  if (deg >= 0) return maxDeg > 0 ? Math.min(100, (deg / maxDeg) * 100) : 0;
  return minDeg < 0 ? -Math.min(100, (deg / minDeg) * 100) : 0;
}
function clampDeg(deg: number, [minDeg, maxDeg]: [number, number]): number {
  return Math.max(minDeg, Math.min(maxDeg, deg));
}
function wrap(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

// Posibles direcciones del codo (marco del cuerpo, x hacia el lado de esa
// mano), de la más natural a la menos: se prueba cada una y gana la que
// deja la mano más cerca del objetivo sin salirse de los rangos humanos.
const ELBOW_POLES: Vec3[] = [
  [0.5, -1, -0.3],
  [0.2, -1, 0],
  [1, -0.3, -0.2],
  [0.3, -0.6, -1],
  [0.6, -0.2, 0.6],
];

export type ReachResult = {
  entries: ParsedMovement["entries"];
  // Cuánto quedó la muñeca del objetivo (cm): > 0 si el lugar no se
  // alcanza del todo sin pasar los límites humanos.
  missCm: number;
};

// Resuelve un brazo. Mueve los huesos para medir y los deja exactamente
// como estaban antes de volver.
export function solveReach(
  vrm: VRM,
  bones: Record<string, THREE.Object3D | null>,
  restRotation: Record<string, { x: number; y: number; z: number }>,
  side: Side,
  placeName: string,
  cameraWorldPos: THREE.Vector3 | null,
): ReachResult | null {
  const place = REACH_PLACES[placeName];
  const upName = `${side}UpperArm`;
  const lowName = `${side}LowerArm`;
  const handName = `${side}Hand`;
  const up = bones[upName];
  const low = bones[lowName];
  const hand = bones[handName];
  const humanoid = vrm.humanoid;
  if (!place || !up || !low || !hand || !up.parent || !humanoid) return null;

  // El codo se dobla con y negativo en el izquierdo y positivo en el derecho.
  const flexSign = side === "left" ? -1 : 1;
  const armNodes: [string, THREE.Object3D][] = [[upName, up], [lowName, low], [handName, hand]];
  const saved = armNodes.map(([, node]) => node.rotation.clone());

  const refresh = () => {
    humanoid.update();
    vrm.scene.updateMatrixWorld(true);
  };
  const worldPos = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());
  const bodyToWorld = makeBodyToWorld(vrm, side);

  try {
    for (const [name, node] of armNodes) {
      const r = restRotation[name];
      node.rotation.set(r.x, r.y, r.z);
    }
    refresh();

    const S = worldPos(up);
    const elbowRest = worldPos(low);
    const wristRest = worldPos(hand);
    const L1 = elbowRest.distanceTo(S);
    const L2 = wristRest.distanceTo(elbowRest);
    const armDirRest = elbowRest.clone().sub(S).normalize();

    // Hacia dónde se va el antebrazo al doblar el codo 90° (para saber en
    // qué plano dobla, y alinear ese plano con el que pide el objetivo).
    low.rotation.y = restRotation[lowName].y + (flexSign * Math.PI) / 2;
    refresh();
    const f90 = worldPos(hand).sub(worldPos(low)).normalize();
    const bendRest = f90.sub(armDirRest.clone().multiplyScalar(f90.dot(armDirRest))).normalize();
    low.rotation.y = restRotation[lowName].y;
    refresh();

    const qUpRestWorld = up.getWorldQuaternion(new THREE.Quaternion());
    const qParentWorld = up.parent.getWorldQuaternion(new THREE.Quaternion());

    // Objetivo de la muñeca.
    let target: THREE.Vector3;
    if (place.kind === "point") {
      const anchor = humanoid.getNormalizedBoneNode(place.bone);
      if (!anchor) return null;
      target = worldPos(anchor).add(bodyToWorld(place.offset, anchor));
    } else {
      const dir =
        place.dir === "camera"
          ? cameraWorldPos
            ? cameraWorldPos.clone().sub(S).normalize()
            : bodyToWorld([0, 0, 1]).normalize()
          : bodyToWorld(place.dir).normalize();
      target = S.clone().addScaledVector(dir, (L1 + L2) * 0.96);
    }

    const toDir = target.clone().sub(S);
    const dist = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, toDir.length()));
    const dir = toDir.normalize();
    const reachable = S.clone().addScaledVector(dir, dist);

    let best: { entries: ParsedMovement["entries"]; error: number } | null = null;

    ELBOW_POLES.forEach((poleBody, poleIndex) => {
      const pole = bodyToWorld(poleBody).normalize();
      const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir)));
      if (perp.lengthSq() < 1e-6) return;
      perp.normalize();

      // Codo: ley de cosenos, hacia el lado del polo.
      const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
      const alpha = Math.acos(cosA);
      const u = dir.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha)).normalize();
      const elbow = S.clone().addScaledVector(u, L1);
      const f = reachable.clone().sub(elbow).normalize();
      const flex = Math.acos(THREE.MathUtils.clamp(u.dot(f), -1, 1));
      let w = f.clone().sub(u.clone().multiplyScalar(u.dot(f)));
      // Brazo casi recto: el plano del codo lo define el polo.
      if (w.lengthSq() < 1e-6) w = perp.clone().negate().sub(u.clone().multiplyScalar(-perp.dot(u)));
      w.normalize();

      // Giro del brazo que lleva (dirección de reposo, plano de doblez de
      // reposo) a (dirección pedida, plano de doblez pedido).
      const restBasis = new THREE.Matrix4().makeBasis(armDirRest, bendRest, armDirRest.clone().cross(bendRest));
      const wantBasis = new THREE.Matrix4().makeBasis(u, w, u.clone().cross(w));
      const delta = new THREE.Quaternion().setFromRotationMatrix(wantBasis.multiply(restBasis.transpose()));
      const qLocal = qParentWorld.clone().invert().multiply(delta.multiply(qUpRestWorld));

      // XYZ tiene dos soluciones equivalentes; se prueba la que cae dentro
      // de los rangos (y puede pasar de ±90°, p. ej. cruzar el cuerpo).
      const e1 = new THREE.Euler().setFromQuaternion(qLocal, "XYZ");
      const e2 = new THREE.Euler(e1.x + Math.PI, Math.PI - e1.y, e1.z + Math.PI, "XYZ");
      const upRest = restRotation[upName];
      const upRanges = BONE_RANGES_DEG[upName];
      const flexRange = BONE_RANGES_DEG[lowName].y;

      for (const e of [e1, e2]) {
        const upDeg = {
          x: THREE.MathUtils.radToDeg(wrap(e.x - upRest.x)),
          y: THREE.MathUtils.radToDeg(wrap(e.y - upRest.y)),
          z: THREE.MathUtils.radToDeg(wrap(e.z - upRest.z)),
        };
        const clamped = {
          x: clampDeg(upDeg.x, upRanges.x),
          y: clampDeg(upDeg.y, upRanges.y),
          z: clampDeg(upDeg.z, upRanges.z),
        };
        const flexDeg = clampDeg(flexSign * THREE.MathUtils.radToDeg(flex), flexRange);

        // Comprobación real: dónde queda la muñeca con los ángulos ya
        // recortados a los rangos.
        for (const axis of AXES) up.rotation[axis] = upRest[axis] + THREE.MathUtils.degToRad(clamped[axis]);
        low.rotation.set(restRotation[lowName].x, restRotation[lowName].y + THREE.MathUtils.degToRad(flexDeg), restRotation[lowName].z);
        refresh();
        const error = worldPos(hand).distanceTo(target) + poleIndex * 0.004;

        if (!best || error < best.error) {
          best = {
            error,
            entries: [
              ...AXES.map((axis) => ({ bone: upName, axis, intensity: Math.round(toIntensity(clamped[axis], upRanges[axis])) })),
              { bone: lowName, axis: "y" as const, intensity: Math.round(toIntensity(flexDeg, flexRange)) },
              { bone: lowName, axis: "x" as const, intensity: 0 },
              { bone: lowName, axis: "z" as const, intensity: 0 },
            ],
          };
        }
      }
    });

    if (!best) return null;
    const chosen = best as { entries: ParsedMovement["entries"]; error: number };
    return { entries: chosen.entries, missCm: Math.round(chosen.error * 100) };
  } finally {
    armNodes.forEach(([, node], i) => node.rotation.copy(saved[i]));
    refresh();
  }
}
