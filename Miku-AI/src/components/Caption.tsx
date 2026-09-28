import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { describeTool } from "../lib/toolLabels";
import type { ToolEvent } from "../lib/openrouter";
import { IconAlert, IconCheck, IconChevronDown, IconReload } from "./Icons";

// Caja de subtítulo (diseño v1 §3 + ronda 2 §3.1-3.2): anclada justo encima
// del panel de controles, crece hacia arriba. Un estado a la vez:
// - listening: lo que vas diciendo (tramo final sin confirmar más tenue).
// - thinking: eco de tu mensaje + rastro de tools del ciclo actual, y el
//   aviso de reintento si el proveedor está saturado.
// - speaking: su respuesta revelándose, la última palabra estilo karaoke.
// - reply: su última respuesta ya terminada (sin karaoke), hasta la próxima.
// - error: el modelo no respondió.

export type CaptionMode = "listening" | "thinking" | "speaking" | "reply" | "error";

// Reintento por saturación del proveedor (429): cuál y cuándo.
export type RetryInfo = { attempt: number; max: number; retryAt: number };

type CaptionProps = {
  mode: CaptionMode;
  // listening
  transcript: string;
  confirmedWordCount: number;
  // thinking
  userEcho: string;
  tools: ToolEvent[];
  retry: RetryInfo | null;
  // speaking / reply / error
  text: string;
  // Con el panel de controles a la vista va encima de él; si no, baja.
  raised: boolean;
};

// Con muchas tools se ven las últimas; las anteriores se juntan.
const VISIBLE_TOOLS = 3;

function ListeningText({ transcript, confirmedWordCount }: { transcript: string; confirmedWordCount: number }) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return <p className="caption-transcript caption-pending">…</p>;
  const confirmed = words.slice(0, confirmedWordCount).join(" ");
  const pending = words.slice(confirmedWordCount).join(" ");
  return (
    <p className="caption-transcript">
      {confirmed}
      {confirmed && pending && " "}
      {pending && <span className="caption-pending">{pending}</span>}
    </p>
  );
}

function SpokenText({ text, karaoke }: { text: string; karaoke: boolean }) {
  if (!karaoke) return <p className="caption-spoken">{text}</p>;
  // Separa la última palabra revelada (con su puntuación pegada).
  const match = text.match(/^([\s\S]*?)(\S+)\s*$/);
  if (!match) return <p className="caption-spoken">{text}</p>;
  return (
    <p className="caption-spoken">
      {match[1]}
      <span className="caption-karaoke">{match[2]}</span>
    </p>
  );
}

function ToolRow({ tool }: { tool: ToolEvent }) {
  const { category, text } = describeTool(tool.name, tool.status);
  return (
    <div className="caption-tool">
      {tool.status === "done" ? (
        <span className="caption-tool-done">
          <IconCheck />
        </span>
      ) : (
        <span className="caption-tool-running" aria-label="En curso" />
      )}
      <span className="caption-tool-category">{category}</span>
      <span>{text}</span>
    </div>
  );
}

// Cuenta regresiva hasta el próximo reintento.
function RetryRow({ retry }: { retry: RetryInfo }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.ceil((retry.retryAt - now) / 1000));
  return (
    <div className="caption-retry" role="status">
      <span className="caption-retry-icon" aria-hidden="true">
        <IconReload size={16} />
      </span>
      <span className="caption-retry-label">
        SATURADO · REINTENTO {retry.attempt} DE {retry.max}
      </span>
      <span className="caption-retry-count">{seconds > 0 ? `en ${seconds} s` : "ahora"}</span>
    </div>
  );
}

function ToolTrail({ tools, retry }: { tools: ToolEvent[]; retry: RetryInfo | null }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, tools.length - VISIBLE_TOOLS);
  return (
    <div className="caption-tools">
      {hidden > 0 && (
        <button className="caption-more" onClick={() => setExpanded(true)}>
          {hidden === 1 ? "1 paso más, ya hecho" : `${hidden} pasos más, ya hechos`}
          <IconChevronDown size={14} />
        </button>
      )}
      {tools.slice(hidden).map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
      {retry && <RetryRow retry={retry} />}
    </div>
  );
}

export function Caption(props: CaptionProps) {
  const { mode } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  // Si el texto no entra: se queda mostrando lo más reciente (abajo) y
  // arriba se desvanece, para que se note que hay más.
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    const next = box.scrollHeight > box.clientHeight + 1;
    if (next !== overflowing) setOverflowing(next);
  });

  return (
    <div
      ref={boxRef}
      className={`caption caption-${mode} ${props.raised ? "" : "caption-low"} ${overflowing ? "is-overflowing" : ""}`}
      aria-live="polite"
    >
      {/* Al cambiar de estado, el contenido entra con un fundido (ronda 2 §4). */}
      <div key={mode} className="caption-content">
        {mode === "listening" && (
          <>
            <div className="caption-label">
              <span className="caption-label-you">TÚ</span>
              <span className="caption-label-note">· SE CORTA SOLO CUANDO TERMINAS DE HABLAR</span>
            </div>
            <ListeningText transcript={props.transcript} confirmedWordCount={props.confirmedWordCount} />
          </>
        )}

        {mode === "thinking" && (
          <>
            {props.userEcho && (
              <p className="caption-echo">
                <span className="caption-label-you">TÚ · </span>
                {props.userEcho}
              </p>
            )}
            {(props.tools.length > 0 || props.retry) && (
              <>
                {props.userEcho && <div className="caption-divider" />}
                <ToolTrail tools={props.tools} retry={props.retry} />
              </>
            )}
          </>
        )}

        {(mode === "speaking" || mode === "reply") && (
          <>
            <span className="caption-label caption-label-miku">MIKU</span>
            <SpokenText text={props.text} karaoke={mode === "speaking"} />
          </>
        )}

        {mode === "error" && (
          <>
            <span className="caption-label caption-label-error">
              <IconAlert size={14} />
              NO PUDE RESPONDER
            </span>
            <p className="caption-error-text">{props.text}</p>
          </>
        )}
      </div>
    </div>
  );
}
