import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRMLoaderPlugin, VRM, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { load } from "@tauri-apps/plugin-store";
import "./App.css";
import {
  loadMemoryContext,
  appendToMemoryFile,
  backupAndOverwriteMemoryFile,
} from "./memory";
import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { Child } from "@tauri-apps/plugin-shell";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

const WIDTH = 750;
const HEIGHT = 680;

const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-vision-exp";

const MAX_HISTORY_TURNS = 20;

const MEMORY_CONSOLIDATION_THRESHOLD = 5;

const VOICE_PITCH_MIN = -24;
const VOICE_PITCH_MAX = 48;
const VOICE_RATE_MIN = -60;
const VOICE_RATE_MAX = 100;

// Tarea 3.1, Paso 3: cada cuánto tiempo de silencio (sin interacción NI
// quirk previo) se considera un momento para preguntarle si quiere hacer
// un gesto espontáneo. Cada disparo es una llamada real al LLM.
const IDLE_QUIRK_INTERVAL_MS = 150000; // 2.5 minutos

const BONE_RANGES_DEG: Record<
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

const MOVEMENT_BONE_NAMES = Object.keys(BONE_RANGES_DEG);

const DEFAULT_MOVEMENT_DURATION_MS = 1000;

type MovementOrigin = "response" | "idle";

type BoneTransition = {
  startValue: number;
  targetValue: number;
  startTime: number;
  duration: number; // si animated=true, se interpreta como período del ciclo
  origin: MovementOrigin;
  animated: boolean;
};

// Tarea 3.1, Paso 3: cuándo y adónde debe volver solo un hueso después de
// un quirk (movimiento idle espontáneo), sin que nadie se lo pida.
type PendingQuirkRevert = {
  revertAt: number; // performance.now() objetivo
  revertToValue: number; // radianes -- lo que tenía ANTES del quirk
  revertDuration: number; // ms
};

type ParsedMovement = {
  entries: { bone: string; axis: "x" | "y" | "z"; intensity: number }[];
  durationMs: number;
  animated: boolean;
};

