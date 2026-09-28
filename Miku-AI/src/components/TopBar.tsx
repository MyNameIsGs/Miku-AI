import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Mood, getCachedMood, getCurrentMood, onMoodChange } from "../lib/mood";
import type { MusicCategory } from "../lib/musicStore";
import {
  IconApps,
  IconBroadcast,
  IconDoNotDisturb,
  IconMoon,
  IconNote,
  IconCamera,
  IconCheck,
  IconClose,
  IconConfig,
  IconLock,
  IconMemory,
  IconVolume,
  IconVolumeMuted,
} from "./Icons";

// Barra superior del diseño v1 (docs/diseno-ui-v1/README.md §3): marca,
// estado, ánimo y botones. Toda la barra sirve para arrastrar la ventana
// (los handlers vienen de App.tsx, igual que antes). Micrófono, detener y
// ocultar texto viven en el panel de controles de abajo; lo de la cámara,
// que la maqueta no traía, va en su propio menú.

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

const STATE_LABEL: Record<Exclude<AvatarState, "speaking">, string> = {
  idle: "EN ESPERA",
  listening: "ESCUCHANDO",
  thinking: "PENSANDO",
};

// Estados de presencia (Presencia.dc.html). Reemplazan "EN ESPERA" y la
// píldora de ánimo mientras Miku está en reposo; si escucha o piensa, manda
// eso. El modo juego no aparece: ahí la ventana ya está oculta.
export type Presence =
  | { kind: "normal" }
  | { kind: "live" }
  | { kind: "sleeping" }
  | { kind: "dancing"; category: MusicCategory | null }
  | { kind: "quiet"; until: string };

const DANCE_LABEL: Record<MusicCategory, string> = {
  sin_golpe: "SIN GOLPE",
  ritmo_tranquilo: "TRANQUILO",
  ritmo_movido: "MOVIDO",
};

// Dormir y bailar viven en refs: la barra los vuelve a leer cada tanto
// mientras está a la vista (solo aparece con el mouse encima).
const PRESENCE_REFRESH_MS = 500;

