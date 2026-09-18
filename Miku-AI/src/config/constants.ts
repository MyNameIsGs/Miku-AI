export const WIDTH = 750;
export const HEIGHT = 680;

export const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-vision-exp";

export const MAX_HISTORY_TURNS = 20;

export const MEMORY_CONSOLIDATION_THRESHOLD = 5;

export const VOICE_PITCH_MIN = -24;
export const VOICE_PITCH_MAX = 48;
export const VOICE_RATE_MIN = -60;
export const VOICE_RATE_MAX = 100;

export const IDLE_QUIRK_INTERVAL_MS = 150000; // 2.5 minutos

// Fase 7: en cada tick idle, si ya tiene al menos un quirk propio guardado,
// esta es la probabilidad de correrlo directamente (sin llamar al LLM) en
// vez de preguntarle qué quiere hacer. Sin calibrar contra uso real todavía.
export const DIRECT_QUIRK_RUN_CHANCE = 0.5;

export const DEFAULT_MOVEMENT_DURATION_MS = 1000;
export const DEFAULT_HAND_GESTURE_DURATION_MS = 400;

export const EXPRESSION_SMOOTHING = 0.08;
export const GAZE_SMOOTHING = 0.03;
export const DOUBLE_BLINK_CHANCE = 0.05;

export const VOICE_SERVER_URL = "http://127.0.0.1:8899";
export const REPO_ROOT = import.meta.env.VITE_REPO_ROOT ?? "";
