import { Dispatch, RefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RetryInfo } from "../components/Caption";
import { ChatContent, ChatContentPart, ChatMessage, ParsedMovement } from "../types";
import { MAX_HISTORY_TURNS, OPENROUTER_MODEL, POSE_HOLD_MAX_MS } from "../config/constants";
import { runToolCallingCycle, ToolEvent } from "../lib/openrouter";
import { loadMemoryContext } from "../lib/memory";
import { retrieveKnowledge, takeKnowledgeEditFeedback } from "../lib/knowledge";
import { getActivePendientes, loadPendientes } from "../lib/pendientes";
import { describeCurrentMood, getCurrentMood, getMoodLevel, pushMood } from "../lib/mood";
import { beginReply, endReply, noteInterruption, noteRevealProgress } from "../lib/talkSignals";
import { saveChatHistory, toApiMessages } from "../lib/chatHistory";
import { localIsoDate, spanishDateLabel } from "../lib/dates";
import { isStreamModeActive } from "../lib/streamMode";
import { describeGameContext } from "../lib/gameSessions";
import { recordLatency } from "../lib/latencyLog";
import { describeSelfMovement } from "../lib/proprioception";
import { processRedesignMarkers } from "../lib/touchReactionsStore";
import { consumeTouchSummary } from "../lib/touchLog";
import { parseFaceMarker } from "../lib/faceParts";
import {
  parseCreateHandGestureMarker,
  parseHandGestureMarker,
  parseMoodPush,
  parseMovementMarker,
  parseVoiceMarkers,
  stripMarkers,
} from "../lib/markers";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import type { useSleep } from "../hooks/useSleep";
import type { useIdleQuirks } from "../hooks/useIdleQuirks";
import type { useBriefing } from "../hooks/useBriefing";
import type { useMovement } from "../hooks/useMovement";
import type { useSpeech } from "../hooks/useSpeech";
import type { useVoiceActivityDetection } from "../hooks/useVoiceActivityDetection";
import type { useMemoryFiles } from "../hooks/useMemoryFiles";

// B6, segundo corte (2026-09-28): la respuesta de Miku a un mensaje (texto,
// voz, imagen o archivo soltado), fuera de App.tsx. Lo que usa de App llega
// en `deps`, con los mismos nombres de antes; App la vuelve a crear en cada
// render (como antes la función), así que siempre ve el estado actual.

// Mensaje que se manda cuando solo hay una imagen, sin texto.
export const IMAGE_ONLY_MESSAGE = "(imagen adjunta, sin mensaje de texto)";

export type AskMikuDeps = {
  isVoiceReady: boolean;
  voicePitch: number;
  voiceRate: number;
  askAbortRef: RefObject<AbortController | null>;
  conversationHistoryRef: RefObject<ChatMessage[][]>;
  pendingSelfDescriptionRef: RefObject<string | null>;
  resumedNoteRef: RefObject<string | null>;
  voiceMutedRef: RefObject<boolean>;
  failedMessageRef: RefObject<{ message: string; image: string | null } | null>;
  setUserEcho: Dispatch<SetStateAction<string>>;
  setToolTrail: Dispatch<SetStateAction<ToolEvent[]>>;
  setRetryInfo: Dispatch<SetStateAction<RetryInfo | null>>;
  setReplyError: Dispatch<SetStateAction<string | null>>;
  setIsThinking: Dispatch<SetStateAction<boolean>>;
  setReplyRevealing: Dispatch<SetStateAction<boolean>>;
  setLlmResponse: Dispatch<SetStateAction<string>>;
  setTranscript: Dispatch<SetStateAction<string>>;
  setAttachedImage: Dispatch<SetStateAction<string | null>>;
  resolveReach: (text: string, base: ParsedMovement | null) => ParsedMovement | null;
  captureSelfImageAfterDelay: (delayMs: number) => void;
  sleep: ReturnType<typeof useSleep>;
  idleQuirks: ReturnType<typeof useIdleQuirks>;
  briefing: ReturnType<typeof useBriefing>;
  movement: ReturnType<typeof useMovement>;
  speech: ReturnType<typeof useSpeech>;
  vad: ReturnType<typeof useVoiceActivityDetection>;
  memoryFiles: ReturnType<typeof useMemoryFiles>;
};