function usePresence(getPresence: () => Presence): Presence {
  const getRef = useRef(getPresence);
  getRef.current = getPresence;
  const [presence, setPresence] = useState<Presence>(() => getPresence());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = getRef.current();
      setPresence((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, PRESENCE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return presence;
}

const MOOD_LABEL: Record<Mood, string> = {
  happy: "CONTENTA",
  angry: "ENOJADA",
  sad: "TRISTE",
  relaxed: "TRANQUILA",
  neutral: "NEUTRAL",
};

// El ánimo decae solo con el tiempo sin avisar (ver mood.ts): se relee
// cada tanto además de escuchar los cambios.
const MOOD_REFRESH_MS = 60_000;

function useMood(): Mood {
  const [mood, setMoodState] = useState<Mood>(getCachedMood());
  useEffect(() => {
    getCurrentMood()
      .then(setMoodState)
      .catch(() => {});
    const unsubscribe = onMoodChange(setMoodState);
    const id = window.setInterval(() => setMoodState(getCachedMood()), MOOD_REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(id);
    };
  }, []);
  return mood;
}

type TopBarProps = {
  avatarState: AvatarState;
  getPresence: () => Presence;
  onMouseDown: (e: ReactMouseEvent) => void;
  onMouseMove: (e: ReactMouseEvent) => void;
  onPressEnd: () => void;

  voiceMuted: boolean;
  onToggleVoiceMuted: () => void;

  showAppLauncher: boolean;
  onToggleAppLauncher: () => void;
  showMemoryPanel: boolean;
  onToggleMemoryPanel: () => void;
  showConfig: boolean;
  onToggleConfig: () => void;

  freeCamera: boolean;
  onToggleFreeCamera: () => void;
  onSaveCamera: () => Promise<void>;
  clickThrough: boolean;
  onToggleClickThrough: () => void;

  onClose: () => void;
};

export function TopBar(props: TopBarProps) {
  const mood = useMood();
  const presence = usePresence(props.getPresence);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const [cameraSaved, setCameraSaved] = useState(false);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // El menú se alinea con el borde izquierdo de su botón, relativo al
  // contenedor donde se dibuja. Se recalcula en cada render mientras está
  // abierto: si cambia el estado, la barra se reacomoda.
  useLayoutEffect(() => {
    if (!cameraMenuOpen) return;
    const button = cameraButtonRef.current;
    const container = menuRef.current?.offsetParent;
    if (!button || !container) return;
    const left = button.getBoundingClientRect().left - container.getBoundingClientRect().left;
    if (left !== menuLeft) setMenuLeft(left);
  });

  // Clic fuera del menú (o Escape) lo cierra.
  useEffect(() => {
    if (!cameraMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || cameraButtonRef.current?.contains(target)) return;
      setCameraMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCameraMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [cameraMenuOpen]);

  useEffect(() => {
    if (!cameraSaved) return;
    const id = window.setTimeout(() => setCameraSaved(false), 1500);
    return () => clearTimeout(id);
  }, [cameraSaved]);

  const { avatarState } = props;
  // En reposo manda la presencia; escuchando o pensando, ese estado.
  const shownPresence: Presence = avatarState === "idle" ? presence : { kind: "normal" };

  return (
    <>
      <header
        className={`toolbar toolbar-presence-${shownPresence.kind}`}
        onMouseDown={props.onMouseDown}
        onMouseMove={props.onMouseMove}
        onMouseUp={props.onPressEnd}
        onMouseLeave={props.onPressEnd}
      >
        <div className="toolbar-left">
          <div className="toolbar-brand">
            <span className="toolbar-wordmark">MIKU</span>
            <span className="toolbar-channel">CH·01</span>
          </div>
          {/* Hablando: sin estado en la barra (la insignia se sacó por
              redundante: ya se ve la boca y el texto). */}
          {avatarState !== "speaking" && <div className="toolbar-divider" />}
          {avatarState !== "speaking" && shownPresence.kind === "normal" && (
            <div className={`toolbar-state toolbar-state-${avatarState}`}>
              <span className="toolbar-led" />
              <span>{STATE_LABEL[avatarState]}</span>
            </div>
          )}
          {shownPresence.kind === "live" && (
            <div className="toolbar-live">
              <IconBroadcast />
              <span>EN VIVO</span>
            </div>
          )}
          {shownPresence.kind === "sleeping" && (
            <div className="toolbar-state">
              <IconMoon />
              <span>DURMIENDO</span>
            </div>
          )}
          {shownPresence.kind === "dancing" && (
            <>
              <div className="toolbar-state toolbar-state-dancing">
                <IconNote />
                <span>BAILANDO</span>
                {shownPresence.category && (
                  <span className="toolbar-state-detail">· {DANCE_LABEL[shownPresence.category]}</span>
                )}
              </div>
              <div className="toolbar-dance-bars" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} />
                ))}
              </div>
            </>
          )}
          {shownPresence.kind === "quiet" && (
            <div className="toolbar-state">
              <IconDoNotDisturb />
              <span>NO MOLESTAR</span>
              <span className="toolbar-state-detail">· HASTA {shownPresence.until}</span>
            </div>
          )}
          {/* El ánimo va con el estado normal, como en la maqueta. */}
          {shownPresence.kind === "normal" && (
            <div className="toolbar-mood" title="Su ánimo de base ahora">
              <span>ÁNIMO</span>
              <span className="toolbar-mood-value">{MOOD_LABEL[mood]}</span>
            </div>
          )}
        </div>

        <nav className="toolbar-right" aria-label="Controles de la ventana">
          <button
            ref={cameraButtonRef}
            className={`toolbar-btn ${cameraMenuOpen || props.freeCamera ? "active" : ""}`}
            onClick={() => setCameraMenuOpen((open) => !open)}
            aria-label="Cámara"
            aria-haspopup="menu"
            aria-expanded={cameraMenuOpen}
            title="Cámara"
          >
            <IconCamera />
          </button>
          <button
            className={`toolbar-btn ${props.clickThrough ? "active" : ""}`}
            onClick={props.onToggleClickThrough}
            aria-label="Bloquear a Miku"
            aria-pressed={props.clickThrough}
            title={
              props.clickThrough
                ? "Miku está bloqueada: los clics pasan a lo que hay detrás (clic o Ctrl+Shift+M para desbloquear)"
                : "Bloquear a Miku: los clics pasan a lo que hay detrás (Ctrl+Shift+M)"
            }
          >
            <IconLock />
          </button>
          <button
            className={`toolbar-btn ${props.showAppLauncher ? "active" : ""}`}
            onClick={props.onToggleAppLauncher}
            aria-label="Apps y carpetas"
            aria-pressed={props.showAppLauncher}
            title="Apps y carpetas"
          >
            <IconApps />
          </button>
          <button
            className={`toolbar-btn ${props.showMemoryPanel ? "active" : ""}`}
            onClick={props.onToggleMemoryPanel}
            aria-label="Memoria"
            aria-pressed={props.showMemoryPanel}
            title="Memoria"
          >
            <IconMemory />
          </button>
          <button
            className={`toolbar-btn ${props.showConfig ? "active" : ""}`}
            onClick={props.onToggleConfig}
            aria-label="Configuración"
            aria-pressed={props.showConfig}
            title="Configuración"
          >
            <IconConfig />
          </button>
          <button
            className={`toolbar-btn ${props.voiceMuted ? "muted" : ""}`}
            onClick={props.onToggleVoiceMuted}
            aria-label={props.voiceMuted ? "Volver a oír su voz" : "Silenciar voz"}
            aria-pressed={props.voiceMuted}
            title={props.voiceMuted ? "Miku está silenciada (clic para volver a oírla)" : "Silenciar la voz de Miku"}
          >
            {props.voiceMuted ? <IconVolumeMuted /> : <IconVolume />}
          </button>
          <div className="toolbar-divider toolbar-divider-right" />
          <button className="toolbar-btn" onClick={props.onClose} aria-label="Cerrar" title="Cerrar a Miku">
            <IconClose />
          </button>
        </nav>
      </header>

      {/* Fuera del <header>: la barra tiene overflow-x y recortaría el menú. */}
      {cameraMenuOpen && (
        <div ref={menuRef} className="toolbar-menu" role="menu" aria-label="Cámara" style={{ left: menuLeft }}>
          <div className="toolbar-menu-heading">CÁMARA</div>
          <button
            role="menuitemcheckbox"
            aria-checked={props.freeCamera}
            className="toolbar-menu-item"
            onClick={props.onToggleFreeCamera}
          >
            <span className="toolbar-menu-check">{props.freeCamera && <IconCheck />}</span>
            Cámara libre
            <span className="toolbar-menu-hint">mover la vista con el mouse</span>
          </button>
          <button
            role="menuitem"
            className="toolbar-menu-item"
            onClick={() => props.onSaveCamera().then(() => setCameraSaved(true))}
          >
            <span className="toolbar-menu-check">{cameraSaved && <IconCheck />}</span>
            {cameraSaved ? "Posición guardada" : "Guardar posición de la cámara"}
          </button>
        </div>
      )}
    </>
  );
}
