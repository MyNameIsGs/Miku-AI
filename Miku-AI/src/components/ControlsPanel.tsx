import { useEffect, useRef } from "react";
import type { ClipboardEvent, RefObject } from "react";
import type { AvatarState } from "./TopBar";
import type { MotionPhase } from "../hooks/usePresenceMotion";
import { IconAttach, IconClose, IconEye, IconEyeOff, IconMic, IconSend, IconStop } from "./Icons";

// Panel de controles de abajo, diseño v1 (docs/diseno-ui-v1/README.md §3):
// tira de teclas de piano + adjuntar, ocultar texto, campo de texto y el
// botón principal (micrófono / enviar / detener). Siempre visible.

// --- Tira de teclas -------------------------------------------------------

const KEY_COUNT = 36;
// Patrón por octava: B N B N B B N B N B N B.
const OCTAVE_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
const IS_BLACK = Array.from({ length: KEY_COUNT }, (_, i) => OCTAVE_BLACK[i % 12]);

const KEY_OFF_WHITE = "rgba(234, 244, 243, 0.12)";
const KEY_OFF_BLACK = "rgba(157, 185, 182, 0.22)";
const KEY_TEAL = "#39C5BB";
const KEY_TEAL_DIM = "#2A8F88";
const KEY_TEAL_NEIGHBOR = "rgba(57, 197, 187, 0.45)";
const KEY_PINK = "#F0508F";
const KEY_PINK_DIM = "#B83A6C";

// El RMS de un micrófono hablando normal anda por 0.02-0.15: se amplifica
// para que la voz llene buena parte de la fila.
const MIC_GAIN = 7;
// Suavizado por cuadro: sube rápido, baja despacio (como un vúmetro).
const ATTACK = 0.5;
const RELEASE = 0.12;
// Pensando: cuántos cuadros tarda el barrido en avanzar una tecla.
const SWEEP_KEYS_PER_SECOND = 22;

type KeyMode = "off" | "listening" | "thinking" | "speaking";

