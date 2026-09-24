import { BONE_RANGES_DEG } from "../config/boneRanges";
import { intensityToDegrees } from "../hooks/useMovement";
import { ParsedMovement } from "../types";

// Las intensidades son un porcentaje del rango de cada hueso: al pasar a
// los rangos humanos (versión 2, ver config/boneRanges.ts) el mismo número
// movería distinto. Las poses que Miku ya guardó (quirks, reacciones al
// tacto) se convierten una vez para que se vean exactamente igual que
// antes; si una pose usaba más de lo que un cuerpo humano puede (ej. el
// codo doblado de costado), se recorta al nuevo límite. Qué hacer con
// ellas ahora que puede llegar más lejos lo decide ella: se le avisa en el
// prompt (ver buildMovementInstructions).

// Tabla de la versión 1, tal como estaba antes del cambio.
const BONE_RANGES_DEG_V1: Record<string, Record<"x" | "y" | "z", [number, number]>> = {
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

// Inversa de intensityToDegrees con los rangos actuales.
function degreesToIntensity(deg: number, minDeg: number, maxDeg: number): number {
  let intensity = 0;
  if (deg > 0 && maxDeg > 0) intensity = (deg / maxDeg) * 100;
  else if (deg < 0 && minDeg < 0) intensity = -(deg / minDeg) * 100;
  return Math.round(Math.max(-100, Math.min(100, intensity)) * 10) / 10;
}

// Misma pose (en grados) expresada con los rangos de la versión 2.
export function migrateEntriesV1toV2(entries: ParsedMovement["entries"]): ParsedMovement["entries"] {
  return entries.map((entry) => {
    const oldRange = BONE_RANGES_DEG_V1[entry.bone]?.[entry.axis];
    const newRange = BONE_RANGES_DEG[entry.bone]?.[entry.axis];
    if (!oldRange || !newRange) return entry;
    const deg = intensityToDegrees(entry.intensity, oldRange[0], oldRange[1]);
    return { ...entry, intensity: degreesToIntensity(deg, newRange[0], newRange[1]) };
  });
}
