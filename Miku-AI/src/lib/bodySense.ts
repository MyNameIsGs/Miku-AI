import * as THREE from "three";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { REACH_PLACES, palmNormal, placeWorldPoint } from "./reach";

// Propiocepción real: cómo QUEDÓ el cuerpo de Miku, medido en la pose (no
// los números que ella pidió). Antes, después de moverse, recibía de vuelta
// sus propios valores ("rightUpperArm.x: 45, 45% del límite"): no le decía
// dónde terminó la mano ni si el brazo atravesaba el torso.
//
// Mismo marco que el resto del cuerpo (medido): en reposo mira a +z del
// mundo y su izquierda es +x.

const SIDE_LABEL = { left: "izquierda", right: "derecha" } as const;
const SIDE_LABEL_M = { left: "izquierdo", right: "derecho" } as const;
const PLACE_NEAR_M = 0.1;
// Choques: cuánto tienen que meterse dos partes una en la otra para
// contarlo (las cápsulas son aproximadas; menos que esto es ruido).
// Medido: brazos apoyados en el cuerpo (manos frente a la falda, mano en
// el pecho) dan ~3 cm; brazos metidos de verdad en el torso, 5-8 cm.
const PENETRATION_MIN_M = 0.04;

const deg = THREE.MathUtils.radToDeg;

const PLACE_PHRASE: Record<string, string> = {
  cabeza: "sobre tu cabeza",
  mejilla: "en tu mejilla",
  boca: "frente a tu boca",
  barbilla: "bajo tu barbilla",
  pecho: "en tu pecho",
  cintura: "en tu cintura",
  falda: "frente a tu falda",
};

function describeArm(vrm: VRM, side: "left" | "right"): string | null {
  const bone = (name: string) => vrm.humanoid?.getNormalizedBoneNode(name as VRMHumanBoneName) ?? null;
  const up = bone(`${side}UpperArm`);
  const low = bone(`${side}LowerArm`);
  const hand = bone(`${side}Hand`);
  if (!up || !low || !hand) return null;
  const s = side === "left" ? 1 : -1;
  const shoulder = up.getWorldPosition(new THREE.Vector3());
  const elbow = low.getWorldPosition(new THREE.Vector3());
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  const upperDir = elbow.clone().sub(shoulder).normalize();
  const foreDir = wrist.clone().sub(elbow).normalize();

  // 0 = colgando, 90 = horizontal, 180 = arriba.
  const elevation = deg(Math.acos(THREE.MathUtils.clamp(-upperDir.y, -1, 1)));
  // 0 = hacia afuera, +90 = adelante, -90 = atrás, ±180 = cruzando el cuerpo.
  const azimuth = deg(Math.atan2(upperDir.z, s * upperDir.x));
  const elbowFlex = deg(Math.acos(THREE.MathUtils.clamp(upperDir.dot(foreDir), -1, 1)));

  let where: string;
  if (elevation < 30) where = "colgando";
  else if (elevation > 150) where = "hacia arriba";
  else {
    const height = elevation < 70 ? "bajo" : elevation < 110 ? "a la altura del hombro" : "alto";
    const direction =
      Math.abs(azimuth) < 35
        ? "hacia tu costado"
        : azimuth >= 35 && azimuth < 125
          ? "hacia adelante"
          : azimuth <= -35 && azimuth > -125
            ? "hacia atrás"
            : "cruzando por delante del cuerpo";
    where = `${direction}, ${height}`;
  }
  const elbowText = elbowFlex < 15 ? "codo estirado" : `codo doblado ${Math.round(elbowFlex)}°`;

  // ¿Cerca de qué lugar quedó la mano? (los mismos de [LLEVAR_MANO]).
  const palm = wrist.clone().add(bone(`${side}MiddleProximal`)?.getWorldPosition(new THREE.Vector3()) ?? wrist).multiplyScalar(0.5);
  let nearest: { name: string; dist: number } | null = null;
  for (const name of Object.keys(REACH_PLACES)) {
    const point = placeWorldPoint(vrm, side, name);
    if (!point) continue;
    const dist = point.distanceTo(palm);
    if (!nearest || dist < nearest.dist) nearest = { name, dist };
  }
  const handText =
    nearest && nearest.dist < PLACE_NEAR_M ? `; la mano quedó ${PLACE_PHRASE[nearest.name] ?? `en tu ${nearest.name}`}` : "";
  // En reposo (colgando, codo estirado) no hay nada que contar.
  if (elevation < 30 && elbowFlex < 15 && !handText) return null;
  const angle = where === "colgando" ? "" : ` (${Math.round(elevation)}° desde colgando)`;
  const palmText = describePalm(vrm, side);
  return `- Brazo ${SIDE_LABEL_M[side]}: ${where}${angle}, ${elbowText}${handText}${palmText ? `; ${palmText}` : ""}.`;
}

