import * as THREE from "three";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
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

// Hacia dónde puede pedir que mire la palma (opcional, lo elige ella: sin
// pedirlo, la palma queda donde la deje el cálculo del brazo).
export const PALM_DIRECTIONS: Record<string, string> = {
  palma_hacia_la_cara: "la palma mirando hacia tu cara",
  palma_hacia_el_cuerpo: "la palma mirando hacia tu cuerpo",
  palma_afuera: "la palma mirando hacia afuera, lejos de tu cuerpo",
  palma_abajo: "la palma mirando hacia abajo",
  palma_arriba: "la palma mirando hacia arriba",
  palma_adelante: "la palma mirando hacia adelante",
  palma_hacia_ti: "la palma mirando hacia quien te mira (Sebastián)",
};

export type ReachRequest = { place: string; palm?: string };
export type ParsedReach = { left?: ReachRequest; right?: ReachRequest; durationMs: number };

// "mejilla" o "mejilla:palma_hacia_la_cara".
function parseReachValue(value: string): ReachRequest | undefined {
  const [place, palm] = value.split(":");
  if (!REACH_PLACES[place]) return undefined;
  return { place, palm: palm && PALM_DIRECTIONS[palm] ? palm : undefined };
}

export function parseReachMarker(text: string, defaultDurationMs: number): ParsedReach | null {
  const match = text.match(/\[LLEVAR_MANO:\s*([\s\S]*?)\]/i);
  if (!match) return null;
  let left: ReachRequest | undefined;
  let right: ReachRequest | undefined;
  let durationMs = defaultDurationMs;
  for (const part of match[1].split(",").map((p) => p.trim()).filter(Boolean)) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || !rawValue) continue;
    const key = rawKey.toLowerCase();
    const value = rawValue.toLowerCase().replace(/\s+/g, "_");
    if (key === "duracion") {
      const num = parseFloat(value.replace(/s$/i, ""));
      if (!Number.isNaN(num) && num > 0) durationMs = num * 1000;
    } else if (key === "izq") left = parseReachValue(value) ?? left;
    else if (key === "der") right = parseReachValue(value) ?? right;
  }
  return left || right ? { left, right, durationMs } : null;
}

// Normal de la palma (sale de la palma, no del dorso), medida con la pose
// actual: plano muñeca -> nudillo del medio, índice -> meñique. En reposo,
// con el brazo colgando, mira hacia el cuerpo (verificado en el banco).
export function palmNormal(vrm: VRM, side: Side): { normal: THREE.Vector3; center: THREE.Vector3 } | null {
  const pos = (name: string) => vrm.humanoid?.getNormalizedBoneNode(name as VRMHumanBoneName)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const wrist = pos(`${side}Hand`);
  const middle = pos(`${side}MiddleProximal`);
  const index = pos(`${side}IndexProximal`);
  const little = pos(`${side}LittleProximal`);
  if (!wrist || !middle || !index || !little) return null;
  const along = middle.clone().sub(wrist).normalize();
  const across = index.clone().sub(little).normalize();
  const normal = new THREE.Vector3().crossVectors(along, across).multiplyScalar(side === "left" ? 1 : -1).normalize();
  return { normal, center: wrist.clone().lerp(middle, 0.6) };
}

// Dirección del mundo que pide cada opción de palma, desde el centro de la palma.
function palmTargetDirection(vrm: VRM, palm: string, palmCenter: THREE.Vector3, cameraWorldPos: THREE.Vector3 | null): THREE.Vector3 | null {
  const bonePos = (name: VRMHumanBoneName) => vrm.humanoid?.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const head = bonePos("head")?.add(new THREE.Vector3(0, 0.07, 0)) ?? null;
  const chest = bonePos("chest");
  switch (palm) {
    case "palma_hacia_la_cara": return head ? head.sub(palmCenter).normalize() : null;
    case "palma_hacia_el_cuerpo": return chest ? chest.sub(palmCenter).normalize() : null;
    case "palma_afuera": return chest ? palmCenter.clone().sub(chest).normalize() : null;
    case "palma_abajo": return new THREE.Vector3(0, -1, 0);
    case "palma_arriba": return new THREE.Vector3(0, 1, 0);
    case "palma_adelante": return new THREE.Vector3(0, 0, 1);
    case "palma_hacia_ti": return cameraWorldPos ? cameraWorldPos.clone().sub(palmCenter).normalize() : new THREE.Vector3(0, 0, 1);
    default: return null;
  }
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
  // Si pidió dirección de palma: cuánto quedó de esa dirección (grados).
  palmOffDeg: number | null;
};

