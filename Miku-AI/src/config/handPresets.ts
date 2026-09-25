import { FingerKey, HandShape } from "../types";
import { FINGER_KEY_TO_VRM_NAME, FINGER_PHALANX_MAX_DEG } from "./boneRanges";

// Gestos de mano de partida. Todos se comprobaron en render (de frente y de
// costado) antes de ofrecérselos a Miku.
export const HAND_PRESET_SEEDS: Record<string, HandShape> = {
  handOpen: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  handRelaxed: { thumb: 15, index: 20, middle: 20, ring: 20, pinky: 20 },
  handFist: { thumb: 80, index: 100, middle: 100, ring: 100, pinky: 100, thumbAcross: 20 },
  handPoint: { thumb: 60, index: 0, middle: 100, ring: 100, pinky: 100, thumbAcross: 30 },
  handSpread: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 100, thumbOpen: 60 },
  handPeace: { thumb: 70, index: 0, middle: 0, ring: 100, pinky: 100, spread: 100, thumbAcross: 50 },
  handThumbsUp: { thumb: 0, index: 100, middle: 100, ring: 100, pinky: 100, thumbOpen: 20 },
  handOk: { thumb: 55, index: 70, middle: 10, ring: 15, pinky: 20, spread: 70, thumbAcross: 60 },
};

export const HAND_PRESET_DESCRIPTIONS: Record<string, string> = {
  handOpen: "mano abierta, dedos juntos",
  handRelaxed: "mano relajada, apenas curvada",
  handFist: "puño, con el pulgar por delante de los dedos",
  handPoint: "señalar con el índice",
  handSpread: "mano abierta con los dedos separados (saludar, mostrar cinco, sorpresa)",
  handPeace: "V de paz: índice y medio estirados y separados",
  handThumbsUp: "pulgar arriba",
  handOk: "OK: pulgar e índice haciendo un círculo",
};

export const HAND_PRESET_NAMES = Object.keys(HAND_PRESET_SEEDS);

// Pulgar: sus tres huesos son Metacarpal (la base, en la palma), Proximal y
// Distal -- no tiene "Intermediate" (nomenclatura VRM 1.0). Antes el código
// buscaba Proximal/Intermediate/Distal como en los demás dedos: la base
// nunca se movía y el pulgar no podía cruzar la palma.
const THUMB_CURL_DEG = { Metacarpal: 25, Proximal: 50, Distal: 70 };
const THUMB_ACROSS_MAX_DEG = 40;
const THUMB_OPEN_MAX_DEG = 35;
// Separar los dedos: el índice hacia el pulgar, anular y meñique hacia
// afuera (el medio queda de eje).
const SPREAD_MAX_DEG: Partial<Record<FingerKey, number>> = { index: 12, ring: -8, pinky: -18 };

export type FingerRotation = { bone: string; axis: "x" | "y" | "z"; deg: number };

// Grados sobre el reposo de cada hueso de la mano para una forma. Signos
// medidos en render con las dos manos: cerrar los dedos (z), cerrar el
// pulgar (y), separar (y) y abrir el pulgar (y) se espejan entre manos; cruzar
// el pulgar sobre la palma (x de la base) NO se espeja, como la x del brazo.
// Siempre devuelve todos los huesos y ejes que usa una mano, aunque sea en
// 0: así un gesto nuevo borra por completo al anterior.
export function handShapeRotations(side: "left" | "right", shape: HandShape): FingerRotation[] {
  const s = side === "right" ? 1 : -1;
  const rotations: FingerRotation[] = [];
  for (const finger of Object.keys(FINGER_KEY_TO_VRM_NAME) as FingerKey[]) {
    const vrmName = FINGER_KEY_TO_VRM_NAME[finger];
    const curl = (shape[finger] ?? 0) / 100;
    if (finger === "thumb") {
      const across = (shape.thumbAcross ?? 0) / 100;
      const open = (shape.thumbOpen ?? 0) / 100;
      rotations.push(
        { bone: `${side}ThumbMetacarpal`, axis: "x", deg: -(curl * THUMB_CURL_DEG.Metacarpal + across * THUMB_ACROSS_MAX_DEG) },
        { bone: `${side}ThumbMetacarpal`, axis: "y", deg: s * open * THUMB_OPEN_MAX_DEG },
        { bone: `${side}ThumbProximal`, axis: "y", deg: s * -curl * THUMB_CURL_DEG.Proximal },
        { bone: `${side}ThumbDistal`, axis: "y", deg: s * -curl * THUMB_CURL_DEG.Distal },
      );
      continue;
    }
    for (const phalanx of ["Proximal", "Intermediate", "Distal"] as const) {
      rotations.push({ bone: `${side}${vrmName}${phalanx}`, axis: "z", deg: s * -curl * FINGER_PHALANX_MAX_DEG[phalanx] });
    }
    rotations.push({ bone: `${side}${vrmName}Proximal`, axis: "y", deg: s * ((shape.spread ?? 0) / 100) * (SPREAD_MAX_DEG[finger] ?? 0) });
  }
  return rotations;
}