// Hacia dónde mira la palma, en palabras: primero si mira a la cara o al
// cuerpo (cuando la mano está cerca), si no, la dirección que más pesa.
function describePalm(vrm: VRM, side: "left" | "right"): string | null {
  const palm = palmNormal(vrm, side);
  if (!palm) return null;
  const s = side === "left" ? 1 : -1;
  const pos = (name: VRMHumanBoneName) => vrm.humanoid?.getNormalizedBoneNode(name)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const head = pos("head")?.add(new THREE.Vector3(0, 0.07, 0));
  const chest = pos("chest");
  const facing = (point: THREE.Vector3 | null | undefined, maxDist: number) =>
    !!point && point.distanceTo(palm.center) < maxDist && palm.normal.dot(point.clone().sub(palm.center).normalize()) > 0.6;
  if (facing(head, 0.3)) return "la palma mira hacia tu cara";
  if (facing(chest, 0.35)) return "la palma mira hacia tu cuerpo";
  const n = palm.normal;
  const options: [number, string][] = [
    [n.y, "hacia arriba"],
    [-n.y, "hacia abajo"],
    [n.z, "hacia adelante"],
    [-n.z, "hacia atrás"],
    [s * n.x, "hacia afuera"],
    [-s * n.x, "hacia adentro"],
  ];
  options.sort((a, b) => b[0] - a[0]);
  return `la palma mira ${options[0][1]}`;
}

// Giro de `child` respecto de `parent`, en los ejes de siempre (x = arriba,
// y = girar a tu izquierda, z = ladear a tu izquierda).
function relativeTurn(vrm: VRM, child: VRMHumanBoneName, parent: VRMHumanBoneName) {
  const c = vrm.humanoid?.getNormalizedBoneNode(child);
  const p = vrm.humanoid?.getNormalizedBoneNode(parent);
  if (!c || !p) return null;
  const q = p.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(c.getWorldQuaternion(new THREE.Quaternion()));
  const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
  return { up: deg(e.x), left: deg(e.y), tiltLeft: deg(e.z) };
}

function describeTurn(label: string, turn: ReturnType<typeof relativeTurn>, words: { up: string; down: string }) {
  if (!turn) return null;
  const parts: string[] = [];
  if (Math.abs(turn.left) >= 8) parts.push(`girada ${Math.round(Math.abs(turn.left))}° hacia tu ${turn.left > 0 ? "izquierda" : "derecha"}`);
  if (Math.abs(turn.up) >= 8) parts.push(`${turn.up > 0 ? words.up : words.down} ${Math.round(Math.abs(turn.up))}°`);
  if (Math.abs(turn.tiltLeft) >= 8) parts.push(`ladeada ${Math.round(Math.abs(turn.tiltLeft))}° hacia tu ${turn.tiltLeft > 0 ? "izquierda" : "derecha"}`);
  return parts.length > 0 ? `- ${label}: ${parts.join(", ")}.` : null;
}

// --- Choques: segmentos con radio (cápsulas) por hueso. Los brazos
// arrancan un poco después del hombro: la unión con el pecho siempre "toca".
type Part = { label: string; a: THREE.Vector3; b: THREE.Vector3; radius: number; group: string };

