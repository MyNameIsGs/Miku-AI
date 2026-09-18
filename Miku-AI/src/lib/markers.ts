import {
  DEFAULT_MOVEMENT_DURATION_MS,
  DEFAULT_HAND_GESTURE_DURATION_MS,
  VOICE_PITCH_MIN,
  VOICE_PITCH_MAX,
  VOICE_RATE_MIN,
  VOICE_RATE_MAX,
} from "../config/constants";
import {
  BONE_RANGES_DEG,
  CREATE_GESTURE_FINGER_LABELS,
} from "../config/boneRanges";
import {
  ParsedMovement,
  ParsedHandGesture,
  ParsedGestureCreation,
  FingerCurls,
} from "../types";

export function parseMovementMarker(text: string): ParsedMovement | null {
  const match = text.match(/\[MOVIMIENTO:\s*([\s\S]*?)\]/i);
  if (!match) return null;

  const parts = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const entries: ParsedMovement["entries"] = [];
  let durationMs = DEFAULT_MOVEMENT_DURATION_MS;
  let animated = false;

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.toLowerCase();

    if (key === "duracion") {
      const num = parseFloat(rawValue.replace(/s$/i, ""));
      if (!Number.isNaN(num) && num > 0) durationMs = num * 1000;
      continue;
    }
    if (key === "animado") {
      animated = /^(si|sí|yes|true)$/i.test(rawValue);
      continue;
    }

    const [bone, axis] = rawKey.split(".");
    if (!bone || !axis || !["x", "y", "z"].includes(axis)) continue;
    if (!BONE_RANGES_DEG[bone]) continue;

    const intensity = parseFloat(rawValue);
    if (Number.isNaN(intensity)) continue;

    entries.push({ bone, axis: axis as "x" | "y" | "z", intensity });
  }

  return entries.length > 0 ? { entries, durationMs, animated } : null;
}

export function parseHandGestureMarker(text: string): ParsedHandGesture | null {
  const match = text.match(/\[GESTO_MANO:\s*([\s\S]*?)\]/i);
  if (!match) return null;

  const parts = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let left: string | undefined;
  let right: string | undefined;
  let durationMs = DEFAULT_HAND_GESTURE_DURATION_MS;

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.toLowerCase();

    if (key === "duracion") {
      const num = parseFloat(rawValue.replace(/s$/i, ""));
      if (!Number.isNaN(num) && num > 0) durationMs = num * 1000;
      continue;
    }
    if (key === "izq" && rawValue) left = rawValue;
    if (key === "der" && rawValue) right = rawValue;
  }

  return left || right ? { left, right, durationMs } : null;
}

export function parseCreateHandGestureMarker(
  text: string,
): ParsedGestureCreation | null {
  const match = text.match(/\[CREAR_GESTO_MANO:\s*([\s\S]*?)\]/i);
  if (!match) return null;

  const parts = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let name: string | undefined;
  let animated = false;
  const curls: Partial<FingerCurls> = {};

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.toLowerCase();

    if (key === "nombre") {
      name = rawValue.replace(/[^a-zA-Z0-9_]/g, "");
      continue;
    }
    if (key === "animado") {
      animated = /^(si|sí|yes|true)$/i.test(rawValue);
      continue;
    }
    if (key === "mano") continue;

    const fingerKey = CREATE_GESTURE_FINGER_LABELS[key];
    if (fingerKey) {
      const num = parseFloat(rawValue);
      if (!Number.isNaN(num)) {
        curls[fingerKey] = Math.max(0, Math.min(100, num));
      }
    }
  }

  if (!name) return null;

  const completeCurls: FingerCurls = {
    thumb: curls.thumb ?? 0,
    index: curls.index ?? 0,
    middle: curls.middle ?? 0,
    ring: curls.ring ?? 0,
    pinky: curls.pinky ?? 0,
  };

  return { name, curls: completeCurls, animated };
}

// Fase 7: creación/confirmación de quirks propios. Formato análogo a
// [MOVIMIENTO] (mismos pares hueso.eje=intensidad) más nombre= y, opcional,
// mano_izq=/mano_der= con el nombre de un preset o gesto propio ya
// existente -- un quirk combina cuerpo y manos en una sola definición.
export interface ParsedQuirkCreation {
  name: string;
  entries: { bone: string; axis: "x" | "y" | "z"; intensity: number }[];
  durationMs: number;
  animated: boolean;
  handLeft?: string;
  handRight?: string;
}

export function parseCreateQuirkMarker(text: string): ParsedQuirkCreation | null {
  const match = text.match(/\[CREAR_QUIRK:\s*([\s\S]*?)\]/i);
  if (!match) return null;

  const parts = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let name: string | undefined;
  let durationMs = DEFAULT_MOVEMENT_DURATION_MS;
  let animated = false;
  let handLeft: string | undefined;
  let handRight: string | undefined;
  const entries: ParsedQuirkCreation["entries"] = [];

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=").map((s) => s.trim());
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.toLowerCase();

    if (key === "nombre") {
      name = rawValue.replace(/[^a-zA-Z0-9_]/g, "");
      continue;
    }
    if (key === "duracion") {
      const num = parseFloat(rawValue.replace(/s$/i, ""));
      if (!Number.isNaN(num) && num > 0) durationMs = num * 1000;
      continue;
    }
    if (key === "animado") {
      animated = /^(si|sí|yes|true)$/i.test(rawValue);
      continue;
    }
    if (key === "mano_izq" && rawValue) {
      handLeft = rawValue;
      continue;
    }
    if (key === "mano_der" && rawValue) {
      handRight = rawValue;
      continue;
    }

    const [bone, axis] = rawKey.split(".");
    if (!bone || !axis || !["x", "y", "z"].includes(axis)) continue;
    if (!BONE_RANGES_DEG[bone]) continue;

    const intensity = parseFloat(rawValue);
    if (Number.isNaN(intensity)) continue;

    entries.push({ bone, axis: axis as "x" | "y" | "z", intensity });
  }

  if (!name) return null;
  if (entries.length === 0 && !handLeft && !handRight) return null;

  return { name, entries, durationMs, animated, handLeft, handRight };
}