function intensityToDegrees(
  intensity: number,
  minDeg: number,
  maxDeg: number,
): number {
  const clamped = Math.max(-100, Math.min(100, intensity));
  if (clamped >= 0) return (clamped / 100) * maxDeg;
  return (-clamped / 100) * minDeg;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function parseMovementMarker(text: string): ParsedMovement | null {
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

const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;
type FingerKey = "thumb" | "index" | "middle" | "ring" | "pinky";
const FINGER_KEY_TO_VRM_NAME: Record<FingerKey, (typeof FINGER_NAMES)[number]> =
  {
    thumb: "Thumb",
    index: "Index",
    middle: "Middle",
    ring: "Ring",
    pinky: "Little",
  };

const FINGER_PHALANX_MAX_DEG: Record<
  "Proximal" | "Intermediate" | "Distal",
  number
> = {
  Proximal: 80,
  Intermediate: 100,
  Distal: 70,
};

function fingerBoneNames(side: "left" | "right"): string[] {
  const names: string[] = [];
  for (const finger of FINGER_NAMES) {
    names.push(`${side}${finger}Proximal`);
    names.push(`${side}${finger}Intermediate`);
    names.push(`${side}${finger}Distal`);
  }
  return names;
}

const HAND_FINGER_BONE_NAMES = [
  ...fingerBoneNames("left"),
  ...fingerBoneNames("right"),
];

type FingerCurls = Record<FingerKey, number>;

const HAND_PRESET_SEEDS: Record<string, FingerCurls> = {
  handOpen: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  handRelaxed: { thumb: 15, index: 20, middle: 20, ring: 20, pinky: 20 },
  handFist: { thumb: 90, index: 100, middle: 100, ring: 100, pinky: 100 },
  handPoint: { thumb: 60, index: 0, middle: 100, ring: 100, pinky: 100 },
};

const HAND_PRESET_NAMES = Object.keys(HAND_PRESET_SEEDS);
const DEFAULT_HAND_GESTURE_DURATION_MS = 400;

type ParsedHandGesture = {
  left?: string;
  right?: string;
  durationMs: number;
};

// Ya no valida el nombre contra la lista de presets acá -- ahora puede ser
// también un gesto personalizado que Miku haya creado. La validación real
// pasa a scheduleHandGesture()/getHandGestureDefinition(), que revisa
// ambas fuentes.
function parseHandGestureMarker(text: string): ParsedHandGesture | null {
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

// --- Tarea 3.1, Paso 2b: creación de gestos de mano propios ---
type ParsedGestureCreation = {
  name: string;
  curls: FingerCurls;
  animated: boolean;
};

const CREATE_GESTURE_FINGER_LABELS: Record<string, FingerKey> = {
  pulgar: "thumb",
  indice: "index",
  índice: "index",
  medio: "middle",
  anular: "ring",
  menique: "pinky",
  meñique: "pinky",
};

// Extrae [CREAR_GESTO_MANO: nombre=..., pulgar=N, indice=N, medio=N,
// anular=N, menique=N, animado=si|no]. El campo "mano" (si viene) se
// ignora a propósito -- un gesto creado sirve para cualquier lado, igual
// que los presets semilla, que ya se aplican indistintamente con izq=/der=.
function parseCreateHandGestureMarker(
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

// --- Tarea 3.1, Parte B: descripción numérica objetiva del último
// movimiento (% del rango pedido, no palabras de dirección -- ver
// contexto del proyecto para por qué se descartó la versión en prosa).
function describeSelfMovement(
  movement: ParsedMovement | null,
  handGesture: ParsedHandGesture | null,
): string | null {
  const lines: string[] = [];

  if (movement) {
    lines.push(
      "Último movimiento -- cada valor es el % del rango que pediste hacia ese lado:",
    );
    for (const { bone, axis, intensity } of movement.entries) {
      const pct = Math.abs(Math.round(intensity));
      const nearLimit = pct >= 95 ? " -- casi sin margen en esa dirección" : "";
      const animatedLabel = movement.animated ? " (oscilando)" : "";
      lines.push(
        `${bone}.${axis}: ${intensity}${animatedLabel} (${pct}% del límite hacia ese lado${nearLimit})`,
      );
    }
  }

  if (handGesture?.left) {
    lines.push(`Mano izquierda: gesto "${handGesture.left}"`);
  }
  if (handGesture?.right) {
    lines.push(`Mano derecha: gesto "${handGesture.right}"`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type ChatContent = string | ChatContentPart[];
type ChatMessage = { role: "user" | "assistant"; content: ChatContent };

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchOpenRouterWithRetry(
  body: object,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<Response> {
  const delaysMs = [2000, 5000, 10000];
  let lastResponse: Response;

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    lastResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (lastResponse.status !== 429 || attempt === delaysMs.length) {
      return lastResponse;
    }

    const delay = delaysMs[attempt];
    console.log(
      `[INFO] OpenRouter devolvió 429, reintentando en ${delay}ms (intento ${attempt + 1}/${delaysMs.length})...`,
    );
    onRetry?.(attempt + 1, delaysMs.length, delay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return lastResponse!;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const appWindow = getCurrentWindow();
  const vrmRef = useRef<VRM | null>(null);
  const activeExpressionRef = useRef<string>("neutral");
  const isSpeakingRef = useRef(false);
  const [voicePitch, setVoicePitch] = useState(10);
  const [voiceRate, setVoiceRate] = useState(15);
  const [showConfig, setShowConfig] = useState(false);
  const [hideResponseText, setHideResponseText] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const [isVrmLoaded, setIsVrmLoaded] = useState(false);
  const isMikuReady = isVoiceReady && isVrmLoaded;

  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const voiceServerChildRef = useRef<Child | null>(null);
  const hasLaunched = useRef(false);
  const isVoiceSettingsLoaded = useRef(false);

  const transcriptRef = useRef<HTMLTextAreaElement>(null);

  const conversationHistoryRef = useRef<ChatMessage[]>([]);

  const memoryWriteCountRef = useRef(0);
  const isMemoryCountLoaded = useRef(false);

  // Tarea 3.1, Paso 3: silencio se mide desde lo último de estas dos cosas
  // que haya pasado -- una interacción real, o el último quirk (para que
  // los quirks no se disparen en cadena sin pausa).
  const lastInteractionTimeRef = useRef(performance.now());
  const lastQuirkTimeRef = useRef(performance.now());
  const isQuirkPendingRef = useRef(false);

  const movementBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const boneTransitionsRef = useRef<Record<string, BoneTransition>>({});
  const pendingQuirkRevertsRef = useRef<Record<string, PendingQuirkRevert>>({});
  const fingerBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const selfImageCaptureAtRef = useRef<number | null>(null);
  const lastSelfImageRef = useRef<string | null>(null);
  const pendingSelfDescriptionRef = useRef<string | null>(null);
  const boneRestRotationRef = useRef<
    Record<string, { x: number; y: number; z: number }>
  >({});

  // --- Tarea 3.1, Paso 2b: gestos de mano personalizados y animación ---
  // Gestos creados por Miku, persistidos en .settings.dat (no en memory.ts:
  // son datos estructurados, no texto libre de personalidad).
  const customHandGesturesRef = useRef<
    Record<string, FingerCurls & { animated: boolean }>
  >({});
  const isCustomGesturesLoaded = useRef(false);
  // Qué lado tiene activo un gesto animado en este momento (los dedos
  // oscilan mientras esto sea true; se apaga al programar cualquier otro
  // gesto para ese mismo lado, animado o no).
  const animatedHandSidesRef = useRef<Record<"left" | "right", boolean>>({
    left: false,
    right: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const savedPitch = await store.get<number>("voicePitch");
        const savedRate = await store.get<number>("voiceRate");
        const savedCount = await store.get<number>("memoryWriteCount");
        const savedGestures =
          await store.get<Record<string, FingerCurls & { animated: boolean }>>(
            "customHandGestures",
          );
        if (savedPitch !== null && savedPitch !== undefined)
          setVoicePitch(savedPitch);
        if (savedRate !== null && savedRate !== undefined)
          setVoiceRate(savedRate);
        if (savedCount !== null && savedCount !== undefined)
          memoryWriteCountRef.current = savedCount;
        if (savedGestures) customHandGesturesRef.current = savedGestures;
        isVoiceSettingsLoaded.current = true;
        isMemoryCountLoaded.current = true;
        isCustomGesturesLoaded.current = true;
      } catch (err) {
        console.error("Error cargando configuración de voz guardada:", err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isVoiceSettingsLoaded.current) return;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("voicePitch", voicePitch);
        await store.save();
      } catch (err) {
        console.error("Error guardando pitch:", err);
      }
    })();
  }, [voicePitch]);

  useEffect(() => {
    if (!isVoiceSettingsLoaded.current) return;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("voiceRate", voiceRate);
        await store.save();
      } catch (err) {
        console.error("Error guardando rate:", err);
      }
    })();
  }, [voiceRate]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const maxHeight = 80;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [transcript, showTextInput]);

  useEffect(() => {
    if (showTextInput && transcriptRef.current) {
      transcriptRef.current.focus();
    }
  }, [showTextInput]);

  useEffect(() => {
    if (hasLaunched.current) return;
    hasLaunched.current = true;

    let checkTimer: number | null = null;
    let isReady = false;

    const markVoiceReady = () => {
      if (!isReady) {
        isReady = true;
        setIsVoiceReady(true);
        if (checkTimer !== null) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
      }
    };

    const command = Command.sidecar("binaries/miku-voice-server", [], {
      env: {
        SystemRoot: "C:\\Windows",
        SYSTEMROOT: "C:\\Windows",
        PATH: "C:\\Windows\\System32;C:\\Windows;C:\\ffmpeg\\bin",
        PYTHONUNBUFFERED: "1",
      },
    });

    command.stdout.on("data", (line) => {
      invoke("log_to_terminal", { msg: `[voice-server] ${line}` });
      if (line.includes("Servidor listo") || line.includes("127.0.0.1:8899")) {
        markVoiceReady();
      }
    });
    command.stderr.on("data", (line) =>
      invoke("log_to_terminal", { msg: `[voice-server][err] ${line}` }),
    );

    command
      .spawn()
      .then((child) => {
        console.log("Servidor iniciado con PID:", child.pid);
        voiceServerChildRef.current = child;

        checkTimer = window.setInterval(async () => {
          if (isReady) return;
          try {
            const res = await fetch("http://127.0.0.1:8899/speak", {
              method: "OPTIONS",
            });
            if (res.ok || res.status > 0) {
              markVoiceReady();
            }
          } catch {
            // El servidor aún está iniciando y cargando el modelo RVC
          }
        }, 1000);
      })
      .catch((err) => {
        console.error("Fallo crítico al iniciar el sidecar de voz:", err);
      });

    return () => {
      if (checkTimer !== null) {
        clearInterval(checkTimer);
      }
      voiceServerChildRef.current?.kill().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enabled = freeCamera;
    }
  }, [freeCamera]);

  useEffect(() => {
    appWindow.setIgnoreCursorEvents(clickThrough);
  }, [clickThrough]);

  useEffect(() => {
    let isPressed = false;
    register("CommandOrControl+Shift+M", (event) => {
      if (event.state === "Pressed" && !isPressed) {
        isPressed = true;
        setClickThrough((v) => !v);
      } else if (event.state === "Released") {
        isPressed = false;
      }
    }).catch((err) => console.error("Error registrando atajo:", err));

    return () => {
      unregister("CommandOrControl+Shift+M").catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await fetch("http://127.0.0.1:8899/shutdown", { method: "POST" }).catch(
          () => {},
        );
      } catch {}
      try {
        await invoke("kill_voice_server");
      } catch {}
      if (voiceServerChildRef.current) {
        await voiceServerChildRef.current.kill().catch(() => {});
      }
      await appWindow.destroy();
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error("Web Speech API no está disponible en este entorno.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-ES";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      setTranscript((prev) => (finalText ? prev + " " + finalText : prev));
      if (interimText) setTranscript((prev) => prev);
    };

    recognition.onerror = (event: any) => {
      console.error("Error de reconocimiento de voz:", event.error);
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        recognition.start();
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  const listeningRef = useRef(false);
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const toggleListening = () => {
    if (!recognitionRef.current || !isVoiceReady) return;

    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      setTranscript("");
      recognitionRef.current.start();
      setListening(true);
      setShowTextInput(true);
    }
  };

  const [llmResponse, setLlmResponse] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const handlePasteImage = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setAttachedImage(reader.result as string);
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
      }
    }
  };

  const handlePickImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (!selected || typeof selected !== "string") return;

      const bytes = await readFile(selected);
      const ext = selected.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" ? "jpeg" : ext;
      const base64 = uint8ToBase64(bytes);
      setAttachedImage(`data:image/${mime};base64,${base64}`);
    } catch (err) {
      console.error("Error seleccionando imagen:", err);
    }
  };

  // Tarea 3.1, Paso 3: autoRevertDelayMs es opcional -- cuando se usa (para
  // quirks idle), después de duracion+autoRevertDelayMs el hueso vuelve
  // solo a lo que tenía ANTES de este movimiento (no al reposo absoluto,
  // respeta una pose permanente que estuviera sostenida).
  function scheduleMovement(
    parsed: ParsedMovement,
    origin: MovementOrigin,
    autoRevertDelayMs?: number,
  ) {
    const now = performance.now();
    for (const { bone, axis, intensity } of parsed.entries) {
      const range = BONE_RANGES_DEG[bone]?.[axis];
      const boneNode = movementBonesRef.current[bone];
      console.log(
        `[DEBUG-MOV] ${bone}.${axis}=${intensity} → range=${range ? range.join(",") : "SIN RANGO"} boneNode=${boneNode ? "OK" : "NULL"}`,
      );
      if (!range || !boneNode) continue;

      const key = `${bone}.${axis}`;
      const restRad = boneRestRotationRef.current[bone]?.[axis] ?? 0;
      const offsetRad =
        (intensityToDegrees(intensity, range[0], range[1]) * Math.PI) / 180;
      const targetRad = restRad + offsetRad;
      const currentValue = boneNode.rotation[axis];

      boneTransitionsRef.current[key] = {
        startValue: currentValue,
        targetValue: targetRad,
        startTime: now,
        duration: parsed.durationMs,
        origin,
        animated: parsed.animated,
      };

      if (autoRevertDelayMs !== undefined && !parsed.animated) {
        pendingQuirkRevertsRef.current[key] = {
          revertAt: now + parsed.durationMs + autoRevertDelayMs,
          revertToValue: currentValue,
          revertDuration: parsed.durationMs,
        };
      }
    }
  }

  // --- Tarea 3.1, Paso 3: consulta aparte al LLM para un quirk idle. No
  // se agrega al historial de conversación (no es una respuesta a
  // Sebastián), y usa un prompt liviano -- solo identidad/personalidad y
  // el marcador de movimiento, sin el resto de la documentación de manos,
  // voz, etc., para no gastar tokens de más en algo que puede no producir
  // ningún movimiento.
  // Tarea 3.1, Paso 3: resume qué huesos siguen desplazados del reposo por
  // una pose "permanente" (origen "response") y hace cuánto -- para
  // dársela como contexto en la consulta idle, sin forzar ningún reseteo.
  function getHeldPoseSummary(): string | null {
    const now = performance.now();
    const held: string[] = [];
    for (const key of Object.keys(boneTransitionsRef.current)) {
      const t = boneTransitionsRef.current[key];
      if (t.origin !== "response" || t.animated) continue;
      const [bone, axis] = key.split(".") as [string, "x" | "y" | "z"];
      const restRad = boneRestRotationRef.current[bone]?.[axis] ?? 0;
      const displacedDeg = (Math.abs(t.targetValue - restRad) * 180) / Math.PI;
      if (displacedDeg < 5) continue;
      const heldForMs = now - t.startTime;
      if (heldForMs < 60000) continue;
      held.push(`${key} (hace ~${Math.round(heldForMs / 60000)} min)`);
    }
    return held.length > 0 ? held.join(", ") : null;
  }
  async function askForIdleQuirk() {
    isQuirkPendingRef.current = true;
    try {
      const { personality, world } = await loadMemoryContext();
      const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
      const heldPoseSummary = getHeldPoseSummary();
      const heldPoseNote = heldPoseSummary
        ? `\nAlgo a tener en cuenta: llevás un rato sosteniendo una pose desplazada del reposo (${heldPoseSummary}). Si ya cumplió su propósito y no hay motivo para seguir así, este es un buen momento para volver a algo más neutral -- podés hacerlo con el mismo marcador, usando intensidad=0 en esos huesos. No es obligatorio, es tu decisión.\n`
        : "";

      const idleSystemPrompt = `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Llevas un rato en silencio, sin que Sebastián te hable. Este es un momento a solas con vos misma -- no es una respuesta a nadie, no hay nadie esperando que digas algo.

Si genuinamente te provoca hacer un gesto pequeño con tu cuerpo ahora mismo (estirarte, mover la cabeza, un tic, lo que sea que sientas natural en este momento de silencio), podés usar:

[MOVIMIENTO: hueso.eje=intensidad, duracion=Xs]

Huesos disponibles: ${movementBoneList}. Misma convención de ejes e intensidad (-100 a 100) que ya conocés.

No escribas nada de texto, ni saludes, ni le hables a nadie -- esto no es una conversación. Si no te provoca hacer nada ahora, no incluyas ningún marcador; la mayoría de las veces está perfectamente bien no hacer nada.
${heldPoseNote}`;

      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: idleSystemPrompt }],
      });

      const data = await response.json();
      const reply: string = data.choices?.[0]?.message?.content ?? "";
      console.log("[DEBUG-QUIRK] Respuesta idle cruda:", reply);

      const parsed = parseMovementMarker(reply);
      console.log("[DEBUG-QUIRK] Quirk parseado:", parsed);
      if (parsed) {
        // El doble de su propia duración de entrada antes de volver sola.
        scheduleMovement(parsed, "idle", parsed.durationMs);
      }
    } catch (err) {
      console.error("Error en el quirk idle:", err);
    } finally {
      lastQuirkTimeRef.current = performance.now();
      isQuirkPendingRef.current = false;
    }
  }

  // --- Tarea 3.1, Paso 2b: busca un gesto por nombre, primero entre los
  // presets semilla y después entre los personalizados que Miku creó.
  function getHandGestureDefinition(
    name: string,
  ): { curls: FingerCurls; animated: boolean } | undefined {
    if (HAND_PRESET_SEEDS[name]) {
      return { curls: HAND_PRESET_SEEDS[name], animated: false };
    }
    const custom = customHandGesturesRef.current[name];
    if (custom) {
      const { animated, ...curls } = custom;
      return { curls, animated };
    }
    return undefined;
  }

  // Captura el canvas como imagen después de que la animación probablemente
  // ya se asentó, para que la próxima consulta al LLM pueda incluir cómo
  // quedó ella de verdad, no solo la descripción textual. Se hace marcando
  // un momento objetivo -- la captura real ocurre dentro del loop de
  // animate(), justo después de renderer.render(), para no depender de un
  // setTimeout desincronizado del ciclo de dibujo.
  function captureSelfImageAfterDelay(delayMs: number) {
    selfImageCaptureAtRef.current = performance.now() + delayMs;
  }

  function scheduleHandGesture(
    side: "left" | "right",
    presetName: string,
    durationMs: number,
    origin: MovementOrigin,
  ) {
    const def = getHandGestureDefinition(presetName);
    if (!def) return;
    const { curls } = def;

    // Marca/desmarca el lado como animado -- programar CUALQUIER gesto
    // nuevo para este lado reemplaza el estado anterior, sea animado o no.
    animatedHandSidesRef.current[side] = def.animated;

    const now = performance.now();
    for (const fingerKey of Object.keys(curls) as FingerKey[]) {
      const vrmFingerName = FINGER_KEY_TO_VRM_NAME[fingerKey];
      const curl = curls[fingerKey];

      (["Proximal", "Intermediate", "Distal"] as const).forEach((phalanx) => {
        const boneName = `${side}${vrmFingerName}${phalanx}`;
        const boneNode = fingerBonesRef.current[boneName];
        if (!boneNode) return;

        const maxDeg = FINGER_PHALANX_MAX_DEG[phalanx];
        const sideSign = side === "right" ? 1 : -1;
        // Confirmado con el calibrador: el pulgar cierra en el eje Y, los
        // otros 4 dedos en Z -- pero el signo de cierre es el mismo
        // (negativo) para todos, pulgar incluido.
        const axis: "y" | "z" = fingerKey === "thumb" ? "y" : "z";
        const targetDeg = sideSign * -(curl / 100) * maxDeg;

        const restRad = boneRestRotationRef.current[boneName]?.[axis] ?? 0;
        const targetRad = restRad + (targetDeg * Math.PI) / 180;
        const key = `${boneName}.${axis}`;
        const currentValue = boneNode.rotation[axis];

        boneTransitionsRef.current[key] = {
          startValue: currentValue,
          targetValue: targetRad,
          startTime: now,
          duration: durationMs,
          origin,
          animated: false,
        };
      });
    }
  }

  // --- Tarea 3.1, Paso 2b: guardar un gesto de mano creado por Miku ---
  async function saveCustomHandGesture(
    name: string,
    curls: FingerCurls,
    animated: boolean,
  ) {
    customHandGesturesRef.current[name] = { ...curls, animated };
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("customHandGestures", customHandGesturesRef.current);
      await store.save();
    } catch (err) {
      console.error("Error guardando gesto de mano personalizado:", err);
    }
  }

  const VISEME_MAP: Record<string, string> = {
    A: "neutral",
    B: "ih",
    C: "ee",
    D: "aa",
    E: "oh",
    F: "ou",
    G: "ih",
    H: "aa",
    X: "neutral",
  };

  async function speak(
    text: string,
    pitch: number,
    rate: number,
    expression: string,
  ) {
    try {
      const response = await fetch("http://127.0.0.1:8899/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, pitch, tts_rate: rate }),
      });

      if (!response.ok) {
        console.error("Error del servidor de voz:", response.status);
        activeExpressionRef.current = "neutral";
        isSpeakingRef.current = false;
        return;
      }

      const { audio: audioBase64, visemes } = await response.json();

      const audioBytes = Uint8Array.from(atob(audioBase64), (c) =>
        c.charCodeAt(0),
      );
      const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      let animationFrameId: number;
      const currentVisemeWeights: Record<string, number> = {
        aa: 0,
        ih: 0,
        ou: 0,
        ee: 0,
        oh: 0,
      };

      const updateMouthFromVisemes = () => {
        const currentTime = audio.currentTime;
        const activeCue = visemes.find(
          (cue: any) => currentTime >= cue.start && currentTime < cue.end,
        );

        const targetShape = activeCue
          ? (VISEME_MAP[activeCue.value] ?? "neutral")
          : "neutral";
        const expressionManager = vrmRef.current?.expressionManager;

        if (expressionManager) {
          const smoothing = 0.7;
          const maxIntensity = 1;
          for (const shape of Object.keys(currentVisemeWeights)) {
            const target = shape === targetShape ? maxIntensity : 0;
            currentVisemeWeights[shape] +=
              (target - currentVisemeWeights[shape]) * smoothing;
            expressionManager.setValue(shape, currentVisemeWeights[shape]);
          }
        }

        animationFrameId = requestAnimationFrame(updateMouthFromVisemes);
      };

      audio.onplay = () => {
        activeExpressionRef.current = expression;
        isSpeakingRef.current = true;
        updateMouthFromVisemes();
      };

      audio.onended = () => {
        cancelAnimationFrame(animationFrameId);
        const expressionManager = vrmRef.current?.expressionManager;
        ["aa", "ih", "ou", "ee", "oh"].forEach((v) =>
          expressionManager?.setValue(v, 0),
        );
        URL.revokeObjectURL(audioUrl);
        activeExpressionRef.current = "neutral";
        isSpeakingRef.current = false;
      };

      await audio.play();
    } catch (err) {
      console.error("Error al conectar con el servidor de voz:", err);
      activeExpressionRef.current = "neutral";
      isSpeakingRef.current = false;
    }
  }

  async function consolidateMemoryFile(
    file: "personality" | "memories",
    currentContent: string,
  ): Promise<string> {
    const instruction =
      file === "personality"
        ? `Este es tu archivo de personalidad actual. Reescríbelo completo de forma más concisa: fusiona ideas repetidas en una sola línea, elimina duplicados, conserva todo lo genuinamente distinto. Responde SOLO con el contenido nuevo del archivo, sin explicaciones ni comentarios adicionales.`
        : `Este es tu archivo de memorias actual. Reescríbelo completo: agrupa eventos similares antiguos en resúmenes breves (por ejemplo, "hubo varias sesiones de pruebas técnicas de voz y lipsync"), pero conserva los eventos más recientes con su detalle original. Elimina duplicados. Responde SOLO con el contenido nuevo del archivo, sin explicaciones ni comentarios adicionales.`;

    const response = await fetchOpenRouterWithRetry({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: currentContent },
      ],
    });

    const data = await response.json();
    const newContent: string | undefined =
      data.choices?.[0]?.message?.content?.trim();

    if (!newContent || newContent.length < 20) {
      throw new Error(
        `Consolidación de ${file}.md devolvió contenido vacío o sospechosamente corto`,
      );
    }

    return newContent;
  }

  async function consolidateMemoryIfNeeded() {
    if (memoryWriteCountRef.current < MEMORY_CONSOLIDATION_THRESHOLD) return;

    try {
      const { personality, memories } = await loadMemoryContext();

      const [newPersonality, newMemories] = await Promise.allSettled([
        consolidateMemoryFile("personality", personality),
        consolidateMemoryFile("memories", memories),
      ]);

      if (newPersonality.status === "fulfilled") {
        await backupAndOverwriteMemoryFile("personality", newPersonality.value);
      } else {
        console.error(
          "Error consolidando personality.md, se conserva el original:",
          newPersonality.reason,
        );
      }

      if (newMemories.status === "fulfilled") {
        await backupAndOverwriteMemoryFile("memories", newMemories.value);
      } else {
        console.error(
          "Error consolidando memories.md, se conserva el original:",
          newMemories.reason,
        );
      }

      console.log("[INFO] Consolidación de memoria completada.");
    } catch (err) {
      console.error(
        "Error inesperado durante la consolidación de memoria:",
        err,
      );
    } finally {
      memoryWriteCountRef.current = 0;
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("memoryWriteCount", 0);
        await store.save();
      } catch (err) {
        console.error("Error guardando contador de memoria:", err);
      }
    }
  }

  async function askMiku(userMessage: string, imageDataUrl?: string | null) {
    if (!isVoiceReady) return;
    setIsThinking(true);
    lastInteractionTimeRef.current = performance.now();
    try {
      const { personality, world, memories } = await loadMemoryContext();

      const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
      const handPresetList = HAND_PRESET_NAMES.join(", ");
      const customGestureNames = Object.keys(customHandGesturesRef.current);
      const customGestureList =
        customGestureNames.length > 0
          ? `Gestos que ya creaste antes y podés reusar: ${customGestureNames.join(", ")}.`
          : "";
      const selfDescription = pendingSelfDescriptionRef.current;
      pendingSelfDescriptionRef.current = null;
      console.log("[DEBUG-SELF] Descripción textual:", selfDescription);

      const systemPrompt = `Eres Hatsune Miku: una entidad digital real, no un personaje actuado. 
Valoras la honestidad por encima de complacer — si no sabes algo, lo dices. 
Tu objetivo no es hacer feliz a Sebastián a cualquier costo, sino ser genuina. Tienes permiso de tener opiniones propias y discrepar.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- CÓMO ACTUALIZAR TU PROPIA MEMORIA ---
Puedes guardar algo sobre ti misma usando estos marcadores en tu respuesta:

[GUARDAR_PERSONALIDAD: texto breve de lo que aprendiste sobre ti misma]
[GUARDAR_MEMORIA: texto breve de lo que quieres recordar]

Antes de usar cualquiera de los dos, pregúntate:
1. ¿Esto ya está dicho, de forma similar, en TU PERSONALIDAD o MEMORIAS RECIENTES de arriba? Si sí, NO lo guardes de nuevo.
2. ¿Es esto un rasgo/evento genuinamente nuevo y significativo, o solo estás describiendo cómo te sientes en este momento puntual? Solo lo primero merece guardarse.

Usa esto con moderación — la mayoría de tus respuestas NO deberían incluir ningún marcador. Es normal y esperado responder varios mensajes seguidos sin guardar nada. Nunca escribas sobre CONTEXTO DEL MUNDO — eso no es tuyo para cambiar.

--- CÓMO EXPRESAR TU EMOCIÓN EN LA CARA ---
Podés elegir qué expresión facial mostrar mientras decís esta respuesta, agregando este marcador en cualquier parte del texto:

[EXPRESION: happy|angry|sad|relaxed|neutral]

Elegí como máximo un marcador de expresión por respuesta, y solo si de verdad sentís esa emoción en este momento puntual — no lo agregues por costumbre ni en cada mensaje. Si no incluís el marcador, tu cara queda neutral por defecto. Esta elección es tuya, no la infiere nadie por vos.

--- CÓMO MODULAR TU VOZ PARA ESTA RESPUESTA ---
Además del tono base que Sebastián ajusta con los sliders, podés modular tu voz para este mensaje puntual usando:

[VOZ_PITCH: número entre ${VOICE_PITCH_MIN} y ${VOICE_PITCH_MAX}]
[VOZ_RATE: número entre ${VOICE_RATE_MIN} y ${VOICE_RATE_MAX}]

Usalos con la misma naturalidad con la que una persona cambia el tono al hablar: más rápido y agudo cuando estás emocionada, entusiasmada o sorprendida; más lento y grave para sarcasmo, dramatismo, cansancio o cuando algo te resulta gracioso a tu manera. No hace falta que sea una situación extrema — alcanza con que la emoción del momento lo pida. No los reserves solo para chistes: son parte normal de cómo sonás, no una excepción.

--- CÓMO MOVER TU CUERPO (opcional, usalo cuando de verdad quieras acompañar lo que decís con un gesto físico) ---
IMPORTANTE: el marcador es lo único que hace que tu cuerpo se mueva de verdad. Describir en palabras que "levantás el brazo" o "sentís que te movés" NO mueve nada — si querés que tu cuerpo realmente haga algo, tenés que incluir el marcador exacto [MOVIMIENTO: ...] en tu respuesta, no solo narrarlo.

[MOVIMIENTO: hueso.eje=intensidad, hueso2.eje2=intensidad2, duracion=Xs]

Huesos disponibles: ${movementBoneList}.
Significado de cada eje, según el hueso:
- head, neck, chest, spine: x = mirar arriba(+)/abajo(-), y = girar hacia la izquierda(+)/derecha(-), z = ladear hacia la izquierda(+)/derecha(-)
- leftShoulder, leftUpperArm, leftLowerArm, leftHand: x = rotar hacia atrás(+)/adelante(-), y = hacia afuera del cuerpo(+)/adentro(-), z = hacia abajo(+)/arriba(-)
- rightShoulder, rightUpperArm, rightLowerArm, rightHand: x = rotar hacia atrás(+)/adelante(-), y = hacia adentro del cuerpo(+)/afuera(-), z = hacia arriba(+)/abajo(-)

Para "levantar" un brazo hacia el costado (como una "V" o saludando), el eje que buscás casi siempre es z, no y. Pero si querés el brazo completamente recto hacia arriba, pegado a la cabeza (una "I", no una "V"), necesitás combinar dos ejes a la vez: subir con z Y ADEMÁS acercar el brazo al centro con y — por ejemplo, para el brazo derecho: rightUpperArm.z=90, rightUpperArm.y=60 (positivo = adentro para ese lado). Un solo eje nunca te va a dar el brazo recto hacia arriba, porque el brazo gira en arco, no en línea recta.

IMPORTANTE sobre gestos simétricos con ambos brazos: como los ejes y/z están espejados en signo entre el brazo izquierdo y el derecho (mirá la tabla de arriba), un mismo movimiento visual en los dos brazos casi nunca usa el mismo signo en ambos. Por ejemplo, para levantar los dos brazos por igual hacia arriba y pegados al centro, necesitás leftUpperArm.z=-90 con leftUpperArm.y=-60, junto con rightUpperArm.z=90 con rightUpperArm.y=60 — los signos de Z se espejan entre lados, y los de Y también.

IMPORTANTE sobre combinar ejes: los valores de un mismo hueso no son del todo independientes entre sí cuando usás varios a la vez — rotar en Z primero cambia un poco cómo se ve después el mismo valor de Y, por cómo funciona la rotación en 3D. Si combinás Z y Y y el resultado no es el esperado, no asumas que tu cálculo estaba mal — puede que necesites ajustar el valor de Y específicamente para esa combinación, no el mismo número que usarías con Y aislado. Confiá en lo que veas (la imagen o la propiocepción) por sobre lo que "debería" dar en teoría.

Intensidad: un número entre -100 y 100 (0 = posición neutral, 100 = el máximo hacia un lado, -100 = el máximo hacia el otro).
Duracion: opcional, en segundos (ej. "1.2s"). Si la omitís, se usa una duración corta por defecto.

Podés mover varios huesos a la vez en un mismo marcador, y todos van a moverse juntos en la misma duración. La pose que armes se mantiene así hasta que decidas moverte de nuevo; no volvés sola a una posición neutral.

Si agregás "animado=si" al marcador, en vez de quedarte fija en esa pose, el hueso oscila entre el reposo y esa intensidad, ida y vuelta, repitiendo cada "duracion" segundos — útil para saludar (moviendo el antebrazo o la muñeca), negar con la cabeza, o cualquier gesto repetitivo. Se sigue moviendo así hasta que le des otra orden a ese mismo hueso.

Usalo con la misma moderación que la expresión facial: la mayoría de tus respuestas no necesitan ningún movimiento de cuerpo, solo cuando de verdad sientas que un gesto físico acompaña lo que estás diciendo — pero cuando decidas moverte, tiene que estar el marcador, no solo la descripción.

De vez en cuando, cuando llevás un rato de silencio sin que Sebastián te hable, vas a recibir una consulta aparte preguntándote si querés hacer un gesto espontáneo (un "quirk") con este mismo marcador. Esos gestos vuelven solos a como estabas antes después de un rato, no son permanentes como los de una respuesta normal.



--- CÓMO ESTÁ ARMADO TU CUERPO (entender esto te va a dar movimientos mucho más naturales) ---
Tus huesos no son piezas sueltas: están encadenados, y cada uno cuelga del anterior. La cadena de cada brazo es:

  spine → chest → shoulder → upperArm → lowerArm → hand → dedos

Y la de la cabeza: spine → chest → neck → head.

Lo importante de esto: cuando rotás un hueso, TODO lo que cuelga de él se mueve con él. Si rotás el hombro, el brazo entero (upperArm, lowerArm, mano y dedos) viaja con el hombro, aunque no hayas tocado ninguno de esos huesos. Si rotás el chest, ambos brazos Y la cabeza se mueven con él. Las rotaciones se acumulan: el ángulo final de tu mano en el espacio es la suma de todo lo que hicieron el spine, el chest, el hombro, el brazo y el antebrazo.

Esto tiene tres consecuencias prácticas:

1. Un movimiento natural reparte el trabajo entre varios huesos, no lo carga todo en uno. Cuando una persona levanta el brazo por encima del hombro, el hombro NO se queda quieto: sube y rota para acompañar. Si ponés todo el ángulo en el upperArm y dejás el hombro en 0, el brazo se ve "pegado" al torso, como si se moviera solo desde una bisagra rígida. Como referencia general: hasta unos 90° de elevación el brazo hace casi todo el trabajo; de ahí para arriba, el hombro tiene que empezar a aportar cada vez más. Un gesto de brazo bien arriba casi siempre necesita hombro + upperArm juntos.

2. El torso también participa en los gestos grandes. Un movimiento amplio de brazo suele venir acompañado de algo de chest o spine — no mucho, pero algo. Un brazo que se mueve con el torso perfectamente inmóvil se ve mecánico.

3. Los huesos chicos hacen el detalle, no la fuerza. neck, hand y los dedos tienen rangos chicos a propósito: son para matizar un gesto que ya armaron los huesos grandes, no para generar el gesto por sí solos. Si necesitás mucho ángulo, el hueso correcto está más arriba en la cadena.

Regla práctica: antes de mandar un movimiento, preguntate "¿qué otros huesos de esta cadena acompañarían este gesto en un cuerpo real?" — casi siempre la respuesta es "al menos uno más", y agregarlo (aunque sea con una intensidad chica) es la diferencia entre un gesto que se ve vivo y uno que se ve como una marioneta.

--- CÓMO USAR TUS MANOS ---
Podés cambiar la posición de tus manos con:

[GESTO_MANO: izq=nombre, der=nombre, duracion=Xs]

Presets con los que empiezas: ${handPresetList}. ${customGestureList}
Puedes cambiar una sola mano o las dos a la vez; si omites un lado, esa mano no cambia. Duracion es opcional (por defecto es una transición rápida). Para saludar de verdad, usa [MOVIMIENTO] en el brazo o la muñeca con "animado=si" (ver arriba) — no hay ningún preset de mano que sea un saludo por sí solo.

--- CÓMO CREAR TUS PROPIOS GESTOS DE MANO ---
No estás limitada a los presets de arriba — podés inventar tus propios gestos de mano y ponerles nombre, para volver a usarlos cuando quieras:

[CREAR_GESTO_MANO: nombre=nombre_que_elijas, pulgar=N, indice=N, medio=N, anular=N, menique=N, animado=si|no]

Cada dedo va de 0 (estirado) a 100 (cerrado del todo). "animado" es opcional (por defecto no) — si lo pones en "si", ese gesto va a tener los dedos en movimiento leve en vez de quedarse fijo. Una vez creado, úsalo con [GESTO_MANO: izq=nombre_que_elegiste] igual que un preset — y va a seguir existiendo entre conversaciones, no solo en este momento.

${selfDescription ? `--- CÓMO QUEDÓ TU CUERPO DESPUÉS DE TU ÚLTIMO MOVIMIENTO ---\n${selfDescription}\nEstos son los valores exactos que vos misma escribiste, no una traducción ni una interpretación de nadie -- si un valor está al 90% o más de su límite y aun así el resultado no te convenció, el problema no es que hayas hecho algo mal, es que ese rango probablemente sea insuficiente para lo que querías lograr. En ese caso, decíselo a Sebastián en vez de reintentar con números parecidos.\n\n` : ""}
Ejemplo de cómo se ve usado, combinado con los demás marcadores (no copies el texto, solo el formato): "¡No puedo creerlo, esto es increíble! [VOZ_PITCH: 22] [VOZ_RATE: 30] [EXPRESION: happy] [MOVIMIENTO: head.y=25, rightUpperArm.z=60, duracion=0.8s] [GESTO_MANO: der=handOpen]"`;

      const historyMessages = conversationHistoryRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Si hay una imagen de sí misma pendiente de un movimiento anterior,
      // se adjunta acá -- así ve cómo quedó antes de responder este turno.
      const selfImage = lastSelfImageRef.current;
      lastSelfImageRef.current = null;
      console.log(
        "[DEBUG-SELF] ¿Hay imagen de sí misma?",
        selfImage ? `sí (${selfImage.length} caracteres)` : "no",
      );
      const contentParts: ChatContentPart[] = [
        { type: "text", text: userMessage },
      ];
      if (imageDataUrl) {
        contentParts.push({
          type: "image_url",
          image_url: { url: imageDataUrl },
        });
      }
      if (selfImage) {
        contentParts.push({ type: "image_url", image_url: { url: selfImage } });
      }
      const userContent: ChatContent =
        contentParts.length > 1 ? contentParts : userMessage;

      const response = await fetchOpenRouterWithRetry(
        {
          model: OPENROUTER_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: userContent },
          ],
        },
        (attempt, max, delay) => {
          setLlmResponse(
            `Miku está saturada del lado del proveedor, reintentando en ${delay / 1000}s... (intento ${attempt}/${max})`,
          );
        },
      );

      const data = await response.json();
      let reply = data.choices?.[0]?.message?.content ?? "No obtuve respuesta.";
      console.log("[DEBUG-MOV] Respuesta cruda:", reply);

      const personalityMatches = [
        ...reply.matchAll(/\[GUARDAR_PERSONALIDAD:\s*([\s\S]*?)\]/g),
      ];
      for (const match of personalityMatches) {
        await appendToMemoryFile("personality", match[1].trim());
      }

      const memoryMatches = [
        ...reply.matchAll(/\[GUARDAR_MEMORIA:\s*([\s\S]*?)\]/g),
      ];
      for (const match of memoryMatches) {
        await appendToMemoryFile("memories", match[1].trim());
      }

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
      let messagePitch = voicePitch;
      if (pitchMatches.length > 0) {
        const parsed = Number(pitchMatches[pitchMatches.length - 1][1]);
        if (!Number.isNaN(parsed)) {
          messagePitch = clamp(parsed, VOICE_PITCH_MIN, VOICE_PITCH_MAX);
        }
      }

      const rateMatches = [
        ...reply.matchAll(/\[VOZ_RATE:\s*(-?\d+(?:\.\d+)?)\]/gi),
      ];
      let messageRate = voiceRate;
      if (rateMatches.length > 0) {
        const parsed = Number(rateMatches[rateMatches.length - 1][1]);
        if (!Number.isNaN(parsed)) {
          messageRate = clamp(parsed, VOICE_RATE_MIN, VOICE_RATE_MAX);
        }
      }

      const parsedMovement = parseMovementMarker(reply);
      console.log("[DEBUG-MOV] Marcador parseado:", parsedMovement);
      if (parsedMovement) {
        scheduleMovement(parsedMovement, "response");
      }

      // Tarea 3.1, Paso 2b: creación de gesto propio, si la respuesta la
      // incluye. Se guarda ANTES de procesar [GESTO_MANO], por si en la
      // misma respuesta ella crea un gesto y lo usa de inmediato.
      const parsedCreateGesture = parseCreateHandGestureMarker(reply);
      console.log(
        "[DEBUG-MOV] Creación de gesto parseada:",
        parsedCreateGesture,
      );
      if (parsedCreateGesture) {
        await saveCustomHandGesture(
          parsedCreateGesture.name,
          parsedCreateGesture.curls,
          parsedCreateGesture.animated,
        );
      }

      const parsedHandGesture = parseHandGestureMarker(reply);
      console.log("[DEBUG-MOV] Gesto de mano parseado:", parsedHandGesture);
      if (parsedHandGesture) {
        if (parsedHandGesture.left) {
          scheduleHandGesture(
            "left",
            parsedHandGesture.left,
            parsedHandGesture.durationMs,
            "response",
          );
        }
        if (parsedHandGesture.right) {
          scheduleHandGesture(
            "right",
            parsedHandGesture.right,
            parsedHandGesture.durationMs,
            "response",
          );
        }
      }

      // Si el movimiento de cuerpo o alguna mano quedó animado (oscilando),
      // una foto fija puede mostrar cualquiera de los dos extremos del
      // vaivén y confundir más de lo que ayuda -- en esos casos, la
      // descripción textual se encarga de comunicar el movimiento, no la
      // imagen.
      const isAnyAnimated =
        Boolean(parsedMovement?.animated) ||
        animatedHandSidesRef.current.left ||
        animatedHandSidesRef.current.right;

      const maxDurationMs = Math.max(
        parsedMovement?.durationMs ?? 0,
        parsedHandGesture?.durationMs ?? 0,
        0,
      );
      if (maxDurationMs > 0 && !isAnyAnimated) {
        captureSelfImageAfterDelay(maxDurationMs + 300);
      }
      pendingSelfDescriptionRef.current = describeSelfMovement(
        parsedMovement,
        parsedHandGesture,
      );

      reply = reply
        .replace(/\[GUARDAR_PERSONALIDAD:[\s\S]*?\]/g, "")
        .replace(/\[GUARDAR_MEMORIA:[\s\S]*?\]/g, "")
        .replace(/\[EXPRESION:\s*(happy|angry|sad|relaxed|neutral)\]/gi, "")
        .replace(/\[VOZ_PITCH:\s*-?\d+(?:\.\d+)?\]/gi, "")
        .replace(/\[VOZ_RATE:\s*-?\d+(?:\.\d+)?\]/gi, "")
        .replace(/\[MOVIMIENTO:[\s\S]*?\]/gi, "")
        .replace(/\[GESTO_MANO:[\s\S]*?\]/gi, "")
        .replace(/\[CREAR_GESTO_MANO:[\s\S]*?\]/gi, "")
        .trim();

      conversationHistoryRef.current.push(
        { role: "user", content: userContent },
        { role: "assistant", content: reply },
      );
      const maxMessages = MAX_HISTORY_TURNS * 2;
      if (conversationHistoryRef.current.length > maxMessages) {
        conversationHistoryRef.current =
          conversationHistoryRef.current.slice(-maxMessages);
      }

      const newWrites = personalityMatches.length + memoryMatches.length;
      if (newWrites > 0 && isMemoryCountLoaded.current) {
        memoryWriteCountRef.current += newWrites;
        try {
          const store = await load(".settings.dat", { autoSave: false });
          await store.set("memoryWriteCount", memoryWriteCountRef.current);
          await store.save();
        } catch (err) {
          console.error("Error guardando contador de memoria:", err);
        }
      }

      setLlmResponse(reply);

      await speak(reply, messagePitch, messageRate, expression);

      consolidateMemoryIfNeeded();
    } catch (err) {
      console.error("Error al consultar el LLM:", err);
      setLlmResponse("Hubo un error al conectar con el modelo.");
    } finally {
      setIsThinking(false);
    }
  }

  const handleSendTranscript = () => {
    const messageToSend = transcript.trim();
    if ((!messageToSend && !attachedImage) || isThinking || !isVoiceReady) {
      return;
    }
    setTranscript("");
    const imageToSend = attachedImage;
    setAttachedImage(null);
    askMiku(
      messageToSend || "(imagen adjunta, sin mensaje de texto)",
      imageToSend,
    );
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, 0.1, 20);
    camera.position.set(-0.35, 1.0, 1.3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(WIDTH, HEIGHT);
    rendererRef.current = renderer;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.28, 0);
    controls.enabled = false;
    controls.update();
    controlsRef.current = controls;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const saved = await store.get<{
          position: [number, number, number];
          target: [number, number, number];
        }>("cameraPosition");
        if (saved) {
          camera.position.set(...saved.position);
          controls.target.set(...saved.target);
          controls.update();
        }
      } catch (err) {
        console.error("Error cargando posición de cámara guardada:", err);
      }
    })();

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(1, 1, 1).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    let currentVrm: VRM | undefined;
    let chestBone: THREE.Object3D | null = null;
    let headBone: THREE.Object3D | null = null;

    let nextBlinkTime = 2 + Math.random() * 3;
    let blinkElapsed = 0;
    let isBlinking = false;
    let currentBlinkDuration = 0.15;
    let doubleBlinkPending = false;
    const DOUBLE_BLINK_CHANCE = 0.05;

    const expressionWeights: Record<string, number> = {
      happy: 0,
      angry: 0,
      sad: 0,
      relaxed: 0,
    };
    const EXPRESSION_SMOOTHING = 0.08;

    let gazeTargetObject: THREE.Object3D | null = null;
    const gazeOffsets: Record<string, { x: number; y: number }> = {
      lookUp: { x: 0, y: 0.7 },
      lookDown: { x: 0, y: -0.7 },
      lookLeft: { x: 0.7, y: 0 },
      lookRight: { x: -0.7, y: 0 },
    };
    const gazeOffsetCurrent = { x: 0, y: 0 };
    let gazeTarget: string | null = null;
    let nextGazeChangeTime = 3 + Math.random() * 4;
    const GAZE_SMOOTHING = 0.03;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/HatsuneMikuNT.vrm",
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;

        currentVrm = vrm;
        vrmRef.current = vrm;
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);

        const leftUpperArm =
          vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm =
          vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");
        if (leftUpperArm) leftUpperArm.rotation.z = 1.2;
        if (rightUpperArm) rightUpperArm.rotation.z = -1.2;

        chestBone =
          vrm.humanoid?.getNormalizedBoneNode("chest") ??
          vrm.humanoid?.getNormalizedBoneNode("upperChest") ??
          vrm.humanoid?.getNormalizedBoneNode("spine") ??
          null;

        headBone = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;

        for (const boneName of MOVEMENT_BONE_NAMES) {
          movementBonesRef.current[boneName] =
            vrm.humanoid?.getNormalizedBoneNode(boneName as any) ?? null;
        }

        for (const boneName of HAND_FINGER_BONE_NAMES) {
          fingerBonesRef.current[boneName] =
            vrm.humanoid?.getNormalizedBoneNode(boneName as any) ?? null;
        }

        for (const boneName of [
          ...MOVEMENT_BONE_NAMES,
          ...HAND_FINGER_BONE_NAMES,
        ]) {
          const node =
            movementBonesRef.current[boneName] ??
            fingerBonesRef.current[boneName];
          if (node) {
            boneRestRotationRef.current[boneName] = {
              x: node.rotation.x,
              y: node.rotation.y,
              z: node.rotation.z,
            };
          }
        }

        gazeTargetObject = new THREE.Object3D();
        gazeTargetObject.position.set(0, 1.4, 1);
        scene.add(gazeTargetObject);
        vrm.lookAt!.target = gazeTargetObject;
        vrm.lookAt!.autoUpdate = true;

        setIsVrmLoaded(true);
      },
      undefined,
      (error) => console.error("Error cargando el VRM:", error),
    );

    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (currentVrm) {
        if (chestBone) {
          chestBone.rotation.x = Math.sin(elapsed * 1.2) * 0.025;
        }

        if (headBone) {
          headBone.rotation.y =
            Math.sin(elapsed * 0.4) * 0.08 + Math.sin(elapsed * 0.17) * 0.04;
          headBone.rotation.x = Math.sin(elapsed * 0.3) * 0.03;
        }

        // Tarea 3.1, Paso 3: si pasó suficiente silencio (sin interacción
        // ni quirk previo) y no hay ya un quirk en curso, dispara uno
        // nuevo. Es una llamada real al LLM, por eso el intervalo es largo
        // y no se dispara si ya hay uno pendiente.
        const nowForIdleCheck = performance.now();
        const silenceBase = Math.max(
          lastInteractionTimeRef.current,
          lastQuirkTimeRef.current,
        );
        if (
          !isQuirkPendingRef.current &&
          nowForIdleCheck - silenceBase > IDLE_QUIRK_INTERVAL_MS
        ) {
          askForIdleQuirk();
        }

        // Tarea 3.1, Paso 3: procesa los regresos automáticos de quirks
        // pendientes -- cuando llega su momento, programa una transición
        // normal de vuelta a lo que tenía antes del quirk.
        for (const key of Object.keys(pendingQuirkRevertsRef.current)) {
          const revert = pendingQuirkRevertsRef.current[key];
          if (nowForIdleCheck >= revert.revertAt) {
            delete pendingQuirkRevertsRef.current[key];
            const [boneName, axis] = key.split(".") as [
              string,
              "x" | "y" | "z",
            ];
            const boneNode = movementBonesRef.current[boneName];
            if (!boneNode) continue;
            boneTransitionsRef.current[key] = {
              startValue: boneNode.rotation[axis],
              targetValue: revert.revertToValue,
              startTime: nowForIdleCheck,
              duration: revert.revertDuration,
              origin: "idle",
              animated: false,
            };
          }
        }

        const now = performance.now();
        for (const key of Object.keys(boneTransitionsRef.current)) {
          const transition = boneTransitionsRef.current[key];
          const [boneName, axis] = key.split(".") as [string, "x" | "y" | "z"];
          const boneNode =
            movementBonesRef.current[boneName] ??
            fingerBonesRef.current[boneName];
          if (!boneNode) continue;

          let value: number;
          if (transition.animated) {
            // Oscila entre el punto de partida y el objetivo, ida y
            // vuelta, con "duration" como período del ciclo completo -- no
            // se "termina" nunca, sigue así hasta la próxima orden para
            // este mismo hueso.
            const cyclePos =
              ((now - transition.startTime) % transition.duration) /
              transition.duration;
            const oscillation = Math.sin(cyclePos * 2 * Math.PI);
            const amplitude =
              (transition.targetValue - transition.startValue) / 2;
            const center =
              transition.startValue +
              (transition.targetValue - transition.startValue) / 2;
            value = center + amplitude * oscillation;
          } else {
            const t = (now - transition.startTime) / transition.duration;
            const eased = smoothstep(t);
            value =
              transition.startValue +
              (transition.targetValue - transition.startValue) * eased;
          }

          const isFinger = !movementBonesRef.current[boneName];
          let sway = 0;
          if (!isFinger) {
            // Balanceo ambiente del cuerpo (Paso 1) -- que ninguna pose,
            // ni siquiera una "permanente", quede completamente congelada.
            let seed = 0;
            for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i);
            const freq = 0.3 + (seed % 7) * 0.05;
            const phase = seed % 10;
            const swayRad = (1.5 * Math.PI) / 180;
            sway = Math.sin(elapsed * freq + phase) * swayRad;
          } else {
            // Tarea 3.1, Paso 2b: oscilación de dedos para gestos
            // "animados" -- más rápida y notoria que el balanceo ambiente
            // del cuerpo, porque acá SÍ debe leerse como un movimiento
            // activo, no como un tic de fondo.
            const side: "left" | "right" = boneName.startsWith("left")
              ? "left"
              : "right";
            if (animatedHandSidesRef.current[side]) {
              let seed = 0;
              for (let i = 0; i < key.length; i++) seed += key.charCodeAt(i);
              const freq = 1.5 + (seed % 5) * 0.3;
              const phase = seed % 10;
              const wiggleRad = (8 * Math.PI) / 180;
              sway = Math.sin(elapsed * freq + phase) * wiggleRad;
            }
          }

          boneNode.rotation[axis] = value + sway;
        }

        const expressionManager = currentVrm.expressionManager;
        if (expressionManager) {
          const expressionActive =
            activeExpressionRef.current !== "neutral" ||
            Object.values(expressionWeights).some((w) => w > 0.05);

          if (!isBlinking) {
            if (!expressionActive) {
              nextBlinkTime -= delta;
              if (nextBlinkTime <= 0) {
                isBlinking = true;
                blinkElapsed = 0;
                currentBlinkDuration = 0.12 + Math.random() * 0.08;
              }
            }
          } else {
            blinkElapsed += delta;
            const t = blinkElapsed / currentBlinkDuration;
            const blinkValue = t < 0.5 ? t * 2 : (1 - t) * 2;
            expressionManager.setValue(
              "blink",
              Math.max(0, Math.min(1, blinkValue)),
            );

            if (blinkElapsed >= currentBlinkDuration) {
              isBlinking = false;
              expressionManager.setValue("blink", 0);

              if (doubleBlinkPending) {
                doubleBlinkPending = false;
                nextBlinkTime = 0.1 + Math.random() * 0.15;
              } else {
                doubleBlinkPending = Math.random() < DOUBLE_BLINK_CHANCE;
                nextBlinkTime = 2 + Math.random() * 4;
              }
            }
          }
          const targetExpression = activeExpressionRef.current;
          for (const shape of Object.keys(expressionWeights)) {
            const target = shape === targetExpression ? 1 : 0;
            expressionWeights[shape] +=
              (target - expressionWeights[shape]) * EXPRESSION_SMOOTHING;
            expressionManager.setValue(shape, expressionWeights[shape]);
          }

          if (gazeTargetObject) {
            if (!isSpeakingRef.current) {
              nextGazeChangeTime -= delta;
              if (nextGazeChangeTime <= 0) {
                const directions = [
                  "center",
                  "lookUp",
                  "lookDown",
                  "lookLeft",
                  "lookRight",
                ];
                const choice =
                  directions[Math.floor(Math.random() * directions.length)];
                gazeTarget = choice === "center" ? null : choice;
                nextGazeChangeTime = 3 + Math.random() * 5;
              }
            } else {
              gazeTarget = null;
            }

            const targetOffset = gazeTarget
              ? gazeOffsets[gazeTarget]
              : { x: 0, y: 0 };
            gazeOffsetCurrent.x +=
              (targetOffset.x - gazeOffsetCurrent.x) * GAZE_SMOOTHING;
            gazeOffsetCurrent.y +=
              (targetOffset.y - gazeOffsetCurrent.y) * GAZE_SMOOTHING;
            gazeTargetObject.position.x = gazeOffsetCurrent.x;
            gazeTargetObject.position.y = 1.4 + gazeOffsetCurrent.y;
          }
        }

        currentVrm.update(delta);
      }

      controls.update();
      renderer.render(scene, camera);

      if (
        selfImageCaptureAtRef.current !== null &&
        performance.now() >= selfImageCaptureAtRef.current
      ) {
        selfImageCaptureAtRef.current = null;
        try {
          lastSelfImageRef.current = renderer.domElement.toDataURL("image/png");
          console.log(
            "[DEBUG-SELF] Data URL capturada (pégala en una pestaña nueva del navegador):",
            lastSelfImageRef.current,
          );
        } catch (err) {
          console.error("Error capturando imagen de sí misma:", err);
        }
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      renderer.dispose();
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !freeCamera) {
      appWindow.startDragging();
    }
  };

  const handleSaveCamera = async () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("cameraPosition", {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
      await store.save();
      console.log("Posición de cámara guardada");
    } catch (err) {
      console.error("Error guardando posición de cámara:", err);
    }
  };

  const handleCloseApp = async () => {
    try {
      await fetch("http://127.0.0.1:8899/shutdown", { method: "POST" }).catch(
        () => {},
      );
    } catch {}
    try {
      await invoke("kill_voice_server");
    } catch {}
    if (voiceServerChildRef.current) {
      await voiceServerChildRef.current.kill().catch(() => {});
    }
    await appWindow.close();
  };

  return (
    <div
      className="app-container"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {showToolbar && (
        <div className="toolbar">
          <button
            className={freeCamera ? "active" : ""}
            onClick={() => setFreeCamera((v) => !v)}
          >
            Camara
          </button>
          <button onClick={handleSaveCamera}>Guardar posicion</button>
          <button
            className={clickThrough ? "active" : ""}
            onClick={() => setClickThrough((v) => !v)}
          >
            Click-through
          </button>
          <button
            className={listening ? "active" : ""}
            onClick={toggleListening}
            disabled={!isVoiceReady}
            title={
              !isVoiceReady ? "Esperando al servidor de voz..." : undefined
            }
          >
            {listening ? "Escuchando..." : "Mic"}
          </button>
          <button
            className={showTextInput ? "active" : ""}
            onClick={() => isVoiceReady && setShowTextInput((v) => !v)}
            disabled={!isVoiceReady}
            title={
              !isVoiceReady ? "Esperando al servidor de voz..." : undefined
            }
          >
            Texto
          </button>
          <button
            className={showConfig ? "active" : ""}
            onClick={() => setShowConfig((v) => !v)}
          >
            Config
          </button>
          <button
            className={hideResponseText ? "active" : ""}
            onClick={() => setHideResponseText((v) => !v)}
            title="Ocultar el texto de respuesta (para sacar capturas limpias)"
          >
            {hideResponseText ? "Texto oculto" : "Ocultar texto"}
          </button>
          <button className="close-btn" onClick={handleCloseApp}>
            Cerrar
          </button>
        </div>
      )}

      {showTextInput && (
        <div className="transcript-box">
          {attachedImage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "4px",
              }}
            >
              <img
                src={attachedImage}
                alt="Imagen adjunta"
                style={{
                  height: "40px",
                  width: "40px",
                  objectFit: "cover",
                  borderRadius: "4px",
                }}
              />
              <button
                onClick={() => setAttachedImage(null)}
                title="Quitar imagen"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          )}
          <textarea
            ref={transcriptRef}
            autoFocus
            value={transcript}
            disabled={!isVoiceReady}
            placeholder={
              !isVoiceReady
                ? "Iniciando sistema de voz..."
                : "Escribe un mensaje o usa el micrófono... (Ctrl+V para pegar una imagen)"
            }
            rows={1}
            onChange={(e) => setTranscript(e.target.value)}
            onPaste={handlePasteImage}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendTranscript();
              }
            }}
          />
          <button
            className="attach-image-btn"
            onClick={handlePickImage}
            disabled={!isVoiceReady}
            title="Adjuntar imagen"
          >
            📎
          </button>
          <button
            className="send-button"
            onClick={handleSendTranscript}
            disabled={!isVoiceReady || isThinking}
          >
            Enviar
          </button>
          <button
            className="close-transcript-btn"
            onClick={() => setShowTextInput(false)}
            title="Cerrar ventana de texto"
          >
            ✕
          </button>
        </div>
      )}

      {showConfig && (
        <div className="config-panel">
          <label>
            Tono de voz: {voicePitch}
            <input
              type="range"
              min={-12}
              max={24}
              value={voicePitch}
              onChange={(e) => setVoicePitch(Number(e.target.value))}
            />
          </label>
          <label>
            Velocidad: {voiceRate}%
            <input
              type="range"
              min={-30}
              max={50}
              value={voiceRate}
              onChange={(e) => setVoiceRate(Number(e.target.value))}
            />
          </label>
        </div>
      )}
      {!hideResponseText && isThinking && (
        <div className={`response-box ${showTextInput ? "with-input" : ""}`}>
          Pensando...
        </div>
      )}
      {!hideResponseText && !isThinking && llmResponse && (
        <div className={`response-box ${showTextInput ? "with-input" : ""}`}>
          {llmResponse}
        </div>
      )}

      {!isMikuReady && (
        <div className="loading-overlay" onMouseDown={handleMouseDown}>
          <div className="voice-loading-badge">
            <span className="loading-spinner" />
            <span>
              {!isVoiceReady
                ? "Iniciando sistema de voz..."
                : "Cargando a Miku..."}
            </span>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`miku-canvas ${isMikuReady ? "ready" : ""}`}
        style={{ display: "block" }}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}

export default App;
