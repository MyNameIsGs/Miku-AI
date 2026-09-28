import { useLayoutEffect, useRef } from "react";
import { describeTool } from "../lib/toolLabels";
import type { ToolEvent } from "../lib/openrouter";
import { IconCheck } from "./Icons";

// Caja de subtítulo, diseño v1 (docs/diseno-ui-v1/README.md §3): anclada
// justo encima del panel de controles, crece hacia arriba. Un estado a la
// vez:
// - listening: lo que vas diciendo (tramo final sin confirmar más tenue).
// - thinking: eco de tu mensaje + rastro de tools del ciclo actual.
// - speaking: su respuesta revelándose, la última palabra estilo karaoke.
// - reply: su última respuesta ya terminada (sin karaoke), hasta la próxima.

export type CaptionMode = "listening" | "thinking" | "speaking" | "reply";

type CaptionProps = {
  mode: CaptionMode;
  // listening
  transcript: string;
  confirmedWordCount: number;
  // thinking
  userEcho: string;
  tools: ToolEvent[];
  note: string | null;
  // speaking / reply
  text: string;
  // Con el panel de controles a la vista va encima de él; si no, baja.
  raised: boolean;
};

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

export function Caption(props: CaptionProps) {
  const { mode } = props;
  const boxRef = useRef<HTMLDivElement>(null);

  // Si el texto no entra, se queda mostrando lo más reciente (abajo).
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  });

  return (
    <div ref={boxRef} className={`caption caption-${mode} ${props.raised ? "" : "caption-low"}`} aria-live="polite">
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
          {(props.tools.length > 0 || props.note) && (
            <>
              {props.userEcho && <div className="caption-divider" />}
              <div className="caption-tools">
                {props.tools.map((tool) => {
                  const { category, text } = describeTool(tool.name, tool.status);
                  return (
                    <div key={tool.id} className="caption-tool">
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
                })}
                {props.note && <div className="caption-note">{props.note}</div>}
              </div>
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
      </div>
    </div>
  );
}