export function createAskMiku(deps: AskMikuDeps) {
  return async function askMiku(userMessage: string, imageDataUrl?: string | null) {
    const {
      isVoiceReady,
      voicePitch,
      voiceRate,
      askAbortRef,
      conversationHistoryRef,
      pendingSelfDescriptionRef,
      resumedNoteRef,
      voiceMutedRef,
      failedMessageRef,
      setUserEcho,
      setToolTrail,
      setRetryInfo,
      setReplyError,
      setIsThinking,
      setReplyRevealing,
      setLlmResponse,
      setTranscript,
      setAttachedImage,
      resolveReach,
      captureSelfImageAfterDelay,
      sleep,
      idleQuirks,
      briefing,
      movement,
      speech,
      vad,
      memoryFiles,
    } = deps;
    if (!isVoiceReady) return;
    // B4: tiempos de cada tramo (ver lib/latencyLog.ts).
    const marks = { start: performance.now(), llmStart: 0, llmEnd: 0, speakStart: 0, audioStart: 0 };
    // A6: antes de cualquier await: si ella sigue hablando, queda en el
    // registro local que él le escribió encima (a ella no se le dice).
    noteInterruption("mensaje");
    sleep.wakeUp("le hablaron");
    askAbortRef.current?.abort();
    const abort = new AbortController();
    askAbortRef.current = abort;
    setUserEcho(userMessage);
    setToolTrail([]);
    setRetryInfo(null);
    setReplyError(null);
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
      const todayLabel = spanishDateLabel(now);
      const todayIso = localIsoDate(now);
      const activePendientes = getActivePendientes(await loadPendientes());
      // Tarea 8.10: humor persistido entre conversaciones -- default de
      // EXPRESION si esta respuesta no trae una expresión puntual propia
      // (ver más abajo, donde se usa en vez del "neutral" fijo de antes).
      const currentMood = await getCurrentMood();
      // Con qué expresión habla si no pide una: la de su ánimo solo cuando
      // ya le llega a la cara (un poco contenta no cambia la cara).
      const restingExpression = getMoodLevel() === "normal" || getMoodLevel() === "muy" ? currentMood : "neutral";
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
        currentMood: describeCurrentMood(),
        activeWindow,
        streamModeActive: isStreamModeActive(),
        relevantKnowledge,
        recentTouches: consumeTouchSummary(),
        gameContext: await describeGameContext(),
        knowledgeEditFeedback: takeKnowledgeEditFeedback(),
        resumedNote: resumedNoteRef.current,
      });
      resumedNoteRef.current = null;

      const historyMessages = toApiMessages(conversationHistoryRef.current);

      const contentParts: ChatContentPart[] = [
        { type: "text", text: userMessage },
      ];
      if (imageDataUrl) {
        contentParts.push({
          type: "image_url",
          image_url: { url: imageDataUrl },
        });
      }
      const userContent: ChatContent =
        contentParts.length > 1 ? contentParts : userMessage;

      marks.llmStart = performance.now();
      const toolCycle = await runToolCallingCycle(
        OPENROUTER_MODEL,
        [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          { role: "user", content: userContent },
        ],
        (attempt, max, delay) => {
          setRetryInfo({ attempt, max, retryAt: Date.now() + delay });
        },
        (event) => {
          // Si hubo reintento, ya respondió: el aviso sobra.
          setRetryInfo(null);
          setToolTrail((trail) =>
            trail.some((t) => t.id === event.id)
              ? trail.map((t) => (t.id === event.id ? event : t))
              : [...trail, event],
          );
        },
        abort.signal,
      );

      marks.llmEnd = performance.now();
      // Cancelada justo cuando llegaba la respuesta: se descarta entera.
      if (abort.signal.aborted) return;
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
          : restingExpression);

      // Tarea 8.10: si esta respuesta cambió su humor de base, se
      // persiste para las próximas conversaciones -- fire-and-forget, no
      // hace falta esperar para seguir con el resto de la respuesta.
      // Modelo nuevo (moodModel.ts): empuja el ánimo, con lo que ella dijo
      // de cuánto la afecta y cuánto le dura.
      const moodPush = parseMoodPush(reply);
      if (moodPush) {
        pushMood(moodPush.mood, "charla", { amount: moodPush.amount, duration: moodPush.duration }).catch((err) =>
          console.error("Error guardando el estado de ánimo:", err),
        );
      }

      // [VOZ_PITCH], [VOZ_RATE] y [VOZ_VOLUMEN] de esta respuesta.
      const { pitch: messagePitch, rate: messageRate, volume: messageVolume } = parseVoiceMarkers(reply, voicePitch, voiceRate);

      const explicitMovement = parseMovementMarker(reply);
      // [LLEVAR_MANO]: se resuelve antes de programar nada (sobre la pose
      // final) y se programa aparte; para la foto y la descripción de su
      // propio cuerpo cuenta junto con [MOVIMIENTO].
      const reachMovement = resolveReach(reply, explicitMovement);
      if (explicitMovement) {
        movement.scheduleMovement(explicitMovement, "response", POSE_HOLD_MAX_MS, true);
      }
      if (reachMovement) {
        movement.scheduleMovement(reachMovement, "response", POSE_HOLD_MAX_MS, true);
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
            POSE_HOLD_MAX_MS,
            true,
          );
        }
        if (parsedHandGesture.right) {
          movement.scheduleHandGesture(
            "right",
            parsedHandGesture.right,
            parsedHandGesture.durationMs,
            "response",
            POSE_HOLD_MAX_MS,
            true,
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
      marks.speakStart = performance.now();
      await speech.speak(reply, messagePitch, messageRate, expression, (partial) => {
        if (!revealStarted) {
          revealStarted = true;
          setIsThinking(false);
          setReplyRevealing(true);
          marks.audioStart = performance.now();
          recordLatency(marks, voiceMutedRef.current);
        }
        noteRevealProgress(liveReply, partial);
        setLlmResponse(partial);
      }, messageVolume);
      setReplyRevealing(false);
      endReply(liveReply);

      // Tarea 8.1: solo tras una respuesta conversacional real (no un
      // quirk idle, ni el resumen agrupado, ni un recordatorio) se abre la
      // ventana de seguimiento -- seguir la conversación sin repetir
      // "Hey Miku" tiene sentido acá, no después de un aviso de fondo.
      vad.armFollowUpWindow();

      memoryFiles.consolidateMemoryIfNeeded();
    } catch (err) {
      if (abort.signal.aborted) {
        console.log("[Charla] Cancelada mientras pensaba");
        return;
      }
      console.error("Error al consultar el LLM:", err);
      setLlmResponse("");
      // El mensaje vuelve al campo para no perderlo (si no escribiste otra
      // cosa mientras tanto).
      failedMessageRef.current = { message: userMessage, image: imageDataUrl ?? null };
      if (userMessage !== IMAGE_ONLY_MESSAGE) setTranscript((current) => (current.trim() ? current : userMessage));
      if (imageDataUrl) setAttachedImage((current) => current ?? imageDataUrl);
      setReplyError("El modelo no contestó. Tu mensaje sigue ahí: puedes volver a enviarlo.");
    } finally {
      // Si se canceló (o ya empezó otra charla), el estado lo maneja quien
      // canceló o la charla nueva.
      if (askAbortRef.current === abort) {
        askAbortRef.current = null;
        setIsThinking(false);
        setReplyRevealing(false);
      }
    }
  };
}