export function parseQuirkReadyMarker(text: string): string | null {
  const match = text.match(/\[QUIRK_LISTO:\s*([\s\S]*?)\]/i);
  if (!match) return null;
  const name = match[1].trim().replace(/[^a-zA-Z0-9_]/g, "");
  return name || null;
}

export function stripMarkers(text: string): string {
  return text
    .replace(/\[GUARDAR_PERSONALIDAD:[\s\S]*?\]/g, "")
    .replace(/\[GUARDAR_MEMORIA:[\s\S]*?\]/g, "")
    .replace(/\[EXPRESION:\s*(happy|angry|sad|relaxed|neutral)\]/gi, "")
    .replace(/\[VOZ_PITCH:\s*-?\d+(?:\.\d+)?\]/gi, "")
    .replace(/\[VOZ_RATE:\s*-?\d+(?:\.\d+)?\]/gi, "")
    .replace(/\[MOVIMIENTO:[\s\S]*?\]/gi, "")
    .replace(/\[GESTO_MANO:[\s\S]*?\]/gi, "")
    .replace(/\[CREAR_GESTO_MANO:[\s\S]*?\]/gi, "")
    .replace(/\[CREAR_QUIRK:[\s\S]*?\]/gi, "")
    .replace(/\[QUIRK_LISTO:[\s\S]*?\]/gi, "")
    .trim();
}

export interface ParsedMarkersResult {
  personalityUpdates: string[];
  memoryUpdates: string[];
  expression: string;
  pitch: number;
  rate: number;
  movement: ParsedMovement | null;
  // ORDEN CRÍTICO: createHandGesture debe aplicarse ANTES de handGesture
  createHandGesture: ParsedGestureCreation | null;
  handGesture: ParsedHandGesture | null;
  // Fase 7: solo los usa el loop idle (ver useIdleQuirks.ts) -- la
  // conversación normal nunca instruye estos marcadores.
  createQuirk: ParsedQuirkCreation | null;
  quirkReady: string | null;
  cleanText: string;
}

export function parseMarkers(
  reply: string,
  basePitch: number,
  baseRate: number,
): ParsedMarkersResult {
  const personalityUpdates = [
    ...reply.matchAll(/\[GUARDAR_PERSONALIDAD:\s*([\s\S]*?)\]/g),
  ].map((m) => m[1].trim());

  const memoryUpdates = [
    ...reply.matchAll(/\[GUARDAR_MEMORIA:\s*([\s\S]*?)\]/g),
  ].map((m) => m[1].trim());

  const expressionMatches = [
    ...reply.matchAll(
      /\[EXPRESION:\s*(happy|angry|sad|relaxed|neutral)\]/gi,
    ),
  ];
  const expression =
    expressionMatches.length > 0
      ? expressionMatches[expressionMatches.length - 1][1].toLowerCase()
      : "neutral";

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const pitchMatches = [
    ...reply.matchAll(/\[VOZ_PITCH:\s*(-?\d+(?:\.\d+)?)\]/gi),
  ];
  let messagePitch = basePitch;
  if (pitchMatches.length > 0) {
    const parsed = Number(pitchMatches[pitchMatches.length - 1][1]);
    if (!Number.isNaN(parsed)) {
      messagePitch = clamp(parsed, VOICE_PITCH_MIN, VOICE_PITCH_MAX);
    }
  }

  const rateMatches = [
    ...reply.matchAll(/\[VOZ_RATE:\s*(-?\d+(?:\.\d+)?)\]/gi),
  ];
  let messageRate = baseRate;
  if (rateMatches.length > 0) {
    const parsed = Number(rateMatches[rateMatches.length - 1][1]);
    if (!Number.isNaN(parsed)) {
      messageRate = clamp(parsed, VOICE_RATE_MIN, VOICE_RATE_MAX);
    }
  }

  const movement = parseMovementMarker(reply);

  // NOTA CRÍTICA DE ORDEN:
  // parseCreateHandGestureMarker debe evaluarse antes que parseHandGestureMarker
  // para permitir que Miku cree y use un gesto en la misma respuesta.
  const createHandGesture = parseCreateHandGestureMarker(reply);
  const handGesture = parseHandGestureMarker(reply);

  const createQuirk = parseCreateQuirkMarker(reply);
  const quirkReady = parseQuirkReadyMarker(reply);

  const cleanText = stripMarkers(reply);

  return {
    personalityUpdates,
    memoryUpdates,
    expression,
    pitch: messagePitch,
    rate: messageRate,
    movement,
    createHandGesture,
    handGesture,
    createQuirk,
    quirkReady,
    cleanText,
  };
}
