import { RefObject, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { load } from "@tauri-apps/plugin-store";
import "./App.css";
import { loadMemoryContext } from "./lib/memory";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useVoiceServer } from "./hooks/useVoiceServer";
import { useVRMScene } from "./hooks/useVRMScene";
import { useMovement } from "./hooks/useMovement";
import { useFace } from "./hooks/useFace";
import { useCursorGaze } from "./hooks/useCursorGaze";
import { useSpeech } from "./hooks/useSpeech";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useWakeWord } from "./hooks/useWakeWord";
import { useMemoryFiles } from "./hooks/useMemoryFiles";
import { useIdleQuirks } from "./hooks/useIdleQuirks";
import { useVoiceActivityDetection } from "./hooks/useVoiceActivityDetection";
import { useBriefing } from "./hooks/useBriefing";
import { useDiary } from "./hooks/useDiary";
import { useReminders } from "./hooks/useReminders";
import { useGmailWatcher } from "./hooks/useGmailWatcher";
import { useCalendarWatcher } from "./hooks/useCalendarWatcher";
import { useTaskWatcher } from "./hooks/useTaskWatcher";
import { useNotificationDigest } from "./hooks/useNotificationDigest";
import { useLoadingPhrase } from "./hooks/useLoadingPhrase";
import { useAppLauncher } from "./hooks/useAppLauncher";
import { useStreamMode } from "./hooks/useStreamMode";
import { useGameMode } from "./hooks/useGameMode";
import { useGameBreaks } from "./hooks/useGameBreaks";
import { usePerfMonitor } from "./hooks/usePerfMonitor";
import { describeGameContext } from "./lib/gameSessions";
import { isStreamModeActive } from "./lib/streamMode";
import { retrieveKnowledge, takeKnowledgeEditFeedback } from "./lib/knowledge";
import { beginReply, endReply, noteInterruption, noteRevealProgress, takeTalkSignals } from "./lib/talkSignals";
import { loadRecentChatHistory, saveChatHistory } from "./lib/chatHistory";
import { useSleep } from "./hooks/useSleep";
import { useTouchReactions } from "./hooks/useTouchReactions";
import { consumeTouchSummary } from "./lib/touchLog";
import { captureSelfView } from "./lib/selfView";
import { registerReachResolver, registerSelfViewCapturer } from "./lib/selfViewStore";
import { parseReachMarker, solveReach } from "./lib/reach";
import { processRedesignMarkers } from "./lib/touchReactionsStore";
import { parseFaceMarker } from "./lib/faceParts";
import { describeBodyNow } from "./lib/bodySense";
import { BONE_RANGES_DEG } from "./config/boneRanges";
import { intensityToDegrees } from "./hooks/useMovement";
import { useAudioDevices } from "./hooks/useAudioDevices";
import { AppLauncherPanel } from "./components/AppLauncherPanel";
import { QuirksPanel } from "./components/QuirksPanel";
import { MemoryPanel } from "./components/MemoryPanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { useConnections } from "./hooks/useConnections";
import {
  loadQuirks,
  confirmQuirk,
  revertQuirkToEvaluando,
  deleteQuirk,
  QuirksStore,
} from "./lib/quirks";
import { ChatContentPart, ChatContent, ChatMessage, ParsedMovement } from "./types";
import {
  OPENROUTER_MODEL,
  MAX_HISTORY_TURNS,
  DEFAULT_MOVEMENT_DURATION_MS,
  VOICE_PITCH_MIN,
  VOICE_PITCH_MAX,
  VOICE_RATE_MIN,
  VOICE_RATE_MAX,
} from "./config/constants";
import { buildSystemPrompt } from "./prompts/systemPrompt";
import { runToolCallingCycle } from "./lib/openrouter";
import {
  parseMovementMarker,
  parseHandGestureMarker,
  parseCreateHandGestureMarker,
  parseMoodMarker,
  stripMarkers,
} from "./lib/markers";
import { getCurrentMood, setMood } from "./lib/mood";
import { describeSelfMovement, uint8ToBase64 } from "./lib/proprioception";
import { loadPendientes, getActivePendientes } from "./lib/pendientes";

