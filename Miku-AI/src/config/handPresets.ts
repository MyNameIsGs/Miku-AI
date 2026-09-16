import { FingerCurls } from "../types";

export const HAND_PRESET_SEEDS: Record<string, FingerCurls> = {
  handOpen: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  handRelaxed: { thumb: 15, index: 20, middle: 20, ring: 20, pinky: 20 },
  handFist: { thumb: 90, index: 100, middle: 100, ring: 100, pinky: 100 },
  handPoint: { thumb: 60, index: 0, middle: 100, ring: 100, pinky: 100 },
};

export const HAND_PRESET_NAMES = Object.keys(HAND_PRESET_SEEDS);
