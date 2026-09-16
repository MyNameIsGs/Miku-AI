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
} from "./lib/memory";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useVoiceServer } from "./hooks/useVoiceServer";
import {
  MovementOrigin,
  BoneTransition,
  PendingQuirkRevert,
  ParsedMovement,
  FingerKey,
  FingerCurls,
  ChatContentPart,
  ChatContent,
  ChatMessage,
} from "./types";
import {
  WIDTH,
  HEIGHT,
  OPENROUTER_MODEL,
  MAX_HISTORY_TURNS,
  MEMORY_CONSOLIDATION_THRESHOLD,
  VOICE_PITCH_MIN,
  VOICE_PITCH_MAX,
  VOICE_RATE_MIN,
  VOICE_RATE_MAX,
  IDLE_QUIRK_INTERVAL_MS,
  EXPRESSION_SMOOTHING,
  GAZE_SMOOTHING,
  DOUBLE_BLINK_CHANCE,
} from "./config/constants";
import {
  BONE_RANGES_DEG,
  MOVEMENT_BONE_NAMES,
  FINGER_KEY_TO_VRM_NAME,
  FINGER_PHALANX_MAX_DEG,
  HAND_FINGER_BONE_NAMES,
} from "./config/boneRanges";
import { HAND_PRESET_SEEDS } from "./config/handPresets";
import { buildSystemPrompt } from "./prompts/systemPrompt";
import { buildIdlePrompt, getHeldPoseSummary } from "./prompts/idlePrompt";
import { fetchOpenRouterWithRetry } from "./lib/openrouter";
import {
  parseMovementMarker,
  parseHandGestureMarker,
  parseCreateHandGestureMarker,
  stripMarkers,
} from "./lib/markers";
import { describeSelfMovement, uint8ToBase64 } from "./lib/proprioception";


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
  const { isVoiceReady, handleCloseApp } = useVoiceServer();
  const [isVrmLoaded, setIsVrmLoaded] = useState(false);
  const isMikuReady = isVoiceReady && isVrmLoaded;

  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
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
  async function askForIdleQuirk() {
    isQuirkPendingRef.current = true;
    try {
      const { personality, world } = await loadMemoryContext();
      const heldPoseSummary = getHeldPoseSummary(
        boneTransitionsRef.current,
        boneRestRotationRef.current,
      );
      const idleSystemPrompt = buildIdlePrompt({
        world,
        personality,
        heldPoseSummary,
      });

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

      const customGestureNames = Object.keys(customHandGesturesRef.current);
      const selfDescription = pendingSelfDescriptionRef.current;
      pendingSelfDescriptionRef.current = null;
      console.log("[DEBUG-SELF] Descripción textual:", selfDescription);

      const systemPrompt = buildSystemPrompt({
        world,
        personality,
        memories,
        selfDescription,
        customGestureNames,
      });

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

      reply = stripMarkers(reply);

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

    const expressionWeights: Record<string, number> = {
      happy: 0,
      angry: 0,
      sad: 0,
      relaxed: 0,
    };

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