// Franja de la barra, POR ENCIMA de Miku (la ventana es así de más alta
// que el canvas, ver tauri.conf.json y .miku-canvas en App.css): no le
// tapa la cabeza, y con Miku bloqueada sigue siendo usable (ver
// click_through.rs). También es de donde se arrastra la ventana.
const TOOLBAR_STRIP_HEIGHT = 40;

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const appWindow = getCurrentWindow();
  const vrmRef = useRef<VRM | null>(null);
  const chestBoneRef = useRef<THREE.Object3D | null>(null);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const gazeTargetObjectRef = useRef<THREE.Object3D | null>(null);
  const [voicePitch, setVoicePitch] = useState(10);
  const [voiceRate, setVoiceRate] = useState(15);
  // Tarea 6.7: el quirk idle necesita leer siempre el valor más reciente
  // de estos sliders al hablar un recordatorio, sin depender de si
  // onBeforeRender quedó con una closure vieja.
  const voicePitchRef = useRef(voicePitch);
  const voiceRateRef = useRef(voiceRate);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef = useRef(voiceMuted);
  const [lipsyncMode, setLipsyncMode] = useState<"texto" | "rhubarb">("texto");
  const lipsyncModeRef = useRef(lipsyncMode);
  const [showConfig, setShowConfig] = useState(false);
  const [showAppLauncher, setShowAppLauncher] = useState(false);
  const [showQuirksPanel, setShowQuirksPanel] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [quirksState, setQuirksState] = useState<QuirksStore>({});
  const [hideResponseText, setHideResponseText] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const { isVoiceReady, downloadProgress, handleCloseApp, registerBeforeSync } = useVoiceServer();
  const { phrase: loadingPhrase, visible: loadingPhraseVisible } = useLoadingPhrase(
    !isVoiceReady,
    3000,
    1400,
  );

  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const isVoiceSettingsLoaded = useRef(false);

  const transcriptRef = useRef<HTMLTextAreaElement>(null);

  // Tarea 6.1: cada elemento es un TURNO completo, no un mensaje suelto --
  // un turno simple es [user, assistant], pero uno con tool calling es
  // [user, assistant(tool_calls), tool, tool, ..., assistant(final)]. Se
  // recorta por turno completo, nunca por mensaje individual, para no
  // partir un grupo assistant+tool a la mitad (ver gotcha en
  // lib/openrouter.ts).
  const conversationHistoryRef = useRef<ChatMessage[][]>([]);
  // Punto 2: si al abrir se retomó una charla reciente, se le avisa en el
  // primer mensaje (ver lib/chatHistory.ts).
  const resumedNoteRef = useRef<string | null>(null);
  useEffect(() => {
    loadRecentChatHistory().then((recent) => {
      if (!recent || conversationHistoryRef.current.length > 0) return;
      conversationHistoryRef.current = recent.turns;
      resumedNoteRef.current = `La app se cerró y se volvió a abrir. La charla que ves arriba es de antes de eso (lo último, hace ${recent.minutesAgo} min).`;
      console.log(`[Charla] Se retomó la charla anterior (${recent.turns.length} turnos, hace ${recent.minutesAgo} min).`);
    });
  }, []);

  const movementBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const fingerBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const selfImageCaptureAtRef = useRef<number | null>(null);
  const lastSelfImageRef = useRef<string | null>(null);
  const pendingSelfDescriptionRef = useRef<string | null>(null);
  // Fase 7: mismo patrón que los tres refs de arriba, pero separado para
  // la foto/descripción de un quirk en evaluación -- así no se pisa con la
  // captura de una conversación real si coinciden en el tiempo, y viaja a
  // la PRÓXIMA consulta idle (ver useIdleQuirks.ts), no a la conversación.
  //
  // Bug real encontrado por Sebastián: una sola foto no alcanza para un
  // quirk ANIMADO -- cae en un punto arbitrario del ciclo de oscilación
  // (no necesariamente el pico ni el centro), así que ni siquiera muestra
  // la pose más representativa, mucho menos el vaivén. DeepSeek no acepta
  // video como input (verificado contra la documentación real de
  // OpenRouter/DeepSeek, no asumido) -- la alternativa real es varias
  // fotos en distintos puntos del mismo ciclo, mandadas juntas como
  // imágenes separadas en el mismo mensaje. Por eso estos dos ahora son
  // listas, no un solo timestamp/imagen.
  const quirkImageCaptureAtRef = useRef<number[]>([]);
  const quirkSelfImagesRef = useRef<string[]>([]);
  const pendingQuirkDescriptionRef = useRef<string | null>(null);
  const boneRestRotationRef = useRef<
    Record<string, { x: number; y: number; z: number }>
  >({});


  useEffect(() => {
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const savedPitch = await store.get<number>("voicePitch");
        const savedRate = await store.get<number>("voiceRate");
        const savedMuted = await store.get<boolean>("voiceMuted");
        const savedLipsync = await store.get<"texto" | "rhubarb">("lipsyncMode");
        if (savedPitch !== null && savedPitch !== undefined)
          setVoicePitch(savedPitch);
        if (savedRate !== null && savedRate !== undefined)
          setVoiceRate(savedRate);
        if (savedMuted !== null && savedMuted !== undefined)
          setVoiceMuted(savedMuted);
        if (savedLipsync === "texto" || savedLipsync === "rhubarb")
          setLipsyncMode(savedLipsync);
        isVoiceSettingsLoaded.current = true;
      } catch (err) {
        console.error("Error cargando configuración de voz guardada:", err);
      }
    })();
  }, []);

  useEffect(() => {
    voicePitchRef.current = voicePitch;
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
    voiceRateRef.current = voiceRate;
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
    lipsyncModeRef.current = lipsyncMode;
    if (!isVoiceSettingsLoaded.current) return;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("lipsyncMode", lipsyncMode);
        await store.save();
      } catch (err) {
        console.error("Error guardando el modo de la boca:", err);
      }
    })();
  }, [lipsyncMode]);

  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
    if (!isVoiceSettingsLoaded.current) return;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        await store.set("voiceMuted", voiceMuted);
        await store.save();
      } catch (err) {
        console.error("Error guardando el silencio de voz:", err);
      }
    })();
  }, [voiceMuted]);

  // Spotify, Gmail, Calendar y MCP (ver hooks/useConnections.ts).
  const connections = useConnections();

  // Panel de quirks (idea nueva): recién carga cuando se abre, no hace
  // falta tenerlo cargado todo el tiempo -- el loop idle sigue siendo el
  // único que los crea/confirma normalmente vía marcadores.
  useEffect(() => {
    if (!showQuirksPanel) return;
    loadQuirks()
      .then(setQuirksState)
      .catch((err) => console.error("Error cargando quirks:", err));
  }, [showQuirksPanel]);

  const handleConfirmQuirk = async (name: string) => {
    setQuirksState(await confirmQuirk(quirksState, name));
  };

  const handleRevertQuirkToEvaluando = async (name: string) => {
    setQuirksState(await revertQuirkToEvaluando(quirksState, name));
  };

  const handleDeleteQuirk = async (name: string) => {
    setQuirksState(await deleteQuirk(quirksState, name));
  };

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

  // Click-through por zonas (ver click_through.rs): con Miku bloqueada,
  // la ventana deja pasar los clics salvo sobre la franja de la barra (por
  // encima de Miku) y los paneles abiertos, que siguen usables. Las zonas
  // se recalculan cada medio segundo por si un panel cambia de tamaño, y
  // solo se mandan si cambiaron.
  const clickThroughRef = useRef(clickThrough);
  useEffect(() => {
    clickThroughRef.current = clickThrough;
    if (!clickThrough) {
      invoke("set_click_through", { enabled: false, regions: [] }).catch(console.error);
      return;
    }
    let lastSent = "";
    const sendRegions = () => {
      const regions = [{ x: 0, y: 0, width: window.innerWidth, height: TOOLBAR_STRIP_HEIGHT }];
      document
        .querySelectorAll(".config-panel, .app-launcher-panel, .transcript-box")
        .forEach((el) => {
          const r = el.getBoundingClientRect();
          regions.push({ x: r.left, y: r.top, width: r.width, height: r.height });
        });
      const serialized = JSON.stringify(regions);
      if (serialized === lastSent) return;
      lastSent = serialized;
      invoke("set_click_through", { enabled: true, regions }).catch(console.error);
    };
    sendRegions();
    const id = setInterval(sendRegions, 500);
    return () => clearInterval(id);
  }, [clickThrough]);

  // Con la ventana ignorando el mouse no llegan eventos de hover: Rust
  // avisa cuándo el cursor entra o sale de una zona interactiva.
  useEffect(() => {
    const unlistenPromise = listen<boolean>("click-through-hover", (event) => {
      if (clickThroughRef.current) setShowToolbar(event.payload);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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

  const speechRecognition = useSpeechRecognition({
    isVoiceReady,
    setTranscript,
    setShowTextInput,
  });

  const [llmResponse, setLlmResponse] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  // Idea #18: indicador visual de "escuchando/pensando/hablando" en el
  // avatar de desktop -- equivalente al ícono pulsante de la pantalla
  // flotante de Android. Derivado de estados que ya existen, no hace falta
  // uno nuevo: listening/transcribing (mic capturando o transcribiendo),
  // isThinking (LLM + síntesis de voz, ver el fix de "Pensando..." de
  // arriba), speech.isSpeaking (audio sonando). El orden de prioridad
  // importa -- si está escuchando, eso manda aunque isThinking quedara
  // colgado de un turno anterior.

  useWakeWord({
    isVoiceReady,
    listening: speechRecognition.listening,
    transcribing: speechRecognition.transcribing,
    isThinking,
    toggleListening: speechRecognition.toggleListening,
  });

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

  // Cadera y piernas para el cambio de peso (ver useMovement); se llena
  // cuando carga el modelo.
  const lowerBodyRef = useRef<Record<string, THREE.Object3D | null>>({});
  const movement = useMovement({
    movementBonesRef,
    fingerBonesRef,
    boneRestRotationRef,
    chestBoneRef,
    headBoneRef,
    lowerBodyRef,
  });

  const face = useFace({ vrmRef, gazeTargetObjectRef });

  // Sigue el mouse con la mirada cuando pasa cerca de ella.
  const cursorGaze = useCursorGaze({
    cameraRef,
    canvasRef,
    headBoneRef,
    gazeOverrideRef: face.gazeOverrideRef,
  });

  // Captura el canvas como imagen después de que la animación probablemente
  // ya se asentó, para que la próxima consulta al LLM pueda incluir cómo
  // quedó ella de verdad, no solo la descripción textual. Se hace marcando
  // un momento objetivo -- la captura real ocurre dentro del loop de
  // animate(), justo después de renderer.render(), para no depender de un
  // setTimeout desincronizado del ciclo de dibujo.
  function captureSelfImageAfterDelay(delayMs: number) {
    selfImageCaptureAtRef.current = performance.now() + delayMs;
  }

  // Fase 7: mismo mecanismo que captureSelfImageAfterDelay, pero acepta
  // VARIOS delays -- una foto por punto del ciclo que se quiera capturar
  // (ver el contrato en onAfterRender más abajo, y el comentario en
  // quirkImageCaptureAtRef sobre por qué una sola no alcanza para
  // animados). Para un quirk no animado, se sigue llamando con un solo
  // delay -- el comportamiento de antes queda intacto para ese caso.
  function captureQuirkImagesAfterDelays(delaysMs: number[]) {
    const now = performance.now();
    quirkImageCaptureAtRef.current = delaysMs.map((d) => now + d);
  }

  const speech = useSpeech({
    setExpression: face.setExpression,
    showExpressionFor: face.showExpressionFor,
    setViseme: face.setViseme,
    resetVisemes: face.resetVisemes,
    isSpeakingRef: face.isSpeakingRef,
    mutedRef: voiceMutedRef,
    lipsyncModeRef,
  });

  // Tarea 8.1: silencio sostenido mientras se graba corta sola, sin
  // soltar el botón -- y a diferencia de un corte manual, "voz sin manos"
  // de verdad manda el mensaje solo en vez de dejarlo esperando un click
  // de "Enviar" (bug real reportado por Sebastián en la primera prueba:
  // cortaba en el momento justo pero el mensaje se quedaba sin mandar).
  async function handleAutoStopRecording() {
    const text = await speechRecognition.autoStopListening();
    handleSendTranscript(text);
  }

  // Tarea 8.1: voz sostenida en la ventana de seguimiento tras su
  // respuesta (sin repetir "Hey Miku"): arranca a escuchar. Ya no la corta
  // mientras habla (ver useVoiceActivityDetection).
  function handleSpeechDuringPlayback() {
    speechRecognition.toggleListening();
  }

  const vad = useVoiceActivityDetection({
    isVoiceReady,
    listening: speechRecognition.listening,
    isSpeaking: speech.isSpeaking,
    onAutoStopRecording: handleAutoStopRecording,
    onSpeechDuringPlayback: handleSpeechDuringPlayback,
  });

  // Tarea 8.7: briefing automático al sentarse -- se dispara desde el
  // arranque de askMiku (ver más abajo), no acá.
  const briefing = useBriefing({
    speak: speech.speak,
    voicePitchRef,
    voiceRateRef,
  });

  // Tarea 8.9: diario nocturno -- se engancha a useVoiceServer para correr
  // ANTES de sync_memory_to_github al cerrar la app. registerBeforeSync es
  // estable (useCallback con []), así que este efecto solo corre una vez
  // en la práctica, pero igual se re-registra si por algo cambiara la
  // referencia de maybeWriteDiaryEntry entre renders.
  const diary = useDiary({ conversationHistoryRef });
  useEffect(() => {
    registerBeforeSync(diary.maybeWriteDiaryEntry);
  }, [registerBeforeSync, diary.maybeWriteDiaryEntry]);

  const avatarState: "idle" | "listening" | "thinking" | "speaking" =
    speechRecognition.listening || speechRecognition.transcribing
      ? "listening"
      : speech.isSpeaking
        ? "speaking"
        : isThinking
          ? "thinking"
          : "idle";

  // Creado antes que useIdleQuirks: idea #21, los pendientes vencidos que
  // el loop idle decide mencionar ya no hablan directo -- se encolan acá,
  // igual que correo nuevo y los avisos de Calendar no urgentes.
  const notificationDigest = useNotificationDigest({
    speak: speech.speak,
    voicePitchRef,
    voiceRateRef,
  });

  const idleQuirks = useIdleQuirks({
    boneTransitionsRef: movement.boneTransitionsRef,
    boneRestRotationRef,
    scheduleMovement: movement.scheduleMovement,
    revertAnimatedBonesExcept: movement.revertAnimatedBonesExcept,
    scheduleHandGesture: movement.scheduleHandGesture,
    queueAnnouncement: notificationDigest.queueAnnouncement,
    voicePitchRef,
    voiceRateRef,
    captureQuirkImagesAfterDelays,
    quirkSelfImagesRef,
    pendingQuirkDescriptionRef,
    resolveReach,
    showExpressionFor: face.showExpressionFor,
  });

  const reminders = useReminders({
    speak: speech.speak,
    voicePitchRef,
    voiceRateRef,
  });

  const gmailWatcher = useGmailWatcher({
    queueAnnouncement: notificationDigest.queueAnnouncement,
  });

  const calendarWatcher = useCalendarWatcher({
    speak: speech.speak,
    voicePitchRef,
    voiceRateRef,
    queueAnnouncement: notificationDigest.queueAnnouncement,
  });

  const taskWatcher = useTaskWatcher({
    queueAnnouncement: notificationDigest.queueAnnouncement,
  });

  const memoryFiles = useMemoryFiles();
  const appLauncher = useAppLauncher();
  const streamMode = useStreamMode();
  useAudioDevices();

  async function askMiku(userMessage: string, imageDataUrl?: string | null) {
    if (!isVoiceReady) return;
    // A6: si la cortó con ⏹ (antes de cualquier await: si ella sigue
    // hablando, queda registrado que él le escribió encima).
    const talkSignals = takeTalkSignals();
    sleep.wakeUp("le hablaron");
    setIsThinking(true);
    idleQuirks.lastInteractionTimeRef.current = performance.now();
    // Tarea 8.7: fire-and-forget a propósito -- no se espera, para no
    // demorar la respuesta real a lo que Sebastián acaba de decir. Si hay
    // algo que contar, queda encolado en speech ANTES que la respuesta de
    // este turno (se escucha primero); si no hay nada, no hace nada.
    briefing.maybeGiveBriefing().catch((err) =>
      console.error("Error en el briefing automático:", err),
    );
    try {
      // Tarea 8.11: se busca con lo que dijo ahora Y la última respuesta de
      // Miku -- un "sí, hazlo" solo no dice de qué se está hablando. Sirve
      // para el conocimiento y para traer recuerdos viejos relacionados.
      const lastAssistantText =
        conversationHistoryRef.current
          .flat()
          .filter((m) => m.role === "assistant" && typeof m.content === "string")
          .map((m) => m.content as string)
          .pop() ?? "";
      const talkQuery = `${lastAssistantText.slice(-600)}\n${userMessage}`;
      const { personality, world, memories } = await loadMemoryContext(talkQuery);

      const customGestureNames = Object.keys(
        movement.customHandGesturesRef.current,
      );
      const selfDescription = pendingSelfDescriptionRef.current;
      pendingSelfDescriptionRef.current = null;

      // Tarea 6.7: fecha de hoy (para que calcule fechas relativas al
      // anotar pendientes) y la lista de pendientes activos.
      const now = new Date();
      const todayLabel = now.toLocaleDateString("es-ES", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      // YYYY-MM-DD en hora LOCAL (no now.toISOString(), que convierte a
      // UTC primero y puede dar la fecha de ayer/mañana cerca de
      // medianoche) -- mismo formato que Android (LocalDate.now()), para
      // que GUARDAR_MEMORIA se vea igual sin importar desde dónde se
      // escriba (ver comentario en systemPrompt.ts).
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const activePendientes = getActivePendientes(await loadPendientes());
      // Tarea 8.10: humor persistido entre conversaciones -- default de
      // EXPRESION si esta respuesta no trae una expresión puntual propia
      // (ver más abajo, donde se usa en vez del "neutral" fijo de antes).
      const currentMood = await getCurrentMood();
      // Tarea 8.3: qué estaba usando Sebastián (sin contar esta ventana).
      const activeWindow = await invoke<{
        title: string;
        processName: string;
        secondsAgo: number;
      } | null>("ventana_activa").catch(() => null);
      const relevantKnowledge = await retrieveKnowledge(talkQuery);

      const systemPrompt = buildSystemPrompt({
        world,
        personality,
        memories,
        selfDescription,
        customGestureNames,
        todayLabel,
        todayIso,
        activePendientes,
        currentMood,
        activeWindow,
        streamModeActive: isStreamModeActive(),
        relevantKnowledge,
        recentTouches: consumeTouchSummary(),
        gameContext: await describeGameContext(),
        knowledgeEditFeedback: takeKnowledgeEditFeedback(),
        talkSignals,
        resumedNote: resumedNoteRef.current,
      });
      resumedNoteRef.current = null;

      // Aplana los turnos guardados a la forma plana que espera la API,
      // pasando tool_calls/tool_call_id tal cual cuando corresponde.
      const historyMessages = conversationHistoryRef.current.flat().map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            content: m.content,
            tool_call_id: m.tool_call_id,
          };
        }
        if (m.role === "assistant") {
          return {
            role: "assistant",
            content: m.content,
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          };
        }
        return { role: "user", content: m.content };
      });

      // Si hay una imagen de sí misma pendiente de un movimiento anterior,
      // se adjunta aquí -- así ve cómo quedó antes de responder este turno.
      const selfImage = lastSelfImageRef.current;
      lastSelfImageRef.current = null;
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
        contentParts.push({
          type: "text",
          text: "(Así quedó tu cuerpo después de tu último movimiento: frente, tu izquierda, espalda y tu derecha.)",
        });
        contentParts.push({ type: "image_url", image_url: { url: selfImage } });
      }
      const userContent: ChatContent =
        contentParts.length > 1 ? contentParts : userMessage;

      const toolCycle = await runToolCallingCycle(
        OPENROUTER_MODEL,
        [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: userContent },
        ],
        (attempt, max, delay) => {
          setLlmResponse(
            `Miku está saturada del lado del proveedor, reintentando en ${delay / 1000}s... (intento ${attempt}/${max})`,
          );
        },
      );

      let reply = toolCycle.finalContent || "No obtuve respuesta.";

      await memoryFiles.processMemoryMarkers(reply);

      const expressionMatches = [
        ...reply.matchAll(
          /\[EXPRESION:\s*(happy|angry|sad|relaxed|neutral)\]/gi,
        ),
      ];
      // [CARA] (partes sueltas, ver lib/faceParts.ts) gana sobre [EXPRESION].
      const expression =
        parseFaceMarker(reply) ??
        (expressionMatches.length > 0
          ? expressionMatches[expressionMatches.length - 1][1].toLowerCase()
          : currentMood);

      // Tarea 8.10: si esta respuesta cambió su humor de base, se
      // persiste para las próximas conversaciones -- fire-and-forget, no
      // hace falta esperar para seguir con el resto de la respuesta.
      const newMood = parseMoodMarker(reply);
      if (newMood) {
        setMood(newMood).catch((err) =>
          console.error("Error guardando el estado de ánimo:", err),
        );
      }

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

      const explicitMovement = parseMovementMarker(reply);
      // [LLEVAR_MANO]: se resuelve antes de programar nada (sobre la pose
      // final) y se programa aparte; para la foto y la descripción de su
      // propio cuerpo cuenta junto con [MOVIMIENTO].
      const reachMovement = resolveReach(reply, explicitMovement);
      if (explicitMovement) {
        movement.scheduleMovement(explicitMovement, "response");
      }
      if (reachMovement) {
        movement.scheduleMovement(reachMovement, "response");
      }
      const parsedMovement: ParsedMovement | null =
        explicitMovement && reachMovement
          ? {
              ...explicitMovement,
              entries: [...reachMovement.entries, ...explicitMovement.entries],
              durationMs: Math.max(explicitMovement.durationMs, reachMovement.durationMs),
            }
          : (explicitMovement ?? reachMovement);

      // Tarea 3.1, Paso 2b: creación de gesto propio, si la respuesta la
      // incluye. Se guarda ANTES de procesar [GESTO_MANO], por si en la
      // misma respuesta ella crea un gesto y lo usa de inmediato.
      const parsedCreateGesture = parseCreateHandGestureMarker(reply);
      if (parsedCreateGesture) {
        await movement.saveCustomHandGesture(
          parsedCreateGesture.name,
          parsedCreateGesture.curls,
          parsedCreateGesture.animated,
        );
      }

      const parsedHandGesture = parseHandGestureMarker(reply);
      if (parsedHandGesture) {
        if (parsedHandGesture.left) {
          movement.scheduleHandGesture(
            "left",
            parsedHandGesture.left,
            parsedHandGesture.durationMs,
            "response",
          );
        }
        if (parsedHandGesture.right) {
          movement.scheduleHandGesture(
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
        movement.animatedHandSidesRef.current.left ||
        movement.animatedHandSidesRef.current.right;

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

      // Decidió cambiar alguna de sus reacciones al tacto.
      await processRedesignMarkers(reply);

      reply = stripMarkers(reply);

      // El turno completo -- incluyendo cualquier vuelta de tool calling
      // que haya habido -- se guarda como bloque indivisible (ver gotcha en
      // lib/openrouter.ts). El último mensaje assistant se reemplaza por la
      // versión ya sin marcadores, igual que antes de la Tarea 6.1.
      const turnMessages: ChatMessage[] = [
        { role: "user", content: userContent },
        ...toolCycle.appendedMessages.slice(0, -1),
        { role: "assistant", content: reply },
      ];
      conversationHistoryRef.current.push(turnMessages);
      if (conversationHistoryRef.current.length > MAX_HISTORY_TURNS) {
        conversationHistoryRef.current =
          conversationHistoryRef.current.slice(-MAX_HISTORY_TURNS);
      }
      saveChatHistory(conversationHistoryRef.current);

      // El texto ya NO se muestra completo de una -- se revela en sync con
      // el audio (ver onReveal en useSpeech.ts), para inmersión. "Pensando..."
      // se queda puesto (ver JSX) hasta que el audio arranca de verdad, no
      // solo hasta que el LLM responde -- includes el tiempo de síntesis de
      // voz, que también tarda.
      let revealStarted = false;
      const liveReply = beginReply(reply, userMessage);
      await speech.speak(reply, messagePitch, messageRate, expression, (partial) => {
        if (!revealStarted) {
          revealStarted = true;
          setIsThinking(false);
        }
        noteRevealProgress(liveReply, partial);
        setLlmResponse(partial);
      });
      endReply(liveReply);

      // Tarea 8.1: solo tras una respuesta conversacional real (no un
      // quirk idle, ni el resumen agrupado, ni un recordatorio) se abre la
      // ventana de seguimiento -- seguir la conversación sin repetir
      // "Hey Miku" tiene sentido acá, no después de un aviso de fondo.
      vad.armFollowUpWindow();

      memoryFiles.consolidateMemoryIfNeeded();
    } catch (err) {
      console.error("Error al consultar el LLM:", err);
      setLlmResponse("Hubo un error al conectar con el modelo.");
    } finally {
      setIsThinking(false);
    }
  }

  // Tarea 8.1: acepta un texto explícito (ver handleAutoStopRecording) para
  // el caso de "voz sin manos" -- el VAD ya transcribió y quiere mandarlo
  // sin pasar por el cuadro de texto. Sin argumento, usa lo que haya en el
  // cuadro (flujo manual de siempre).
  const handleSendTranscript = (textOverride?: string) => {
    const messageToSend = (textOverride ?? transcript).trim();
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

  // --- Etapa 5: el contrato del loop animate() vive en useVRMScene. Estas
  // dos funciones son las que hoy corrían inline dentro del useEffect de
  // la escena -- se mueven tal cual, solo leyendo de refs en lugar de
  // variables de closure locales, porque el loop mismo pasó a vivir en el
  // hook. onBeforeRender corre ANTES de vrm.update(delta) (escribe
  // rotaciones de huesos y pesos de expresión); onAfterRender corre
  // DESPUÉS de renderer.render() (captura de imagen de sí misma). El hook
  // pasa "elapsed" (segundos, THREE.Clock) además de "now"
  // (performance.now(), igual que espera selfImageCaptureAtRef) porque
  // este código usa ambas fuentes de tiempo tal como estaban.
  const perfMonitor = usePerfMonitor();

  function onBeforeRender(now: number, delta: number, elapsed: number) {
    // Etapa 6: el balanceo de respiración de pecho/cabeza, los reverts
    // automáticos de quirks y las transiciones de huesos en curso ahora
    // los procesa useMovement. Kickear el quirk idle es fire-and-forget
    // (no toca nada síncronamente en este mismo frame), así que no
    // importa si corre antes o después de updateMovement().
    // La mirada al cursor va antes de updateFace: decide a dónde miran los ojos.
    cursorGaze.update();
    movement.updateMovement(now, delta, elapsed);

    // Etapa 9: el temporizador de silencio y el disparo del quirk idle
    // ahora los procesa useIdleQuirks.
    idleQuirks.checkIdleQuirk(now);
    sleep.check(now);

    // poner_recordatorio: chequeo liviano (solo timestamps en memoria) de
    // recordatorios vencidos, independiente del intervalo de 2.5 minutos
    // del quirk idle -- un timer de "en 5 minutos" no puede esperar a que
    // el silencio dispare el loop idle.
    reminders.checkReminders();

    // Aviso de correo nuevo (variante de la idea original de enganchar
    // Gmail al loop idle) -- chequeo propio, no depende de que el quirk
    // idle decida hablar de eso.
    gmailWatcher.checkGmail(now);

    // Idea #7: mismo mecanismo, para avisar de un evento de Calendar que
    // está por empezar.
    calendarWatcher.checkCalendar(now);

    // Idea #9: tareas de seguimiento (pendientes con condición) -- revisa
    // como mucho una por ciclo, cada TASK_WATCH_INTERVAL_MS (horas, no
    // minutos, porque cada revisión cuesta una búsqueda real).
    taskWatcher.checkTasks(now);

    // Resumen agrupado: lee junto todo lo que se haya acumulado (correo,
    // avisos de anticipación larga, y ahora también pendientes vencidos que
    // el quirk idle de arriba haya decidido mencionar -- idea #21) cada
    // NOTIFICATION_DIGEST_INTERVAL_MS.
    notificationDigest.checkDigest(now);

    // Etapa 7: suavizado de expresiones, parpadeo y mirada errante ahora
    // los procesa useFace.
    face.updateFace(now, delta);
  }

  // Foto de sí misma (después de un movimiento, o de un quirk en
  // evaluación): las 4 vistas de mirarme (lib/selfView.ts) en vez de la
  // cámara de la ventana -- cuerpo entero (la ventana corta a la altura de
  // los muslos), fondo neutro y 4 ángulos por imagen, que es lo que le
  // falta para juzgar una pose (de frente, adelante/atrás casi no se ve).
  // Costo medido: ~10 ms contra ~7 ms del PNG de la ventana; los dos entran
  // en un cuadro. Si la escena no está lista, cae a la ventana como antes.
  function captureSelfPhoto(renderer: THREE.WebGLRenderer): string {
    const vrm = vrmRef.current;
    const scene = sceneRef.current;
    if (vrm && scene) return captureSelfView(vrm, renderer, scene, "cuatro", "cuerpo");
    return renderer.domElement.toDataURL("image/png");
  }

  function onAfterRender(renderer: THREE.WebGLRenderer, now: number) {
    perfMonitor.onFrame(renderer, now);
    if (
      selfImageCaptureAtRef.current !== null &&
      now >= selfImageCaptureAtRef.current
    ) {
      selfImageCaptureAtRef.current = null;
      try {
        lastSelfImageRef.current = captureSelfPhoto(renderer);
      } catch (err) {
        console.error("Error capturando imagen de sí misma:", err);
      }
      // Junto con la foto: cómo quedó de verdad, medido en la pose.
      appendMeasuredBody(pendingSelfDescriptionRef);
    }

    // Fase 7: mismo mecanismo, para las fotos de un quirk en evaluación --
    // ahora puede haber varias pendientes (una por punto del ciclo, ver
    // captureQuirkImagesAfterDelays). Se capturan en orden a medida que se
    // cumple cada timestamp, sin descartar las que ya se sacaron.
    if (quirkImageCaptureAtRef.current.length > 0) {
      const stillPending: number[] = [];
      for (const captureAt of quirkImageCaptureAtRef.current) {
        if (now >= captureAt) {
          try {
            quirkSelfImagesRef.current = [
              ...quirkSelfImagesRef.current,
              captureSelfPhoto(renderer),
            ];
          } catch (err) {
            console.error("Error capturando imagen del quirk:", err);
          }
        } else {
          stillPending.push(captureAt);
        }
      }
      quirkImageCaptureAtRef.current = stillPending;
      // Después de la última foto del quirk: cómo quedó, medido. (Si es
      // animado, la última foto es el final del ciclo.)
      if (stillPending.length === 0) appendMeasuredBody(pendingQuirkDescriptionRef);
    }
  }

  // Propiocepción real (ver lib/bodySense.ts): agrega a la descripción ya
  // armada (los valores que pidió) cómo quedó el cuerpo de verdad.
  function appendMeasuredBody(descriptionRef: RefObject<string | null>) {
    const vrm = vrmRef.current;
    if (!vrm) return;
    try {
      const measured = describeBodyNow(vrm) ?? "- Todo tu cuerpo quedó en reposo.";
      const requested = descriptionRef.current;
      descriptionRef.current = `${requested ? `${requested}\n` : ""}Cómo quedó de verdad, medido en tu cuerpo:\n${measured}`;
    } catch (err) {
      console.error("Error midiendo el cuerpo:", err);
    }
  }

  const { isVrmLoaded } = useVRMScene({
    canvasRef,
    vrmRef,
    rendererRef,
    sceneRef,
    cameraRef,
    controlsRef,
    boneRestRotationRef,
    movementBonesRef,
    fingerBonesRef,
    chestBoneRef,
    headBoneRef,
    gazeTargetObjectRef,
    onBeforeRender,
    onAfterRender,
  });
  const isMikuReady = isVoiceReady && isVrmLoaded;

  // Tool `mirarme` (ver lib/selfView.ts y lib/tools/mirarme.ts): la tool no
  // ve la escena, así que se le registra acá la función que captura. Con
  // una pose de prueba, se aplica a los huesos solo para la foto y después
  // cada hueso vuelve exactamente a como estaba -- el siguiente cuadro de
  // la ventana ni se entera.
  useEffect(() => {
    const humanoid = isVrmLoaded ? vrmRef.current?.humanoid : null;
    if (!humanoid) return;
    for (const name of ["hips", "leftUpperLeg", "rightUpperLeg", "leftLowerLeg", "rightLowerLeg"] as const) {
      lowerBodyRef.current[name] = humanoid.getNormalizedBoneNode(name) ?? null;
    }
  }, [isVrmLoaded]);

  useEffect(() => {
    if (!isVrmLoaded) return;
    registerSelfViewCapturer((angle, framing, preview, fromRest) => {
      const vrm = vrmRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      if (!vrm || !renderer || !scene) throw new Error("La escena todavía no está lista");

      const saved: [THREE.Object3D, "x" | "y" | "z", number][] = [];
      if (fromRest) {
        for (const [bone, node] of Object.entries(movementBonesRef.current)) {
          const rest = boneRestRotationRef.current[bone];
          if (!node || !rest) continue;
          for (const axis of ["x", "y", "z"] as const) {
            saved.push([node, axis, node.rotation[axis]]);
            node.rotation[axis] = rest[axis];
          }
        }
      }
      for (const { bone, axis, intensity } of preview?.entries ?? []) {
        const node = movementBonesRef.current[bone];
        const range = BONE_RANGES_DEG[bone]?.[axis];
        if (!node || !range) continue;
        saved.push([node, axis, node.rotation[axis]]);
        const restRad = boneRestRotationRef.current[bone]?.[axis] ?? 0;
        node.rotation[axis] = restRad + (intensityToDegrees(intensity, range[0], range[1]) * Math.PI) / 180;
      }
      try {
        // Los huesos que se tocan son los "normalizados"; el modelo se
        // dibuja con los reales -- esto los sincroniza (sin avanzar la
        // física del pelo, que sí haría vrm.update).
        if (saved.length > 0) vrm.humanoid?.update();
        vrm.scene.updateMatrixWorld(true);
        return { image: captureSelfView(vrm, renderer, scene, angle, framing), bodySense: describeBodyNow(vrm) };
      } finally {
        for (const [node, axis, value] of saved.reverse()) node.rotation[axis] = value;
        if (saved.length > 0) {
          vrm.humanoid?.update();
          vrm.scene.updateMatrixWorld(true);
        }
      }
    });
    return () => registerSelfViewCapturer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVrmLoaded]);

  // [LLEVAR_MANO] (ver lib/reach.ts): devuelve SOLO el movimiento de los
  // brazos, para programarlo aparte del [MOVIMIENTO] de la misma respuesta
  // (si ese es animado, la mano no tiene que quedar oscilando). Se resuelve
  // sobre la pose en la que va a TERMINAR: los destinos de las transiciones
  // en curso y de `base` se aplican un momento, y después todo vuelve.
  // Los ejes que `base` ya pone a mano ganan sobre los calculados.
  function resolveReach(text: string, base: ParsedMovement | null): ParsedMovement | null {
    const reach = parseReachMarker(text, DEFAULT_MOVEMENT_DURATION_MS);
    const vrm = vrmRef.current;
    if (!reach || !vrm) return null;
    const bones = movementBonesRef.current;
    const rest = boneRestRotationRef.current;
    const saved: [THREE.Object3D, "x" | "y" | "z", number][] = [];
    const setTemporarily = (bone: string, axis: "x" | "y" | "z", rad: number) => {
      const node = bones[bone];
      if (!node) return;
      saved.push([node, axis, node.rotation[axis]]);
      node.rotation[axis] = rad;
    };
    for (const [key, transition] of Object.entries(movement.boneTransitionsRef.current)) {
      const [bone, axis] = key.split(".") as [string, "x" | "y" | "z"];
      if (!transition.animated) setTemporarily(bone, axis, transition.targetValue);
    }
    for (const e of base?.entries ?? []) {
      const range = BONE_RANGES_DEG[e.bone]?.[e.axis];
      if (!range) continue;
      const deg = intensityToDegrees(e.intensity, range[0], range[1]);
      setTemporarily(e.bone, e.axis, (rest[e.bone]?.[e.axis] ?? 0) + (deg * Math.PI) / 180);
    }

    const solved: ParsedMovement["entries"] = [];
    try {
      const camera = cameraRef.current?.position.clone() ?? null;
      for (const [side, request] of [["left", reach.left], ["right", reach.right]] as const) {
        if (!request) continue;
        const result = solveReach(vrm, bones, rest, side, request.place, camera, request.palm);
        if (result) solved.push(...result.entries);
      }
    } finally {
      for (const [node, axis, value] of saved.reverse()) node.rotation[axis] = value;
      vrm.humanoid?.update();
      vrm.scene.updateMatrixWorld(true);
    }

    const explicit = new Set((base?.entries ?? []).map((e) => `${e.bone}.${e.axis}`));
    const entries = solved.filter((e) => !explicit.has(`${e.bone}.${e.axis}`));
    return entries.length > 0 ? { entries, durationMs: reach.durationMs, animated: false } : null;
  }

  useEffect(() => {
    registerReachResolver(resolveReach);
    return () => registerReachResolver(null);
  });

  // Tarea 8.12: reacción al tacto (ver useTouchReactions.ts).
  const touch = useTouchReactions({
    vrmRef,
    cameraRef,
    canvasRef,
    scheduleMovement: movement.scheduleMovement,
    releaseQuirkRevertsNow: movement.releaseQuirkRevertsNow,
    getExpression: face.getExpression,
    setExpression: face.setExpression,
    isSpeakingRef: face.isSpeakingRef,
    onInteraction: () => {
      idleQuirks.lastInteractionTimeRef.current = performance.now();
    },
    processMemoryMarkers: memoryFiles.processMemoryMarkers,
  });

  // Punto 3: se duerme cuando Sebastián no está (ver useSleep.ts).
  const sleep = useSleep({
    scheduleMovement: movement.scheduleMovement,
    releaseQuirkRevertsNow: movement.releaseQuirkRevertsNow,
    revertAnimatedBonesExcept: movement.revertAnimatedBonesExcept,
    getExpression: face.getExpression,
    setExpression: face.setExpression,
    showExpressionFor: face.showExpressionFor,
    isSpeakingRef: face.isSpeakingRef,
    lastInteractionTimeRef: idleQuirks.lastInteractionTimeRef,
    processMemoryMarkers: memoryFiles.processMemoryMarkers,
  });

  // Pausas en sesiones largas de juego (ver useGameBreaks.ts).
  const gameBreaks = useGameBreaks({ speak: speech.speak, voicePitchRef, voiceRateRef });
  useEffect(() => {
    const id = setInterval(() => {
      gameBreaks.check().catch(console.error);
    }, 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modo juego (ver useGameMode.ts / game_mode.rs).
  const gameMode = useGameMode({
    busy: speechRecognition.listening || isThinking || speech.isSpeaking,
    // Oculta, el bucle de dibujo (donde se revisan los recordatorios) está
    // detenido y los temporizadores de la página, frenados: los
    // recordatorios y las pausas se revisan con el latido de Rust.
    onHiddenHeartbeat: () => {
      reminders.checkReminders();
      gameBreaks.check().catch(console.error);
    },
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !freeCamera) {
      appWindow.startDragging();
    }
  };

  // Tarea 8.12: sobre Miku, el clic es para tocarla -- la ventana se
  // arrastra desde la barra de arriba (ver handleToolbarMouseDown). Un
  // clic que se movió más de unos píxeles antes de soltar no cuenta como
  // toque.
  const TAP_MAX_MOVE_PX = 4;
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !freeCamera) {
      pressStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!freeCamera && e.buttons === 0) {
      touch.handleHover(e.clientX, e.clientY);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent) => {
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (e.button !== 0 || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_MAX_MOVE_PX) return;
    touch.handleTap(e.clientX, e.clientY);
  };

  // Arrastrar la ventana: desde el agarre o cualquier parte vacía de la
  // barra (no desde sus botones).
  // Arrastrar desde CUALQUIER parte de la barra (pedido de Sebastián):
  // desde el fondo o el agarre, al instante; desde un botón, recién si el
  // mouse se mueve más de unos píxeles con el botón apretado -- así un clic
  // quieto sigue siendo un clic. Una vez que arranca el arrastre, Windows
  // se queda con el mouse y el clic del botón ya no llega.
  const toolbarPressRef = useRef<{ x: number; y: number } | null>(null);
  const handleToolbarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) {
      toolbarPressRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    appWindow.startDragging();
  };
  const handleToolbarMouseMove = (e: React.MouseEvent) => {
    const press = toolbarPressRef.current;
    if (!press) return;
    if (!(e.buttons & 1)) {
      toolbarPressRef.current = null;
      return;
    }
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
      toolbarPressRef.current = null;
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
      className={`app-container ${gameMode.visual !== "shown" ? `game-${gameMode.visual}` : ""}`}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {showToolbar && (
        <div
          className="toolbar"
          onMouseDown={handleToolbarMouseDown}
          onMouseMove={handleToolbarMouseMove}
          onMouseUp={() => {
            toolbarPressRef.current = null;
          }}
          onMouseLeave={() => {
            toolbarPressRef.current = null;
          }}
        >
          <span className="toolbar-grip" title="Arrastrar para mover a Miku">
            ⠿
          </span>
          {/* Los botones de alternar van como íconos (con su explicación al
              pasar el mouse): con texto no entraban los 13 en 750 px, y los
              de la izquierda quedaban cortados fuera de la barra. */}
          <button
            className={`icon-btn ${freeCamera ? "active" : ""}`}
            onClick={() => setFreeCamera((v) => !v)}
            title="Cámara libre (mover la vista con el mouse)"
          >
            🎥
          </button>
          <button className="icon-btn" onClick={handleSaveCamera} title="Guardar la posición de la cámara">
            💾
          </button>
          <button
            className={`icon-btn ${clickThrough ? "active" : ""}`}
            onClick={() => setClickThrough((v) => !v)}
            title="Bloquear a Miku: los clics pasan a lo que hay detrás (Ctrl+Shift+M)"
          >
            🔒
          </button>
          <button
            className={`icon-btn ${voiceMuted ? "active" : ""}`}
            onClick={() => setVoiceMuted((v) => !v)}
            title={voiceMuted ? "Miku está silenciada (clic para volver a oírla)" : "Silenciar la voz de Miku"}
          >
            {voiceMuted ? "🔇" : "🔊"}
          </button>
          {speech.isSpeaking && (
            <button
              className="icon-btn"
              onClick={() => {
                noteInterruption("botón");
                speech.stopSpeaking();
              }}
              title="Cortar lo que está diciendo ahora"
            >
              ⏹
            </button>
          )}
          <button
            className={`icon-btn ${speechRecognition.listening ? "active" : ""}`}
            onClick={speechRecognition.toggleListening}
            disabled={!isVoiceReady}
            title={
              !isVoiceReady
                ? "Esperando al servidor de voz..."
                : speechRecognition.listening
                  ? "Escuchando... (clic para terminar)"
                  : "Hablarle a Miku (micrófono)"
            }
          >
            🎤
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
            className={showAppLauncher ? "active" : ""}
            onClick={() => setShowAppLauncher((v) => !v)}
          >
            Apps
          </button>
          <button
            className={showQuirksPanel ? "active" : ""}
            onClick={() => setShowQuirksPanel((v) => !v)}
          >
            Quirks
          </button>
          <button
            className={showMemoryPanel ? "active" : ""}
            onClick={() => setShowMemoryPanel((v) => !v)}
          >
            Memoria
          </button>
          <button
            className={`icon-btn ${hideResponseText ? "active" : ""}`}
            onClick={() => setHideResponseText((v) => !v)}
            title={
              hideResponseText
                ? "El texto de respuesta está oculto (clic para mostrarlo)"
                : "Ocultar el texto de respuesta (para sacar capturas limpias)"
            }
          >
            🙈
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
            onClick={() => handleSendTranscript()}
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

      {showAppLauncher && (
        <AppLauncherPanel
          discoveredApps={appLauncher.discoveredApps}
          customApps={appLauncher.customApps}
          config={appLauncher.config}
          onToggleAppHidden={appLauncher.toggleAppHidden}
          onSetFolderApps={appLauncher.setFolderApps}
          onRenameFolder={appLauncher.renameFolder}
          onDeleteFolder={appLauncher.deleteFolder}
          onSetAppUrl={appLauncher.setAppUrl}
          onAddCustomApp={appLauncher.addCustomApp}
          onRemoveCustomApp={appLauncher.removeCustomApp}
          onSetActionsDisabled={appLauncher.setActionsDisabled}
          onClose={() => setShowAppLauncher(false)}
        />
      )}

      {showQuirksPanel && (
        <QuirksPanel
          quirks={quirksState}
          onConfirm={handleConfirmQuirk}
          onRevertToEvaluando={handleRevertQuirkToEvaluando}
          onDelete={handleDeleteQuirk}
          onClose={() => setShowQuirksPanel(false)}
        />
      )}

      {showMemoryPanel && <MemoryPanel onClose={() => setShowMemoryPanel(false)} />}

      {showConfig && (
        <ConfigPanel
          voicePitch={voicePitch}
          setVoicePitch={setVoicePitch}
          voiceRate={voiceRate}
          setVoiceRate={setVoiceRate}
          lipsyncMode={lipsyncMode}
          setLipsyncMode={setLipsyncMode}
          connections={connections}
          streamMode={streamMode}
          gameMode={gameMode}
        />
      )}
      {/* "hablando" no lleva insignia -- ya se ve directo (boca moviéndose
          + texto revelándose), agregarla es redundante. Sebastián lo pidió
          sacar tras ver las tres juntas. */}
      {(avatarState === "listening" || avatarState === "thinking") && (
        <div className={`avatar-state-badge avatar-state-${avatarState}`}>
          {avatarState === "listening" && "🎙️ Escuchando..."}
          {avatarState === "thinking" && "💭 Pensando..."}
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
            <div className="voice-loading-badge-row">
              <span className="loading-spinner" />
              <span
                className={`loading-text ${
                  !isVoiceReady && !downloadProgress && !loadingPhraseVisible
                    ? "loading-text-hidden"
                    : ""
                }`}
              >
                {!isVoiceReady
                  ? downloadProgress
                    ? `Descargando el servidor de voz... ${Math.round(
                        (downloadProgress.downloaded / downloadProgress.total) * 100,
                      )}%`
                    : loadingPhrase
                  : "Cargando a Miku..."}
              </span>
            </div>
            {downloadProgress && (
              <div className="download-progress-track">
                <div
                  className="download-progress-fill"
                  style={{
                    width: `${Math.round(
                      (downloadProgress.downloaded / downloadProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`miku-canvas ${isMikuReady ? "ready" : ""}`}
        style={{ display: "block" }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={() => {
          pressStartRef.current = null;
        }}
      />
    </div>
  );
}

export default App;
