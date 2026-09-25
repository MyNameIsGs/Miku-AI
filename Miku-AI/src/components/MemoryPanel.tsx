import { useEffect, useState } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  deleteKnowledgeEntry,
  loadKnowledgeEntries,
  updateKnowledgeEntry,
} from "../lib/knowledge";
import {
  deleteDesignedReaction,
  DesignedTouchReaction,
  listDesignedReactions,
  TouchReactionKey,
} from "../lib/touchReactionsStore";

type MemoryPanelProps = {
  onClose: () => void;
};

type Tab = "conocimiento" | "tacto" | "diario" | "memorias" | "personalidad";

const TABS: { id: Tab; label: string }[] = [
  { id: "conocimiento", label: "Conocimiento" },
  { id: "tacto", label: "Tacto" },
  { id: "diario", label: "Diario" },
  { id: "memorias", label: "Memorias" },
  { id: "personalidad", label: "Personalidad" },
];

// Miku decide cada vez más cosas por su cuenta (qué aprender, cómo
// reaccionar al tacto), así que hace falta poder ver qué guardó y corregir
// lo que salió mal. Solo se edita lo "práctico": el conocimiento y las
// reacciones al tacto. Memorias, personalidad y diario son su identidad y
// su voz propia -- aquí solo se leen, nunca se reescriben.
//
// Carga sus propios datos al abrirse (como el panel de quirks, recién cuando
// hace falta) para no sumar estado a App.tsx.
export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [tab, setTab] = useState<Tab>("conocimiento");

  return (
    <div className="app-launcher-panel">
      <div className="app-launcher-header">
        <span>Memoria de Miku</span>
        <button onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <div className="memory-panel-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
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
          hint="Lo que Miku escribe cada noche sobre su día. Es suyo: solo se puede leer. Lo más reciente va arriba."
          newestFirst
        />
      )}
      {tab === "memorias" && (
        <ReadOnlyFile
          file="memories.md"
          hint="Lo que Miku recuerda de ti y de lo que vivieron. Siempre lo tiene presente completo. Solo lectura."
        />
      )}
      {tab === "personalidad" && (
        <ReadOnlyFile
          file="personality.md"
          hint="Cómo es Miku, según ella misma. Siempre lo tiene presente completo. Solo lectura."
        />
      )}
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

  const handleDelete = async (entry: string) => {
    const preview = entry.length > 120 ? `${entry.slice(0, 120)}…` : entry;
    const approved = await ask(`¿Borrar esta entrada del conocimiento de Miku?\n\n${preview}`, {
      title: "Borrar conocimiento",
      kind: "warning",
    });
    if (!approved) return;
    if (editing === entry) setEditing(null);
    await run(() => deleteKnowledgeEntry(entry));
  };

  return (
    <div className="app-launcher-section">
      <p className="app-launcher-hint">
        Saber práctico que Miku fue aprendiendo (cómo hacer cosas, tus
        preferencias, datos de tu equipo). Solo recuerda las entradas
        relacionadas con lo que se está hablando. Las más recientes van
        arriba.
      </p>
      {error && <p className="memory-panel-error">{error}</p>}
      {entries === null && !error && <p className="app-launcher-empty">Cargando…</p>}
      {entries?.length === 0 && (
        <p className="app-launcher-empty">Todavía no guardó nada.</p>
      )}
      {entries &&
        [...entries].reverse().map((entry, i) =>
          editing === entry ? (
            <div key={`${i}:${entry}`} className="memory-panel-entry">
              <textarea
                className="memory-panel-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
                autoFocus
              />
              <div className="memory-panel-actions">
                <button onClick={() => handleSave(entry)} disabled={!draft.trim()}>
                  Guardar
                </button>
                <button onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div key={`${i}:${entry}`} className="memory-panel-entry">
              <span className="memory-panel-text">{entry}</span>
              <div className="memory-panel-actions">
                <button
                  onClick={() => {
                    setEditing(entry);
                    setDraft(entry);
                  }}
                  title="Editar esta entrada"
                >
                  ✎
                </button>
                <button onClick={() => handleDelete(entry)} title="Borrar esta entrada">
                  🗑
                </button>
              </div>
            </div>
          ),
        )}
    </div>
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
  const [reactions, setReactions] = useState<
    [TouchReactionKey, DesignedTouchReaction][] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const store = await listDesignedReactions();
      setReactions(
        (Object.entries(store) as [TouchReactionKey, DesignedTouchReaction][]).sort(
          ([a], [b]) => a.localeCompare(b),
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
    <div className="app-launcher-section">
      <p className="app-launcher-hint">
        Cómo decidió reaccionar Miku cuando la tocas en cada zona. Si alguna
        no te convence, bórrala: la próxima vez que la toques ahí, la diseña
        de nuevo ella misma.
      </p>
      {error && <p className="memory-panel-error">{error}</p>}
      {reactions === null && !error && <p className="app-launcher-empty">Cargando…</p>}
      {reactions?.length === 0 && (
        <p className="app-launcher-empty">Todavía no diseñó ninguna reacción propia.</p>
      )}
      {reactions?.map(([key, reaction]) => (
        <div key={key} className="memory-panel-entry">
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
            <span className="app-launcher-app-name">
              {TOUCH_LABELS[key] ?? key}{" "}
              <span style={{ fontSize: 11, opacity: 0.7, fontWeight: "normal" }}>
                ({reaction.expression ?? "sin cambiar la expresión"})
              </span>
            </span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{describeMovement(reaction)}</span>
            <span style={{ fontSize: 10, opacity: 0.5 }}>
              {formatDate(reaction.createdAt)}
              {reaction.side &&
                ` · diseñada del lado ${reaction.side === "left" ? "izquierdo" : "derecho"}, espejada del otro`}
            </span>
          </div>
          <button onClick={() => handleRedesign(key)} title="Borrarla para que Miku la diseñe de nuevo">
            Que la rediseñe
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Solo lectura

function ReadOnlyFile({
  file,
  hint,
  newestFirst = false,
}: {
  file: string;
  hint: string;
  newestFirst?: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
    <div className="app-launcher-section">
      <p className="app-launcher-hint">{hint}</p>
      {error && <p className="memory-panel-error">{error}</p>}
      {content === null && !error && <p className="app-launcher-empty">Cargando…</p>}
      {content !== null && !content.trim() && (
        <p className="app-launcher-empty">Todavía está vacío.</p>
      )}
      {content?.trim() && <pre className="memory-panel-readonly">{content.trim()}</pre>}
    </div>
  );
}

// El diario se escribe agregando "## fecha" al final (ver diary.ts); para
// leer la última noche sin bajar todo, se invierte el orden de las entradas
// dejando el encabezado del archivo arriba.
function newestSectionsFirst(text: string): string {
  const [header, ...sections] = text.split(/\n(?=## )/);
  return [header, ...sections.reverse()].map((s) => s.trim()).join("\n\n");
}
