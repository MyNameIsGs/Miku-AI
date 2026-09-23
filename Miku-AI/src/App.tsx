import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { useAudioDevices } from "./hooks/useAudioDevices";
import { AppLauncherPanel } from "./components/AppLauncherPanel";
import { QuirksPanel } from "./components/QuirksPanel";
import {
  loadQuirks,
  confirmQuirk,
  revertQuirkToEvaluando,
  deleteQuirk,
  QuirksStore,
} from "./lib/quirks";
import { ChatContentPart, ChatContent, ChatMessage } from "./types";
import {
  OPENROUTER_MODEL,
  MAX_HISTORY_TURNS,
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
import { MCP_SERVERS, McpServerConfig, connectMcpServer, disconnectMcpServer } from "./lib/mcp";
import { describeSelfMovement, uint8ToBase64 } from "./lib/proprioception";
import { loadPendientes, getActivePendientes } from "./lib/pendientes";
import { connectSpotify, isSpotifyConnected } from "./lib/spotify/auth";
import {
  connectGmail,
  disconnectGmailAccount,
  listConnectedGmailEmails,
} from "./lib/gmail/auth";
import {
  connectCalendar,
  disconnectCalendarAccount,
  listConnectedCalendarEmails,
} from "./lib/calendar/auth";

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
  const [showConfig, setShowConfig] = useState(false);
  const [showAppLauncher, setShowAppLauncher] = useState(false);
  const [showQuirksPanel, setShowQuirksPanel] = useState(false);
  const [quirksState, setQuirksState] = useState<QuirksStore>({});
  const [hideResponseText, setHideResponseText] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [gmailAccounts, setGmailAccounts] = useState<string[]>([]);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [calendarAccounts, setCalendarAccounts] = useState<string[]>([]);
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  // Tarea 8.2: Miku como cliente MCP -- qué servidores (ver MCP_SERVERS en
  // lib/mcp.ts) están conectados ahora mismo, en esta sesión (no persiste
  // entre reinicios a propósito: son subprocesos, no tiene sentido
  // "recordar" que estaban conectados si el proceso real ya no existe).
  const [mcpConnectedIds, setMcpConnectedIds] = useState<string[]>([]);
  const [mcpConnectingId, setMcpConnectingId] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
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
        if (savedPitch !== null && savedPitch !== undefined)
          setVoicePitch(savedPitch);
        if (savedRate !== null && savedRate !== undefined)
          setVoiceRate(savedRate);
        if (savedMuted !== null && savedMuted !== undefined)
          setVoiceMuted(savedMuted);
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

  useEffect(() => {
    isSpotifyConnected()
      .then(setSpotifyConnected)
      .catch((err) => console.error("Error consultando conexión de Spotify:", err));
    listConnectedGmailEmails()
      .then(setGmailAccounts)
      .catch((err) => console.error("Error consultando cuentas de Gmail:", err));
    listConnectedCalendarEmails()
      .then(setCalendarAccounts)
      .catch((err) => console.error("Error consultando cuentas de Calendar:", err));
  }, []);

  const handleConnectMcp = async (server: McpServerConfig) => {
    setMcpConnectingId(server.id);
    setMcpError(null);
    try {
      await connectMcpServer(server);
      setMcpConnectedIds((prev) => [...prev.filter((id) => id !== server.id), server.id]);
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpConnectingId(null);
    }
  };

  const handleDisconnectMcp = async (serverId: string) => {
    try {
      await disconnectMcpServer(serverId);
    } catch (err) {
      console.error("Error desconectando servidor MCP:", err);
    } finally {
      setMcpConnectedIds((prev) => prev.filter((id) => id !== serverId));
    }
  };

  const handleConnectSpotify = async () => {
    setSpotifyConnecting(true);
    setSpotifyError(null);
    try {
      await connectSpotify();
      setSpotifyConnected(true);
    } catch (err) {
      setSpotifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpotifyConnecting(false);
    }
  };

  const handleConnectGmail = async () => {
    setGmailConnecting(true);
    setGmailError(null);
    try {
      const email = await connectGmail();
      setGmailAccounts((prev) => [...prev.filter((e) => e !== email), email]);
    } catch (err) {
      console.error("Error conectando Gmail:", err);
      setGmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleDisconnectGmail = async (email: string) => {
    try {
      await disconnectGmailAccount(email);
      setGmailAccounts((prev) => prev.filter((e) => e !== email));
    } catch (err) {
      console.error("Error desconectando cuenta de Gmail:", err);
    }
  };

  const handleConnectCalendar = async () => {
    setCalendarConnecting(true);
    setCalendarError(null);
    try {
      const email = await connectCalendar();
      setCalendarAccounts((prev) => [...prev.filter((e) => e !== email), email]);
    } catch (err) {
      console.error("Error conectando Calendar:", err);
      setCalendarError(err instanceof Error ? err.message : String(err));
    } finally {
      setCalendarConnecting(false);
    }
  };

  const handleDisconnectCalendar = async (email: string) => {
    try {
      await disconnectCalendarAccount(email);
      setCalendarAccounts((prev) => prev.filter((e) => e !== email));
    } catch (err) {
      console.error("Error desconectando cuenta de Calendar:", err);
    }
  };

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

  const movement = useMovement({
    movementBonesRef,
    fingerBonesRef,
    boneRestRotationRef,
    chestBoneRef,
    headBoneRef,
  });

  const face = useFace({ vrmRef, gazeTargetObjectRef });

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
    setViseme: face.setViseme,
    resetVisemes: face.resetVisemes,
    isSpeakingRef: face.isSpeakingRef,
    mutedRef: voiceMutedRef,
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

  // Tarea 8.1: voz sostenida detectada mientras Miku habla (barge-in) o
  // durante la ventana de seguimiento tras su respuesta (sin repetir
  // "Hey Miku") -- en los dos casos, arrancar a escuchar es lo que hay
  // que hacer; si además está hablando, primero se la corta.
  function handleSpeechDuringPlayback() {
    if (speech.isSpeaking) {
      speech.stopSpeaking();
    }
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
  useAudioDevices();

  async function askMiku(userMessage: string, imageDataUrl?: string | null) {
    if (!isVoiceReady) return;
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
      const { personality, world, memories } = await loadMemoryContext();

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
      });

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
      const expression =
        expressionMatches.length > 0
          ? expressionMatches[expressionMatches.length - 1][1].toLowerCase()
          : currentMood;

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

      const parsedMovement = parseMovementMarker(reply);
      if (parsedMovement) {
        movement.scheduleMovement(parsedMovement, "response");
      }

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

      // El texto ya NO se muestra completo de una -- se revela en sync con
      // el audio (ver onReveal en useSpeech.ts), para inmersión. "Pensando..."
      // se queda puesto (ver JSX) hasta que el audio arranca de verdad, no
      // solo hasta que el LLM responde -- includes el tiempo de síntesis de
      // voz, que también tarda.
      let revealStarted = false;
      await speech.speak(reply, messagePitch, messageRate, expression, (partial) => {
        if (!revealStarted) {
          revealStarted = true;
          setIsThinking(false);
        }
        setLlmResponse(partial);
      });

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
  function onBeforeRender(now: number, delta: number, elapsed: number) {
    // Etapa 6: el balanceo de respiración de pecho/cabeza, los reverts
    // automáticos de quirks y las transiciones de huesos en curso ahora
    // los procesa useMovement. Kickear el quirk idle es fire-and-forget
    // (no toca nada síncronamente en este mismo frame), así que no
    // importa si corre antes o después de updateMovement().
    movement.updateMovement(now, delta, elapsed);

    // Etapa 9: el temporizador de silencio y el disparo del quirk idle
    // ahora los procesa useIdleQuirks.
    idleQuirks.checkIdleQuirk(now);

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

  function onAfterRender(renderer: THREE.WebGLRenderer, now: number) {
    if (
      selfImageCaptureAtRef.current !== null &&
      now >= selfImageCaptureAtRef.current
    ) {
      selfImageCaptureAtRef.current = null;
      try {
        lastSelfImageRef.current = renderer.domElement.toDataURL("image/png");
      } catch (err) {
        console.error("Error capturando imagen de sí misma:", err);
      }
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
              renderer.domElement.toDataURL("image/png"),
            ];
          } catch (err) {
            console.error("Error capturando imagen del quirk:", err);
          }
        } else {
          stillPending.push(captureAt);
        }
      }
      quirkImageCaptureAtRef.current = stillPending;
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
            className={voiceMuted ? "active" : ""}
            onClick={() => setVoiceMuted((v) => !v)}
            title={voiceMuted ? "Miku está silenciada" : "Silenciar la voz de Miku"}
          >
            {voiceMuted ? "🔇 Silenciada" : "🔊 Voz"}
          </button>
          {speech.isSpeaking && (
            <button
              onClick={speech.stopSpeaking}
              title="Cortar lo que está diciendo ahora"
            >
              ⏹ Detener
            </button>
          )}
          <button
            className={speechRecognition.listening ? "active" : ""}
            onClick={speechRecognition.toggleListening}
            disabled={!isVoiceReady}
            title={
              !isVoiceReady ? "Esperando al servidor de voz..." : undefined
            }
          >
            {speechRecognition.listening ? "Escuchando..." : "Mic"}
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
          <div className="oauth-connect-row">
            <button
              onClick={handleConnectSpotify}
              disabled={spotifyConnecting}
              className={spotifyConnected ? "active" : ""}
            >
              {spotifyConnecting
                ? "Conectando..."
                : spotifyConnected
                  ? "Spotify conectado"
                  : "Conectar Spotify"}
            </button>
            {spotifyError && (
              <span className="oauth-error" title={spotifyError}>
                Error al conectar Spotify
              </span>
            )}
          </div>
          <div className="oauth-connect-row gmail-accounts-row">
            {gmailAccounts.map((email) => (
              <span key={email} className="gmail-account-chip">
                {email}
                <button
                  onClick={() => handleDisconnectGmail(email)}
                  title="Desconectar esta cuenta"
                >
                  ✕
                </button>
              </span>
            ))}
            <button onClick={handleConnectGmail} disabled={gmailConnecting}>
              {gmailConnecting
                ? "Conectando..."
                : gmailAccounts.length > 0
                  ? "+ Otra cuenta de Gmail"
                  : "Conectar Gmail"}
            </button>
            {gmailError && (
              <span className="oauth-error" title={gmailError}>
                Error al conectar Gmail
              </span>
            )}
          </div>
          <div className="oauth-connect-row gmail-accounts-row">
            {calendarAccounts.map((email) => (
              <span key={email} className="gmail-account-chip">
                {email}
                <button
                  onClick={() => handleDisconnectCalendar(email)}
                  title="Desconectar esta cuenta"
                >
                  ✕
                </button>
              </span>
            ))}
            <button onClick={handleConnectCalendar} disabled={calendarConnecting}>
              {calendarConnecting
                ? "Conectando..."
                : calendarAccounts.length > 0
                  ? "+ Otra cuenta de Calendar"
                  : "Conectar Calendar"}
            </button>
            {calendarError && (
              <span className="oauth-error" title={calendarError}>
                Error al conectar Calendar
              </span>
            )}
          </div>
          <div className="oauth-connect-row gmail-accounts-row">
            {MCP_SERVERS.map((server) => {
              const connected = mcpConnectedIds.includes(server.id);
              return (
                <span key={server.id} className="gmail-account-chip">
                  {server.label}
                  <button
                    onClick={() =>
                      connected ? handleDisconnectMcp(server.id) : handleConnectMcp(server)
                    }
                    disabled={mcpConnectingId === server.id}
                    className={connected ? "active" : ""}
                    title={
                      connected
                        ? "Desconectar este servidor MCP"
                        : "Conectar (puede tardar la primera vez, descarga el paquete)"
                    }
                  >
                    {mcpConnectingId === server.id
                      ? "Conectando..."
                      : connected
                        ? "Conectado ✕"
                        : "Conectar"}
                  </button>
                </span>
              );
            })}
            {mcpError && (
              <span className="oauth-error" title={mcpError}>
                Error al conectar servidor MCP
              </span>
            )}
          </div>
        </div>
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
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}

export default App;