function PianoStrip({
  mode,
  getMicLevel,
  speechLevelRef,
}: {
  mode: KeyMode;
  getMicLevel: () => number;
  speechLevelRef: RefObject<number>;
}) {
  const keysRef = useRef<(HTMLSpanElement | null)[]>([]);
  // Se leen en el bucle de cuadros sin reiniciarlo en cada render.
  const getMicLevelRef = useRef(getMicLevel);
  getMicLevelRef.current = getMicLevel;

  useEffect(() => {
    const keys = keysRef.current;
    const paint = (i: number, color: string | null) => {
      const el = keys[i];
      if (!el) return;
      el.style.background = color ?? (IS_BLACK[i] ? KEY_OFF_BLACK : KEY_OFF_WHITE);
    };

    if (mode === "off") {
      for (let i = 0; i < KEY_COUNT; i++) paint(i, null);
      return;
    }

    let frame = 0;
    let smoothed = 0;
    // El nivel del audio se sigue mostrando igual (es información).
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now();

    const tick = () => {
      if (mode === "thinking" && reducedMotion) {
        // Reducir movimiento: sin barrido, tres teclas fijas en el centro.
        const mid = Math.floor(KEY_COUNT / 2);
        for (let i = 0; i < KEY_COUNT; i++) paint(i, Math.abs(i - mid) <= 1 ? KEY_TEAL : null);
      } else if (mode === "thinking") {
        // Una tecla turquesa con dos vecinas al 45 % que recorre la fila
        // de ida y vuelta.
        const steps = ((performance.now() - start) / 1000) * SWEEP_KEYS_PER_SECOND;
        const period = (KEY_COUNT - 1) * 2;
        const pos = Math.round(steps % period);
        const at = pos < KEY_COUNT ? pos : period - pos;
        for (let i = 0; i < KEY_COUNT; i++) {
          paint(i, i === at ? KEY_TEAL : Math.abs(i - at) === 1 ? KEY_TEAL_NEIGHBOR : null);
        }
      } else {
        const raw =
          mode === "listening"
            ? Math.min(1, getMicLevelRef.current() * MIC_GAIN)
            : (speechLevelRef.current ?? 0) * 0.85;
        smoothed += (raw - smoothed) * (raw > smoothed ? ATTACK : RELEASE);
        const lit = Math.round(smoothed * KEY_COUNT);
        const [white, black] = mode === "listening" ? [KEY_TEAL, KEY_TEAL_DIM] : [KEY_PINK, KEY_PINK_DIM];
        for (let i = 0; i < KEY_COUNT; i++) {
          paint(i, i < lit ? (IS_BLACK[i] ? black : white) : null);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [mode, speechLevelRef]);

  return (
    <div className="piano-strip" aria-hidden="true">
      {IS_BLACK.map((black, i) => (
        <span
          key={i}
          ref={(el) => {
            keysRef.current[i] = el;
          }}
          className={`piano-key ${black ? "black" : "white"}`}
        />
      ))}
    </div>
  );
}

// --- Panel ---------------------------------------------------------------

type ControlsPanelProps = {
  // Fase de entrada/salida (ver usePresenceMotion).
  motion?: MotionPhase;
  avatarState: AvatarState;
  isVoiceReady: boolean;
  isThinking: boolean;
  listening: boolean;
  transcribing: boolean;
  onToggleListening: () => void;
  onStopSpeaking: () => void;
  onCancelThinking: () => void;
  getMicLevel: () => number;
  speechLevelRef: RefObject<number>;

  transcript: string;
  setTranscript: (text: string) => void;
  transcriptRef: RefObject<HTMLTextAreaElement | null>;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  attachedImage: string | null;
  onRemoveImage: () => void;
  onPickImage: () => void;

  hideResponseText: boolean;
  onToggleHideResponseText: () => void;
  // Si algo del panel tiene el foco (escribiendo): App lo mantiene visible
  // aunque el mouse salga de la ventana.
  onFocusChange: (focused: boolean) => void;
};

export function ControlsPanel(props: ControlsPanelProps) {
  const { avatarState, listening } = props;
  const hasDraft = props.transcript.trim().length > 0 || !!props.attachedImage;

  // Botón principal: hablando → detener; pensando → cancelar; escuchando
  // → micrófono rosa; con algo escrito → enviar; si no → micrófono.
  const main: "stop" | "cancel" | "listening" | "send" | "mic" =
    avatarState === "speaking"
      ? "stop"
      : avatarState === "thinking" && props.isThinking
        ? "cancel"
        : listening
          ? "listening"
          : hasDraft
            ? "send"
            : "mic";

  const keyMode: KeyMode =
    avatarState === "listening" && listening
      ? "listening"
      : avatarState === "speaking"
        ? "speaking"
        : avatarState === "thinking"
          ? "thinking"
          : "off";

  const placeholder = !props.isVoiceReady
    ? "Iniciando sistema de voz..."
    : listening
      ? "Escuchando…"
      : "Escribe, pega una imagen o di «Hey Miku»";

  return (
    <section
      className="controls-panel"
      data-motion={props.motion}
      aria-label="Hablar con Miku"
      onFocus={() => props.onFocusChange(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onFocusChange(false);
      }}
    >
      <PianoStrip mode={keyMode} getMicLevel={props.getMicLevel} speechLevelRef={props.speechLevelRef} />
      <div className="controls-row">
        <button
          className="controls-btn"
          onClick={props.onPickImage}
          disabled={!props.isVoiceReady}
          aria-label="Adjuntar imagen o archivo"
          title="Adjuntar imagen o archivo"
        >
          <IconAttach />
        </button>
        <button
          className={`controls-btn ${props.hideResponseText ? "active" : ""}`}
          onClick={props.onToggleHideResponseText}
          aria-label={props.hideResponseText ? "Mostrar el texto" : "Ocultar el texto"}
          aria-pressed={props.hideResponseText}
          title={
            props.hideResponseText
              ? "El texto de respuesta está oculto (clic para mostrarlo)"
              : "Ocultar el texto de respuesta (para sacar capturas limpias)"
          }
        >
          {props.hideResponseText ? <IconEyeOff /> : <IconEye />}
        </button>

        <div className="controls-input">
          {props.attachedImage && (
            <div className="controls-attachment">
              <img src={props.attachedImage} alt="Imagen adjunta" />
              <button onClick={props.onRemoveImage} aria-label="Quitar imagen" title="Quitar imagen">
                <IconClose size={12} />
              </button>
            </div>
          )}
          <label htmlFor="miku-message" className="visually-hidden">
            Mensaje para Miku
          </label>
          <textarea
            id="miku-message"
            ref={props.transcriptRef}
            value={props.transcript}
            disabled={!props.isVoiceReady || listening}
            placeholder={placeholder}
            rows={1}
            onChange={(e) => props.setTranscript(e.target.value)}
            onPaste={props.onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                props.onSend();
              }
            }}
          />
        </div>

        {main === "cancel" ? (
          <button
            className="controls-main stop"
            onClick={props.onCancelThinking}
            aria-label="Cancelar respuesta"
            title="Cancelar: que no responda a esto"
          >
            <IconClose size={20} strokeWidth={2.2} />
          </button>
        ) : main === "stop" ? (
          <button className="controls-main stop" onClick={props.onStopSpeaking} aria-label="Detener" title="Cortar lo que está diciendo ahora">
            <IconStop size={20} />
          </button>
        ) : main === "send" ? (
          <button
            className="controls-main"
            onClick={props.onSend}
            disabled={!props.isVoiceReady || props.isThinking}
            aria-label="Enviar"
            title="Enviar (Enter)"
          >
            <IconSend />
          </button>
        ) : (
          <button
            className={`controls-main ${main === "listening" ? "listening" : ""}`}
            onClick={props.onToggleListening}
            disabled={!props.isVoiceReady || props.transcribing}
            aria-label="Hablar"
            aria-pressed={main === "listening"}
            title={
              !props.isVoiceReady
                ? "Esperando al servidor de voz..."
                : main === "listening"
                  ? "Escuchando... (clic para terminar)"
                  : "Hablarle a Miku (micrófono)"
            }
          >
            <IconMic />
          </button>
        )}
      </div>
    </section>
  );
}
