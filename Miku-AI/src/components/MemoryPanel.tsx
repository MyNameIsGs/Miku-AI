import { useEffect, useState } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import {
  deleteKnowledgeEntry,
  KNOWLEDGE_TOP_K,
  loadKnowledgeEntries,
  updateKnowledgeEntry,
} from "../lib/knowledge";
import { matchesQuery } from "../lib/textSearch";
import { describeFace } from "../lib/faceParts";
import { FaceKey, listMoodFaces, MOODS_WITH_FACE, requestMoodFaceRedesign } from "../lib/moodFaceStore";
import {
  deleteDesignedReaction,
  DesignedTouchReaction,
  listDesignedReactions,
  TouchReactionKey,
} from "../lib/touchReactionsStore";
import { IconClose, IconMemory, IconSearch } from "./Icons";
import { ConfirmDialog } from "./ConfirmDialog";
import type { MotionPhase } from "../hooks/usePresenceMotion";

type MemoryPanelProps = {
  onClose: () => void;
  // Fase de entrada/salida (ver usePresenceMotion).
  motion?: MotionPhase;
};

type Tab = "conocimiento" | "memorias" | "personalidad" | "diario" | "tacto" | "caras";

// Orden de la maqueta (docs/diseno-ui-v1/Memoria.dc.html).
const TABS: { id: Tab; label: string }[] = [
  { id: "conocimiento", label: "Conocimiento" },
  { id: "memorias", label: "Recuerdos" },
  { id: "personalidad", label: "Personalidad" },
  { id: "diario", label: "Diario" },
  { id: "tacto", label: "Tacto" },
  { id: "caras", label: "Caras" },
];

