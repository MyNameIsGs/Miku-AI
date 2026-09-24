import { FingerKey } from "../types";

// Versión de la tabla de abajo. Las intensidades son un porcentaje del
// rango, así que cambiar un rango cambia lo que significa cada número ya
// guardado (quirks, reacciones al tacto): ver lib/boneRangesMigration.ts.
export const BONE_RANGES_VERSION = 2;
// Cuándo pasó a la versión 2 (el aviso a Miku en su prompt usa esta fecha).
export const BONE_RANGES_V2_DATE = "2026-09-24";

// Versión 2: rangos humanos. Cada eje se midió con el modelo real (el
// ángulo que produce en el cuerpo, no el número del hueso) y se comparó
// con las tablas clínicas de movilidad articular; los extremos nuevos se
// comprobaron en render. Lo que cambió respecto de la versión 1:
// - Brazo hacia adelante (UpperArm.x+): 30° → 180°. Con 30° no podía
//   estirar el brazo al frente, y el prompt le enseñaba a hacerlo girando
//   la clavícula (Shoulder.x ±90°; una real gira ~15-40°).
// - Brazo hacia el cuerpo (UpperArm.z, izq +/der -): 100° → 20°. Con +20
//   el brazo ya cuelga vertical; pasado eso se mete dentro del torso.
// - Antebrazo (LowerArm.x): 0..140° (un solo sentido) → ±90°. Con el codo
//   doblado es girar el antebrazo hacia adentro (-, manos frente al
//   cuerpo) o hacia afuera (+); el sentido de adentro estaba bloqueado.
// - Codo de costado (LowerArm.z): ±140° → ±10°. El codo es una bisagra.
// - Muñeca hacia la palma / atrás (Hand.z): 15/20° → 80/70°.
// - Cabeza + cuello: giro ±130° → ±80°; abajo/arriba 70/64° → 50/60°;
//   ladeo 56° → 45°. Torso: adelante 40° → 70°, giro ±60° → ±45°.
// Signos: x igual en los dos lados; y, z espejados entre izquierda y derecha.
export const BONE_RANGES_DEG: Record<
  string,
  Record<"x" | "y" | "z", [number, number]>
> = {
  head: { x: [-30, 30], y: [-50, 50], z: [-25, 25] },
  neck: { x: [-20, 30], y: [-30, 30], z: [-20, 20] },
  chest: { x: [-30, 15], y: [-35, 35], z: [-20, 20] },
  spine: { x: [-40, 15], y: [-10, 10], z: [-15, 15] },
  leftShoulder: { x: [-20, 20], y: [-20, 20], z: [-30, 10] },
  rightShoulder: { x: [-20, 20], y: [-20, 20], z: [-10, 30] },
  leftUpperArm: { x: [-60, 180], y: [-120, 45], z: [-160, 20] },
  rightUpperArm: { x: [-60, 180], y: [-45, 120], z: [-20, 160] },
  leftLowerArm: { x: [-90, 90], y: [-150, 0], z: [-10, 10] },
  rightLowerArm: { x: [-90, 90], y: [0, 150], z: [-10, 10] },
  leftHand: { x: [-15, 15], y: [-20, 30], z: [-70, 80] },
  rightHand: { x: [-15, 15], y: [-30, 20], z: [-80, 70] },
};

export const MOVEMENT_BONE_NAMES = Object.keys(BONE_RANGES_DEG);

export const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;

export const FINGER_KEY_TO_VRM_NAME: Record<FingerKey, (typeof FINGER_NAMES)[number]> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Little",
};

export const FINGER_PHALANX_MAX_DEG: Record<
  "Proximal" | "Intermediate" | "Distal",
  number
> = {
  Proximal: 80,
  Intermediate: 100,
  Distal: 70,
};

export function fingerBoneNames(side: "left" | "right"): string[] {
  const names: string[] = [];
  for (const finger of FINGER_NAMES) {
    names.push(`${side}${finger}Proximal`);
    names.push(`${side}${finger}Intermediate`);
    names.push(`${side}${finger}Distal`);
  }
  return names;
}

export const HAND_FINGER_BONE_NAMES = [
  ...fingerBoneNames("left"),
  ...fingerBoneNames("right"),
];

export const CREATE_GESTURE_FINGER_LABELS: Record<string, FingerKey> = {
  pulgar: "thumb",
  indice: "index",
  índice: "index",
  medio: "middle",
  anular: "ring",
  menique: "pinky",
  meñique: "pinky",
};
