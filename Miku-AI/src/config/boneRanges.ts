import { FingerKey } from "../types";

export const BONE_RANGES_DEG: Record<
  string,
  Record<"x" | "y" | "z", [number, number]>
> = {
  head: { x: [-50, 40], y: [-80, 80], z: [-36, 36] },
  neck: { x: [-20, 24], y: [-50, 50], z: [-20, 20] },
  chest: { x: [-24, 16], y: [-36, 36], z: [-20, 20] },
  spine: { x: [-16, 16], y: [-24, 24], z: [-16, 16] },
  leftShoulder: { x: [-90, 90], y: [-80, 40], z: [-30, 30] },
  rightShoulder: { x: [-90, 90], y: [-40, 80], z: [-30, 30] },
  leftUpperArm: { x: [-80, 30], y: [-90, 95], z: [-170, 100] },
  rightUpperArm: { x: [-80, 30], y: [-95, 90], z: [-100, 170] },
  leftLowerArm: { x: [0, 140], y: [-140, 0], z: [-140, 140] },
  rightLowerArm: { x: [0, 140], y: [-0, 140], z: [-140, 140] },
  leftHand: { x: [-20, 15], y: [-10, 30], z: [-20, 15] },
  rightHand: { x: [-20, 15], y: [-30, 10], z: [-15, 20] },
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