// Giros de antebrazo que se prueban cuando pide una dirección de palma.
// Con el codo doblado, girar el antebrazo (LowerArm.x) también cambia el
// plano en que dobla el codo (medido), así que para cada giro se recalcula
// el brazo entero: la muñeca queda en el mismo lugar y solo gira la palma.
const PALM_TWISTS_DEG = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];
// Cuánto se "cobra" apuntar mal la palma, en metros de error de muñeca por
// radián: 1 rad (57°) de palma torcida pesa como 3 cm de mano corrida. Así
// primero llega, y entre las que llegan elige la que mejor apunta.
const PALM_WEIGHT_M_PER_RAD = 0.03;
// Con palma pedida, el codo prueba una vuelta completa alrededor de la línea
// hombro-muñeca (la mano no se mueve, la palma sí). Un codo lejos de lo
// natural (abajo y afuera) paga un poco: no conviene levantar el codo para
// ganar unos grados de palma.
const PALM_SWIVEL_STEPS = 12;
const UNNATURAL_ELBOW_M_PER_RAD = 0.012;
// Último ajuste, solo de muñeca (no mueve la mano de lugar): grilla en los
// rangos de Hand, en pasos de 10°.
const WRIST_STEP_DEG = 10;

// Resuelve un brazo. Mueve los huesos para medir y los deja exactamente
// como estaban antes de volver.
export function solveReach(
  vrm: VRM,
  bones: Record<string, THREE.Object3D | null>,
  restRotation: Record<string, { x: number; y: number; z: number }>,
  side: Side,
  placeName: string,
  cameraWorldPos: THREE.Vector3 | null,
  palm?: string,
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
    // Depende del giro del antebrazo: se mide para cada giro que se prueba.
    const lowRest = restRotation[lowName];
    const bendRestFor = (twistDeg: number) => {
      low.rotation.set(lowRest.x + THREE.MathUtils.degToRad(twistDeg), lowRest.y + (flexSign * Math.PI) / 2, lowRest.z);
      refresh();
      const f90 = worldPos(hand).sub(worldPos(low)).normalize();
      const bend = f90.sub(armDirRest.clone().multiplyScalar(f90.dot(armDirRest))).normalize();
      low.rotation.set(lowRest.x, lowRest.y, lowRest.z);
      refresh();
      return bend;
    };
    const twists = palm ? PALM_TWISTS_DEG : [0];
    const bendByTwist = new Map(twists.map((t) => [t, bendRestFor(t)]));

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

    type Candidate = {
      entries: ParsedMovement["entries"];
      error: number;
      score: number;
      palmOff: number | null;
      pose: { up: Record<"x" | "y" | "z", number>; flexDeg: number; twistDeg: number };
    };
    let best: Candidate | null = null;
    const twistRange = BONE_RANGES_DEG[lowName].x;

    // Direcciones del codo a probar: las naturales de siempre y, con palma
    // pedida, además una vuelta completa alrededor de la línea hombro-muñeca.
    const naturalPole = bodyToWorld(ELBOW_POLES[0]).normalize();
    const poles: { pole: THREE.Vector3; penalty: number }[] = ELBOW_POLES.map((p, i) => ({ pole: bodyToWorld(p).normalize(), penalty: i * 0.004 }));
    if (palm) {
      const base = naturalPole.clone().sub(dir.clone().multiplyScalar(naturalPole.dot(dir))).normalize();
      for (let i = 0; i < PALM_SWIVEL_STEPS; i++) {
        const pole = base.clone().applyAxisAngle(dir, (i / PALM_SWIVEL_STEPS) * Math.PI * 2);
        poles.push({ pole, penalty: pole.angleTo(naturalPole) * UNNATURAL_ELBOW_M_PER_RAD });
      }
    }

    for (const twistDeg of twists) {
    const bendRest = bendByTwist.get(twistDeg)!;
    poles.forEach(({ pole: poleWorld, penalty }) => {
      const pole = poleWorld.clone();
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
        low.rotation.set(
          lowRest.x + THREE.MathUtils.degToRad(twistDeg),
          lowRest.y + THREE.MathUtils.degToRad(flexDeg),
          lowRest.z,
        );
        refresh();
        const posError = worldPos(hand).distanceTo(target);
        const error = posError + penalty;

        // Palma: ángulo entre hacia dónde mira y hacia dónde la pidió.
        let palmOff: number | null = null;
        if (palm) {
          const measured = palmNormal(vrm, side);
          const wanted = measured ? palmTargetDirection(vrm, palm, measured.center, cameraWorldPos) : null;
          if (measured && wanted) palmOff = Math.acos(THREE.MathUtils.clamp(measured.normal.dot(wanted), -1, 1));
        }
        const score = error + (palmOff ?? 0) * PALM_WEIGHT_M_PER_RAD;

        if (!best || score < best.score) {
          best = {
            error: posError,
            score,
            palmOff,
            pose: { up: clamped, flexDeg, twistDeg },
            entries: [
              ...AXES.map((axis) => ({ bone: upName, axis, intensity: Math.round(toIntensity(clamped[axis], upRanges[axis])) })),
              { bone: lowName, axis: "y" as const, intensity: Math.round(toIntensity(flexDeg, flexRange)) },
              { bone: lowName, axis: "x" as const, intensity: Math.round(toIntensity(twistDeg, twistRange)) },
              { bone: lowName, axis: "z" as const, intensity: 0 },
            ],
          };
        }
      }
    });
    }

    if (!best) return null;
    const chosen = best as Candidate;
    let entries = chosen.entries;
    let palmOff = chosen.palmOff;

    // Ajuste final solo de muñeca, si pidió palma: no mueve la mano de
    // lugar, así que se busca aparte, con el brazo ya ubicado.
    if (palm) {
      const upRest = restRotation[upName];
      for (const axis of AXES) up.rotation[axis] = upRest[axis] + THREE.MathUtils.degToRad(chosen.pose.up[axis]);
      low.rotation.set(
        lowRest.x + THREE.MathUtils.degToRad(chosen.pose.twistDeg),
        lowRest.y + THREE.MathUtils.degToRad(chosen.pose.flexDeg),
        lowRest.z,
      );
      const handRest = restRotation[handName];
      const handRanges = BONE_RANGES_DEG[handName];
      const steps = (range: [number, number]) => {
        const values: number[] = [];
        for (let v = range[0]; v <= range[1] + 1e-6; v += WRIST_STEP_DEG) values.push(v);
        if (!values.includes(0)) values.push(0);
        return values;
      };
      let bestWrist = { x: 0, y: 0, z: 0, off: palmOff ?? Math.PI };
      for (const wx of steps(handRanges.x)) {
        for (const wy of steps(handRanges.y)) {
          for (const wz of steps(handRanges.z)) {
            hand.rotation.set(
              handRest.x + THREE.MathUtils.degToRad(wx),
              handRest.y + THREE.MathUtils.degToRad(wy),
              handRest.z + THREE.MathUtils.degToRad(wz),
            );
            refresh();
            const measured = palmNormal(vrm, side);
            const wanted = measured ? palmTargetDirection(vrm, palm, measured.center, cameraWorldPos) : null;
            if (!measured || !wanted) continue;
            // Un poco de preferencia por la muñeca recta: a igual palma, menos doblez.
            const off = Math.acos(THREE.MathUtils.clamp(measured.normal.dot(wanted), -1, 1)) + (Math.abs(wx) + Math.abs(wy) + Math.abs(wz)) * 0.0005;
            if (off < bestWrist.off) bestWrist = { x: wx, y: wy, z: wz, off };
          }
        }
      }
      palmOff = bestWrist.off;
      entries = [
        ...entries,
        ...AXES.map((axis) => ({ bone: handName, axis, intensity: Math.round(toIntensity(bestWrist[axis], handRanges[axis])) })),
      ];
    }

    return {
      entries,
      missCm: Math.round(chosen.error * 100),
      palmOffDeg: palmOff === null ? null : Math.round(THREE.MathUtils.radToDeg(palmOff)),
    };
  } finally {
    armNodes.forEach(([, node], i) => node.rotation.copy(saved[i]));
    refresh();
  }
}