// Miku decide cada vez más cosas por su cuenta (qué aprender, cómo
// reaccionar al tacto), así que hace falta poder ver qué guardó y corregir
// lo que salió mal. Solo se edita lo "práctico": el conocimiento y las
// reacciones al tacto. Recuerdos, personalidad y diario son su identidad y
// su voz propia -- aquí solo se leen, nunca se reescriben.
//
// Carga sus propios datos al abrirse (como el panel de quirks, recién cuando
// hace falta) para no sumar estado a App.tsx. Diseño v1: README §4.
export function MemoryPanel({ onClose, motion }: MemoryPanelProps) {
  const [tab, setTab] = useState<Tab>("conocimiento");

  return (
    <div className="m-panel memory-panel" data-motion={motion} role="dialog" aria-labelledby="mem-title">
      <div className="m-panel-header">
        <div className="m-panel-heading">
          <h2 id="mem-title" className="m-panel-title">
            Memoria
          </h2>
          <span className="m-panel-tag">ARCHIVO</span>
        </div>
        <button className="m-panel-close" onClick={onClose} aria-label="Cerrar memoria">
          <IconClose />
        </button>
      </div>

      <div className="mem-tabs" role="tablist" aria-label="Secciones de memoria">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`mem-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "conocimiento" && <KnowledgeSection />}
      {tab === "tacto" && <TouchSection />}
      {tab === "caras" && <MoodFacesSection />}
      {tab === "diario" && (
        <ReadOnlyFile
          key="diario"
          file="diario.md"
          hint="Lo que Miku escribe cada noche sobre su día. Es suyo: se lee, no se edita. Lo más reciente va arriba."
          unit="section"
          newestFirst
        />
      )}
      {tab === "memorias" && (
        <ReadOnlyFile
          key="memorias"
          file="memories.md"
          hint="Lo que Miku recuerda de ti y de lo que vivieron. Siempre lo tiene presente completo. Es suyo: se lee, no se edita."
          unit="paragraph"
        />
      )}
      {tab === "personalidad" && (
        <ReadOnlyFile
          key="personalidad"
          file="personality.md"
          hint="Cómo es Miku, según ella misma. Siempre lo tiene presente completo. Es suyo: se lee, no se edita."
          unit="line"
        />
      )}
    </div>
  );
}

function Footer({ left, right }: { left: string; right?: string }) {
  return (
    <div className="mem-footer">
      <span>{left}</span>
      {right && <span>{right}</span>}
    </div>
  );
}

const entryNumber = (i: number) => String(i + 1).padStart(2, "0");

// Buscador de cada pestaña: por texto, sin importar tildes ni mayúsculas
// (ver lib/textSearch.ts, por qué no por significado).
function SearchBox({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="mem-search">
      <label htmlFor={id} className="visually-hidden">
        Buscar
      </label>
      <span className="mem-search-icon">
        <IconSearch size={16} />
      </span>
      <input id={id} type="search" placeholder="Buscar" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="m-empty">
      <p className="m-empty-title">Nada con «{query.trim()}»</p>
      <p className="m-empty-text">Busca palabras que aparezcan en el texto (las tildes no importan).</p>
      <button className="m-btn m-btn-small" onClick={onClear}>
        Borrar búsqueda
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conocimiento

function KnowledgeSection() {
  const [entries, setEntries] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Se edita una entrada a la vez; la clave es su texto original, que es con lo
  // que knowledge.ts la encuentra en el archivo.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const reload = async () => {
    try {
      setEntries(await loadKnowledgeEntries());
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err));
    }
    await reload();
  };

  const handleSave = (original: string) =>
    run(async () => {
      if (draft.trim() !== original) await updateKnowledgeEntry(original, draft);
      setEditing(null);
    });

  // Entrada que se está por olvidar (diálogo de confirmación abierto).
  const [confirmForget, setConfirmForget] = useState<string | null>(null);

  const handleDelete = async (entry: string) => {
    setConfirmForget(null);
    if (editing === entry) setEditing(null);
    await run(() => deleteKnowledgeEntry(entry));
  };

  // Las más recientes arriba; con búsqueda, solo las que coinciden.
  const shown = entries ? [...entries].reverse().filter((e) => matchesQuery(e, query)) : null;

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">
          Saber práctico que puedes corregir u olvidar. Sus recuerdos, su personalidad y su diario son suyos: se
          leen, no se editan.
        </p>
        <SearchBox id="mem-q" value={query} onChange={setQuery} />
      </div>

      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {shown === null && !error && <p className="mem-empty">Cargando…</p>}
        {entries?.length === 0 && (
          <div className="m-empty">
            <span className="m-empty-icon" aria-hidden="true">
              <IconMemory size={26} />
            </span>
            <p className="m-empty-title">Todavía no sabe nada práctico</p>
            <p className="m-empty-text">
              Cuando le cuentes algo útil («mi GPU es…», «prefiero…»), lo anota sola y aparece aquí.
            </p>
          </div>
        )}
        {shown?.length === 0 && entries?.length !== 0 && <NoMatches query={query} onClear={() => setQuery("")} />}
        <ul className={`mem-list ${editing ? "is-editing" : ""}`}>
          {shown?.map((entry, i) =>
            editing === entry ? (
              <li key={`${i}:${entry}`} className="mem-row editing">
                <span className="mem-row-number">{entryNumber(i)}</span>
                <div className="mem-edit">
                  <span className="mem-edit-label">CORREGIENDO</span>
                  <textarea
                    className="mem-textarea"
                    aria-label="Corregir entrada"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    // Enter guarda, Esc cancela, Shift+Enter hace salto de línea.
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (draft.trim()) handleSave(entry);
                      } else if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    rows={3}
                    autoFocus
                  />
                  <div className="mem-edit-actions">
                    <button className="mem-btn" onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                    <button className="mem-btn m-btn-primary" onClick={() => handleSave(entry)} disabled={!draft.trim()}>
                      Guardar
                    </button>
                  </div>
                </div>
              </li>
            ) : (
              <li key={`${i}:${entry}`} className="mem-row">
                <span className="mem-row-number">{entryNumber(i)}</span>
                <span className="mem-row-text">{entry}</span>
                <div className="mem-row-actions">
                  <button
                    className="mem-btn accent"
                    onClick={() => {
                      setEditing(entry);
                      setDraft(entry);
                    }}
                  >
                    Corregir
                  </button>
                  <button className="mem-btn" onClick={() => setConfirmForget(entry)}>
                    Olvidar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      </div>

      {confirmForget !== null && (
        <ConfirmDialog
          title="¿Olvidar esto?"
          confirmLabel="Olvidar"
          tone="danger"
          onConfirm={() => handleDelete(confirmForget)}
          onCancel={() => setConfirmForget(null)}
        >
          <p className="m-dialog-quote">{confirmForget}</p>
          <p className="m-dialog-text">Miku deja de usarlo en sus charlas. No se puede deshacer.</p>
        </ConfirmDialog>
      )}

      <Footer
        left={`CONOCIMIENTO.MD · ${entries?.length ?? 0} ${entries?.length === 1 ? "ENTRADA" : "ENTRADAS"}`}
        right={`EN CADA CHARLA USA LAS ${KNOWLEDGE_TOP_K} MÁS CERCANAS`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Reacciones al tacto

const TOUCH_LABELS: Record<TouchReactionKey, string> = {
  cabeza: "Toque en la cabeza",
  cara: "Mejilla",
  coletas: "Tirón de coleta",
  mano: "Mano",
  brazo: "Brazo",
  torso: "Torso",
  falda: "Falda",
  pierna: "Pierna",
  caricia: "Caricia en la cabeza",
  harta: "Muchos toques seguidos",
  agitar: "Agitar la ventana",
};

const BONE_LABELS: Record<string, string> = {
  head: "cabeza",
  neck: "cuello",
  chest: "pecho",
  spine: "espalda",
  Shoulder: "hombro",
  UpperArm: "brazo",
  LowerArm: "antebrazo",
  Hand: "muñeca",
};

// Traduce una rotación a palabras con la misma tabla de ejes que usa Miku
// en el prompt (systemPrompt.ts): en los brazos, y/z van espejados entre
// lados, así que el mismo signo significa cosas distintas según el lado.
function describeEntry(bone: string, axis: "x" | "y" | "z", intensity: number): string {
  const side = bone.startsWith("left") ? "izq." : bone.startsWith("right") ? "der." : null;
  const base = side ? bone.replace(/^(left|right)/, "") : bone;
  const label = `${BONE_LABELS[base] ?? base}${side ? ` ${side}` : ""}`;
  const positive = intensity >= 0;

  let action: string;
  if (!side) {
    action =
      axis === "x"
        ? positive
          ? "hacia arriba"
          : "hacia abajo"
        : axis === "y"
          ? `gira a la ${positive ? "izquierda" : "derecha"}`
          : `se ladea a la ${positive ? "izquierda" : "derecha"}`;
  } else if (axis === "x") {
    action = positive ? "hacia atrás" : "hacia adelante";
  } else {
    // Izquierda: y+ = afuera, z+ = abajo. Derecha: al revés.
    const flip = side === "der.";
    if (axis === "z") action = positive === flip ? "hacia arriba" : "hacia abajo";
    else action = positive !== flip ? "hacia afuera" : "hacia adentro";
  }
  return `${label} ${action}`;
}

function describeMovement(reaction: DesignedTouchReaction): string {
  const seconds = (reaction.durationMs / 1000).toFixed(1);
  const timing = reaction.animated ? `animado, ${seconds}s por ciclo` : `${seconds}s`;
  // Las rotaciones muy pequeñas no se notan a la vista; se dejan fuera para
  // que el resumen diga lo que se ve.
  const visible = reaction.entries
    .filter((e) => Math.abs(e.intensity) >= 5)
    .sort((a, b) => Math.abs(b.intensity) - Math.abs(a.intensity));
  if (visible.length === 0) return `Casi no se mueve (${timing})`;
  const shown = visible.slice(0, 4).map((e) => describeEntry(e.bone, e.axis, e.intensity));
  const more = visible.length > 4 ? ` y ${visible.length - 4} más` : "";
  return `${shown.join(", ")}${more} (${timing})`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

function TouchSection() {
  const [reactions, setReactions] = useState<Partial<Record<TouchReactionKey, DesignedTouchReaction>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<TouchReactionKey | null>(null);

  const reload = async () => {
    try {
      setReactions(await listDesignedReactions());
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleRedesign = async (key: TouchReactionKey) => {
    setConfirmKey(null);
    setError(null);
    try {
      await deleteDesignedReaction(key);
    } catch (err) {
      setError(String(err));
    }
    await reload();
  };

  // Las 11 zonas siempre; las que ella todavía no diseñó usan el respaldo.
  const zones = Object.keys(TOUCH_LABELS) as TouchReactionKey[];
  const designedCount = reactions ? zones.filter((k) => reactions[k]).length : 0;

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">
          Cómo decidió reaccionar cuando la tocas en cada zona. Si alguna no te convence, pídele que la rediseñe: la
          próxima vez que la toques ahí, la diseña de nuevo ella misma.
        </p>
      </div>
      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {reactions === null && !error && <p className="mem-empty">Cargando…</p>}
        {reactions && (
          <ul className="mem-touch-grid">
            {zones.map((key) => {
              const reaction = reactions[key];
              return (
                <li key={key} className="mem-row mem-touch-row">
                  <div className="mem-row-text mem-touch">
                    <span>{TOUCH_LABELS[key]}</span>
                    <span className={`mem-touch-state ${reaction ? "own" : ""}`}>
                      {reaction ? "DISEÑADA POR ELLA" : "RESPALDO · AÚN NO LA DISEÑA"}
                    </span>
                    {reaction && (
                      <span className="mem-touch-meta" title={describeMovement(reaction)}>
                        {reaction.expression ?? "sin cambiar la expresión"} · {formatDate(reaction.createdAt)}
                        {reaction.side && ` · espejada del lado ${reaction.side === "left" ? "izquierdo" : "derecho"}`}
                      </span>
                    )}
                  </div>
                  <button
                    className="mem-btn"
                    onClick={() => setConfirmKey(key)}
                    disabled={!reaction}
                    title={
                      reaction
                        ? describeMovement(reaction)
                        : "Todavía no diseñó esta: la diseña la primera vez que la toques ahí"
                    }
                  >
                    Que la rediseñe
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmKey && (
        <ConfirmDialog
          title={`¿Que rediseñe «${TOUCH_LABELS[confirmKey].toLowerCase()}»?`}
          confirmLabel="Que la rediseñe"
          tone="primary"
          onConfirm={() => handleRedesign(confirmKey)}
          onCancel={() => setConfirmKey(null)}
        >
          <p className="m-dialog-text">
            Miku la va a diseñar de nuevo la próxima vez que la toques ahí. Mientras tanto usa la reacción básica.
          </p>
        </ConfirmDialog>
      )}
      <Footer
        left={`REACCIONES AL TACTO · ${designedCount} DE ${zones.length} DISEÑADAS`}
        right="LAS DISEÑA ELLA LA PRIMERA VEZ QUE LA TOCAS"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Caras de ánimo (la que pone en reposo según cómo se siente)

const MOOD_LABELS: Record<FaceKey, string> = {
  happy: "Contenta",
  happy_muy: "Muy contenta",
  sad: "Triste",
  sad_muy: "Muy triste",
  angry: "Enojada",
  angry_muy: "Muy enojada",
  relaxed: "Relajada",
  relaxed_muy: "Muy relajada",
};
// Orden del panel: cada ánimo seguido de su "muy".
const FACE_ORDER: FaceKey[] = MOODS_WITH_FACE.flatMap((m) => [m, `${m}_muy` as FaceKey]);

function MoodFacesSection() {
  const [faces, setFaces] = useState(listMoodFaces());
  const [confirmMood, setConfirmMood] = useState<FaceKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRedesign = async (mood: FaceKey) => {
    setConfirmMood(null);
    setError(null);
    try {
      await requestMoodFaceRedesign(mood);
    } catch (err) {
      setError(String(err));
    }
    setFaces(listMoodFaces());
  };

  const designedCount = FACE_ORDER.filter((m) => faces[m]).length;

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">
          La cara que pone cuando no habla, según su ánimo: una para cada ánimo y otra para cuando lo siente mucho (con un poco, la cara no cambia). Las diseña ella viéndose. Si alguna no se ve natural, pídele que
          la rediseñe: la próxima vez que esté así, la diseña de nuevo, sabiendo que se lo pediste.
        </p>
      </div>
      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        <ul className="mem-touch-grid">
          {FACE_ORDER.map((mood) => {
            const face = faces[mood];
            const state = !face ? "RESPALDO · AÚN NO LA DISEÑA" : face === "ninguna" ? "ELIGIÓ QUE NO SE NOTE" : "DISEÑADA POR ELLA";
            return (
              <li key={mood} className="mem-row mem-touch-row">
                <div className="mem-row-text mem-touch">
                  <span>{MOOD_LABELS[mood]}</span>
                  <span className={`mem-touch-state ${face ? "own" : ""}`}>{state}</span>
                  {face && face !== "ninguna" && <span className="mem-touch-meta">{describeFace(face)}</span>}
                </div>
                <button
                  className="mem-btn"
                  onClick={() => setConfirmMood(mood)}
                  disabled={!face}
                  title={face ? undefined : "Todavía no la diseñó: la diseña la primera vez que esté así"}
                >
                  Que la rediseñe
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {confirmMood && (
        <ConfirmDialog
          title={`¿Que rediseñe su cara de «${MOOD_LABELS[confirmMood].toLowerCase()}»?`}
          confirmLabel="Que la rediseñe"
          tone="primary"
          onConfirm={() => handleRedesign(confirmMood)}
          onCancel={() => setConfirmMood(null)}
        >
          <p className="m-dialog-text">
            La próxima vez que esté {MOOD_LABELS[confirmMood].toLowerCase()} y en silencio, la diseña de nuevo viéndose.
            Mientras tanto usa la cara básica.
          </p>
        </ConfirmDialog>
      )}
      <Footer
        left={`CARAS DE ÁNIMO · ${designedCount} DE ${FACE_ORDER.length} DISEÑADAS`}
        right="LAS DISEÑA ELLA LA PRIMERA VEZ QUE ESTÁ ASÍ"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Solo lectura

// Qué se muestra como un resultado al buscar: un recuerdo (párrafo), un
// rasgo de personalidad (línea) o una noche del diario (sección "## fecha").
type SearchUnit = "paragraph" | "line" | "section";

function splitUnits(text: string, unit: SearchUnit): string[] {
  const pattern = unit === "section" ? /\n(?=## )/ : unit === "line" ? /\n/ : /\n\s*\n/;
  return text
    .split(pattern)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ReadOnlyFile({
  file,
  hint,
  unit,
  newestFirst = false,
}: {
  file: string;
  hint: string;
  unit: SearchUnit;
  newestFirst?: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const path = await join(await appDataDir(), "memory", file);
        const text = (await exists(path)) ? await readTextFile(path) : "";
        if (!cancelled) setContent(newestFirst ? newestSectionsFirst(text) : text);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, newestFirst]);

  const searching = query.trim() !== "";
  // El encabezado del diario ("# Diario de Miku" + su aclaración) no es un resultado.
  const matches =
    searching && content ? splitUnits(content, unit).filter((u) => !u.startsWith("# ") && matchesQuery(u, query)) : [];

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">{hint}</p>
        {content?.trim() && <SearchBox id={`mem-q-${file}`} value={query} onChange={setQuery} />}
      </div>
      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {content === null && !error && <p className="mem-empty">Cargando…</p>}
        {content !== null && !content.trim() && <p className="mem-empty">Todavía está vacío.</p>}
        {content?.trim() && !searching && <pre className="mem-readonly">{content.trim()}</pre>}
        {searching && matches.length === 0 && content?.trim() && (
          <NoMatches query={query} onClear={() => setQuery("")} />
        )}
        {matches.length > 0 && (
          <div className="mem-readonly-list">
            {matches.map((m, i) => (
              <pre key={`${i}:${m}`} className="mem-readonly">
                {m}
              </pre>
            ))}
          </div>
        )}
      </div>
      <Footer
        left={`${file.toUpperCase()} · SOLO LECTURA`}
        right={searching ? `${matches.length} ${matches.length === 1 ? "COINCIDENCIA" : "COINCIDENCIAS"}` : undefined}
      />
    </>
  );
}

// El diario se escribe agregando "## fecha" al final (ver diary.ts); para
// leer la última noche sin bajar todo, se invierte el orden de las entradas
// dejando el encabezado del archivo arriba.
function newestSectionsFirst(text: string): string {
  const [header, ...sections] = text.split(/\n(?=## )/);
  return [header, ...sections.reverse()].map((s) => s.trim()).join("\n\n");
}