function parts(vrm: VRM): Part[] {
  const pos = (name: string) => vrm.humanoid?.getNormalizedBoneNode(name as VRMHumanBoneName)?.getWorldPosition(new THREE.Vector3()) ?? null;
  const result: Part[] = [];
  const add = (label: string, a: THREE.Vector3 | null, b: THREE.Vector3 | null, radius: number, group: string) => {
    if (a && b) result.push({ label, a, b, radius, group });
  };
  const head = pos("head");
  // Radios calibrados con renders: con más, las manos apoyadas frente a la
  // falda o los brazos cruzados cerca del cuello contaban como choque (el
  // torso real es más ancho que profundo y la falda es tela con vuelo).
  add("tu cabeza", head, head?.clone().add(new THREE.Vector3(0, 0.12, 0)) ?? null, 0.085, "cuerpo");
  add("tu torso", pos("spine"), pos("neck"), 0.075, "cuerpo");
  add("tu cadera", pos("hips"), pos("spine"), 0.09, "cuerpo");
  for (const side of ["left", "right"] as const) {
    const shoulder = pos(`${side}UpperArm`);
    const elbow = pos(`${side}LowerArm`);
    const wrist = pos(`${side}Hand`);
    const knuckle = pos(`${side}MiddleProximal`);
    if (!shoulder || !elbow || !wrist) continue;
    add(`tu brazo ${SIDE_LABEL_M[side]}`, shoulder.clone().lerp(elbow, 0.45), elbow, 0.035, side);
    add(`tu antebrazo ${SIDE_LABEL_M[side]}`, elbow, wrist, 0.03, side);
    if (knuckle) add(`tu mano ${SIDE_LABEL[side]}`, wrist, knuckle.clone().sub(wrist).multiplyScalar(1.8).add(wrist), 0.035, side);
  }
  return result;
}

function segmentDistance(p: Part, q: Part): number {
  // Distancia mínima entre dos segmentos (muestreo fino: son cortos).
  let best = Infinity;
  const onQ = new THREE.Vector3();
  const line = new THREE.Line3(q.a, q.b);
  for (let i = 0; i <= 20; i++) {
    const point = p.a.clone().lerp(p.b, i / 20);
    line.closestPointToPoint(point, true, onQ);
    best = Math.min(best, point.distanceTo(onQ));
  }
  return best;
}

function describeCollisions(vrm: VRM): { collisions: string[]; handsTouch: boolean } {
  const all = parts(vrm);
  const found: string[] = [];
  let handsTouch = false;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const p = all[i];
      const q = all[j];
      // Solo brazo contra cuerpo o contra el otro brazo (no consigo mismo).
      if (p.group === q.group) continue;
      if (p.group === "cuerpo" && q.group === "cuerpo") continue;
      const depth = p.radius + q.radius - segmentDistance(p, q);
      // Las dos manos juntas es un gesto normal (juntarlas, entrelazarlas).
      if (p.label.startsWith("tu mano") && q.label.startsWith("tu mano")) {
        if (depth > 0) handsTouch = true;
        continue;
      }
      if (depth >= PENETRATION_MIN_M) {
        const [arm, other] = p.group === "cuerpo" ? [q, p] : [p, q];
        found.push(`- ${arm.label[0].toUpperCase()}${arm.label.slice(1)} atraviesa ${other.label} (unos ${Math.round(depth * 100)} cm).`);
      }
    }
  }
  return { collisions: found, handsTouch };
}

// Descripción completa, lista para el prompt (o null si no hay nada que
// decir: todo en reposo y sin choques).
export function describeBodyNow(vrm: VRM): string | null {
  vrm.scene.updateMatrixWorld(true);
  const lines = [
    describeTurn("Cabeza", relativeTurn(vrm, "head", "chest"), { up: "mirando hacia arriba", down: "mirando hacia abajo" }),
    describeTurn("Torso", relativeTurn(vrm, "chest", "hips"), { up: "echado hacia atrás", down: "inclinado hacia adelante" }),
    describeArm(vrm, "left"),
    describeArm(vrm, "right"),
  ].filter((l): l is string => l !== null);
  const { collisions, handsTouch } = describeCollisions(vrm);
  if (handsTouch) lines.push("- Tus manos se tocan.");
  if (collisions.length > 0) {
    lines.push("Choques (partes de tu cuerpo que se atraviesan; en una persona real no pasaría):", ...collisions);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
