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
import { useMemoryFiles } from "./hooks/useMemoryFiles";
import { useIdleQuirks } from "./hooks/useIdleQuirks";
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
import { fetchOpenRouterWithRetry } from "./lib/openrouter";
import {
  parseMovementMarker,
  parseHandGestureMarker,
  parseCreateHandGestureMarker,
  stripMarkers,
} from "./lib/markers";
import { describeSelfMovement, uint8ToBase64 } from "./lib/proprioception";

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
  const [showConfig, setShowConfig] = useState(false);
  const [hideResponseText, setHideResponseText] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const { isVoiceReady, handleCloseApp } = useVoiceServer();

  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const isVoiceSettingsLoaded = useRef(false);

  const transcriptRef = useRef<HTMLTextAreaElement>(null);

  const conversationHistoryRef = useRef<ChatMessage[]>([]);

  const movementBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const fingerBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const selfImageCaptureAtRef = useRef<number | null>(null);
  const lastSelfImageRef = useRef<string | null>(null);
  const pendingSelfDescriptionRef = useRef<string | null>(null);
  const boneRestRotationRef = useRef<
    Record<string, { x: number; y: number; z: number }>
  >({});


  useEffect(() => {
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const savedPitch = await store.get<number>("voicePitch");
        const savedRate = await store.get<number>("voiceRate");
        if (savedPitch !== null && savedPitch !== undefined)
          setVoicePitch(savedPitch);
        if (savedRate !== null && savedRate !== undefined)
          setVoiceRate(savedRate);
        isVoiceSettingsLoaded.current = true;
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

  const speechRecognition = useSpeechRecognition({
    isVoiceReady,
    setTranscript,
    setShowTextInput,
  });

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

  const movement = useMovement({
    movementBonesRef,
    fingerBonesRef,
    boneRestRotationRef,
    chestBoneRef,
    headBoneRef,
  });

  const face = useFace({ vrmRef, gazeTargetObjectRef });

  const idleQuirks = useIdleQuirks({
    boneTransitionsRef: movement.boneTransitionsRef,
    boneRestRotationRef,
    scheduleMovement: movement.scheduleMovement,
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

  const speech = useSpeech({
    setExpression: face.setExpression,
    setViseme: face.setViseme,
    resetVisemes: face.resetVisemes,
    isSpeakingRef: face.isSpeakingRef,
  });

  const memoryFiles = useMemoryFiles();

  async function askMiku(userMessage: string, imageDataUrl?: string | null) {
    if (!isVoiceReady) return;
    setIsThinking(true);
    idleQuirks.lastInteractionTimeRef.current = performance.now();
    try {
      const { personality, world, memories } = await loadMemoryContext();

      const customGestureNames = Object.keys(
        movement.customHandGesturesRef.current,
      );
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

      await memoryFiles.processMemoryMarkers(reply);

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
        movement.scheduleMovement(parsedMovement, "response");
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
        await movement.saveCustomHandGesture(
          parsedCreateGesture.name,
          parsedCreateGesture.curls,
          parsedCreateGesture.animated,
        );
      }

      const parsedHandGesture = parseHandGestureMarker(reply);
      console.log("[DEBUG-MOV] Gesto de mano parseado:", parsedHandGesture);
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

      conversationHistoryRef.current.push(
        { role: "user", content: userContent },
        { role: "assistant", content: reply },
      );
      const maxMessages = MAX_HISTORY_TURNS * 2;
      if (conversationHistoryRef.current.length > maxMessages) {
        conversationHistoryRef.current =
          conversationHistoryRef.current.slice(-maxMessages);
      }

      setLlmResponse(reply);

      await speech.speak(reply, messagePitch, messageRate, expression);

      memoryFiles.consolidateMemoryIfNeeded();
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
        console.log(
          "[DEBUG-SELF] Data URL capturada (pégala en una pestaña nueva del navegador):",
          lastSelfImageRef.current,
        );
      } catch (err) {
        console.error("Error capturando imagen de sí misma:", err);
      }
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
