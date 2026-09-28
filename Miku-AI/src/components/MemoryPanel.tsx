import { useEffect, useState } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  deleteKnowledgeEntry,
  KNOWLEDGE_TOP_K,
  loadKnowledgeEntries,
  searchKnowledge,
  updateKnowledgeEntry,
} from "../lib/knowledge";
import {
  deleteDesignedReaction,
  DesignedTouchReaction,
  listDesignedReactions,
  TouchReactionKey,
} from "../lib/touchReactionsStore";
import { IconClose, IconSearch } from "./Icons";
import type { MotionPhase } from "../hooks/usePresenceMotion";

type MemoryPanelProps = {
  onClose: () => void;
  // Fase de entrada/salida (ver usePresenceMotion).
  motion?: MotionPhase;
};

type Tab = "conocimiento" | "memorias" | "personalidad" | "diario" | "tacto";

// Orden de la maqueta (docs/diseno-ui-v1/Memoria.dc.html).
const TABS: { id: Tab; label: string }[] = [
  { id: "conocimiento", label: "Conocimiento" },
  { id: "memorias", label: "Recuerdos" },
  { id: "personalidad", label: "Personalidad" },
  { id: "diario", label: "Diario" },
  { id: "tacto", label: "Tacto" },
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
      {tab === "diario" && (
        <ReadOnlyFile
          file="diario.md"
          hint="Lo que Miku escribe cada noche sobre su día. Es suyo: se lee, no se edita. Lo más reciente va arriba."
          newestFirst
        />
      )}
      {tab === "memorias" && (
        <ReadOnlyFile
          file="memories.md"
          hint="Lo que Miku recuerda de ti y de lo que vivieron. Siempre lo tiene presente completo. Es suyo: se lee, no se edita."
        />
      )}
      {tab === "personalidad" && (
        <ReadOnlyFile
          file="personality.md"
          hint="Cómo es Miku, según ella misma. Siempre lo tiene presente completo. Es suyo: se lee, no se edita."
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

// ---------------------------------------------------------------------------
// Conocimiento

// Espera tras la última tecla antes de buscar por significado.
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_RESULTS = 10;

function KnowledgeSection() {
  const [entries, setEntries] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Se edita una entrada a la vez; la clave es su texto original, que es con lo
  // que knowledge.ts la encuentra en el archivo.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  // null = sin búsqueda; si no, las entradas encontradas (por significado,
  // o por texto si el servidor de voz no responde).
  const [results, setResults] = useState<string[] | null>(null);
  const [searchByText, setSearchByText] = useState(false);

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

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const found = await searchKnowledge(q, SEARCH_RESULTS);
        if (!cancelled) {
          setResults(found);
          setSearchByText(false);
        }
      } catch {
        const lower = q.toLowerCase();
        if (!cancelled) {
          setResults((entries ?? []).filter((e) => e.toLowerCase().includes(lower)).reverse());
          setSearchByText(true);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, entries]);

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

  const handleDelete = async (entry: string) => {
    const preview = entry.length > 120 ? `${entry.slice(0, 120)}…` : entry;
    const approved = await ask(`¿Que Miku olvide esta entrada de su conocimiento?\n\n${preview}`, {
      title: "Olvidar",
      kind: "warning",
    });
    if (!approved) return;
    if (editing === entry) setEditing(null);
    await run(() => deleteKnowledgeEntry(entry));
  };

  // Sin búsqueda: las más recientes arriba.
  const shown = results ?? (entries ? [...entries].reverse() : null);

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">
          Saber práctico que puedes corregir u olvidar. Sus recuerdos, su personalidad y su diario son suyos: se
          leen, no se editan.
        </p>
        <div className="mem-search">
          <label htmlFor="mem-q" className="visually-hidden">
            Buscar por significado
          </label>
          <span className="mem-search-icon">
            <IconSearch size={16} />
          </span>
          <input
            id="mem-q"
            type="search"
            placeholder="Buscar por significado"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {shown === null && !error && <p className="mem-empty">Cargando…</p>}
        {entries?.length === 0 && <p className="mem-empty">Todavía no guardó nada.</p>}
        {results?.length === 0 && entries?.length !== 0 && <p className="mem-empty">Nada parecido.</p>}
        {searchByText && results && results.length > 0 && (
          <p className="mem-empty">El buscador por significado no responde; filtré por texto.</p>
        )}
        <ul className="mem-list">
          {shown?.map((entry, i) =>
            editing === entry ? (
              <li key={`${i}:${entry}`} className="mem-row editing">
                <span className="mem-row-number">{entryNumber(i)}</span>
                <textarea
                  className="mem-textarea"
                  aria-label="Corregir entrada"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
                  autoFocus
                />
                <div className="mem-row-actions">
                  <button className="mem-btn m-btn-primary" onClick={() => handleSave(entry)} disabled={!draft.trim()}>
                    Guardar
                  </button>
                  <button className="mem-btn" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
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
                  <button className="mem-btn" onClick={() => handleDelete(entry)}>
                    Olvidar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      </div>

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
  const [reactions, setReactions] = useState<[TouchReactionKey, DesignedTouchReaction][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const store = await listDesignedReactions();
      setReactions(
        (Object.entries(store) as [TouchReactionKey, DesignedTouchReaction][]).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleRedesign = async (key: TouchReactionKey) => {
    const approved = await ask(
      `¿Borrar la reacción de Miku a "${TOUCH_LABELS[key] ?? key}"? La próxima vez que la toques ahí, la va a diseñar de nuevo.`,
      { title: "Que la rediseñe", kind: "warning" },
    );
    if (!approved) return;
    setError(null);
    try {
      await deleteDesignedReaction(key);
    } catch (err) {
      setError(String(err));
    }
    await reload();
  };

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">
          Cómo decidió reaccionar cuando la tocas en cada zona. Si alguna no te convence, bórrala: la próxima vez
          que la toques ahí, la diseña de nuevo ella misma.
        </p>
      </div>
      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {reactions === null && !error && <p className="mem-empty">Cargando…</p>}
        {reactions?.length === 0 && <p className="mem-empty">Todavía no diseñó ninguna reacción propia.</p>}
        <ul className="mem-list">
          {reactions?.map(([key, reaction], i) => (
            <li key={key} className="mem-row">
              <span className="mem-row-number">{entryNumber(i)}</span>
              <div className="mem-row-text mem-touch">
                <span>
                  {TOUCH_LABELS[key] ?? key}{" "}
                  <span className="mem-touch-meta">· {reaction.expression ?? "sin cambiar la expresión"}</span>
                </span>
                <span className="mem-touch-meta">{describeMovement(reaction)}</span>
                <span className="mem-touch-date">
                  {formatDate(reaction.createdAt)}
                  {reaction.side &&
                    ` · diseñada del lado ${reaction.side === "left" ? "izquierdo" : "derecho"}, espejada del otro`}
                </span>
              </div>
              <div className="mem-row-actions">
                <button className="mem-btn" onClick={() => handleRedesign(key)}>
                  Que la rediseñe
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Footer
        left={`REACCIONES AL TACTO · ${reactions?.length ?? 0} ZONAS`}
        right="LAS DISEÑA ELLA LA PRIMERA VEZ QUE LA TOCAS"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Solo lectura

function ReadOnlyFile({ file, hint, newestFirst = false }: { file: string; hint: string; newestFirst?: boolean }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="mem-intro">
        <p className="mem-hint">{hint}</p>
      </div>
      <div className="m-panel-body">
        {error && <p className="mem-error">{error}</p>}
        {content === null && !error && <p className="mem-empty">Cargando…</p>}
        {content !== null && !content.trim() && <p className="mem-empty">Todavía está vacío.</p>}
        {content?.trim() && <pre className="mem-readonly">{content.trim()}</pre>}
      </div>
      <Footer left={`${file.toUpperCase()} · SOLO LECTURA`} />
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
