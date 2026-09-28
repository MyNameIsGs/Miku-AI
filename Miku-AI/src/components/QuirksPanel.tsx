import { useState } from "react";
import type { ReactNode } from "react";
import { QuirksStore, StoredQuirk } from "../lib/quirks";
import { DEFAULT_QUIRK_REVERT_CYCLES } from "../config/constants";
import { HAND_PRESET_DESCRIPTIONS } from "../config/handPresets";
import { IconBack, IconCheck, IconClose, IconReload, IconTrash } from "./Icons";
import { ConfirmDialog } from "./ConfirmDialog";
import type { MotionPhase } from "../hooks/usePresenceMotion";

type QuirksPanelProps = {
  quirks: QuirksStore;
  onConfirm: (name: string) => void;
  onRevertToEvaluando: (name: string) => void;
  onDelete: (name: string) => void;
  // Se abre desde Configuración: el botón atrás vuelve ahí.
  onBack: () => void;
  onClose: () => void;
  motion?: MotionPhase;
};

// Los quirks los inventa Miku en sus momentos de silencio. Este panel es
// solo de visualización y control manual (confirmar, devolver a evaluación,
// borrar): nunca crea uno nuevo -- eso sigue siendo decisión exclusiva de
// ella vía [CREAR_QUIRK]. Diseño: ronda 2, DISENO.md §2.1.
export function QuirksPanel({ quirks, onConfirm, onRevertToEvaluando, onDelete, onBack, onClose, motion }: QuirksPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const names = Object.keys(quirks).sort((a, b) => a.localeCompare(b));
  const evaluating = names.filter((n) => quirks[n].state === "evaluando");
  const confirmed = names.filter((n) => quirks[n].state !== "evaluando");

  return (
    <div className="m-panel quirks-panel" data-motion={motion} role="dialog" aria-labelledby="quirks-title">
      <div className="m-panel-header">
        <div className="m-panel-heading m-panel-heading-back">
          <button className="m-panel-back" onClick={onBack} aria-label="Volver a Configuración">
            <IconBack />
          </button>
          <h2 id="quirks-title" className="m-panel-title">
            Quirks
          </h2>
          <span className="m-panel-tag">GESTOS PROPIOS</span>
        </div>
        <button className="m-panel-close" onClick={onClose} aria-label="Cerrar quirks">
          <IconClose />
        </button>
      </div>

      <p className="quirks-hint">
        Movimientos que Miku inventó por su cuenta en sus momentos de silencio. Solo ella los crea: aquí puedes
        confirmarlos, devolverlos a evaluación o borrarlos.
      </p>

      <div className="m-panel-body">
        {names.length === 0 ? (
          <div className="m-empty">
            <p className="m-empty-title">Sin gestos propios todavía</p>
            <p className="m-empty-text">Los inventa en sus momentos de silencio.</p>
          </div>
        ) : (
          <>
            {evaluating.length > 0 && (
              <QuirkGroup label={`EVALUANDO · ${evaluating.length}`} tone="evaluating">
                {evaluating.map((name) => (
                  <li key={name} className="quirk-row evaluating">
                    <QuirkText name={name} quirk={quirks[name]} />
                    <div className="quirk-actions">
                      <button className="m-btn m-btn-small m-btn-primary" onClick={() => onConfirm(name)}>
                        <IconCheck size={14} />
                        Confirmar
                      </button>
                      <button
                        className="m-btn m-btn-small m-btn-icon"
                        onClick={() => setConfirmDelete(name)}
                        aria-label={`Borrar «${name}»`}
                        title="Borrar"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </QuirkGroup>
            )}
            {confirmed.length > 0 && (
              <QuirkGroup label={`CONFIRMADOS · ${confirmed.length}`} tone="confirmed">
                {confirmed.map((name) => (
                  <li key={name} className="quirk-row">
                    <QuirkText name={name} quirk={quirks[name]} />
                    <div className="quirk-actions">
                      <button className="m-btn m-btn-small" onClick={() => onRevertToEvaluando(name)}>
                        <IconReload size={14} />
                        Volver a evaluar
                      </button>
                      <button
                        className="m-btn m-btn-small m-btn-icon"
                        onClick={() => setConfirmDelete(name)}
                        aria-label={`Borrar «${name}»`}
                        title="Borrar"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </QuirkGroup>
            )}
          </>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="¿Borrar este gesto?"
          confirmLabel="Borrar"
          tone="danger"
          onConfirm={() => {
            onDelete(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="m-dialog-quote">{confirmDelete}</p>
          <p className="m-dialog-text">Miku ya no lo va a usar. No se puede deshacer.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function QuirkGroup({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "evaluating" | "confirmed";
  children: ReactNode;
}) {
  return (
    <section className="quirk-group" aria-label={label}>
      <div className={`quirk-group-label ${tone}`}>
        <span className="quirk-group-led" />
        {label}
      </div>
      <ul className="quirk-list">{children}</ul>
    </section>
  );
}

function QuirkText({ name, quirk }: { name: string; quirk: StoredQuirk }) {
  return (
    <div className="quirk-text">
      <span className="quirk-name">{name}</span>
      <span className="quirk-desc">{describeQuirk(quirk)}</span>
    </div>
  );
}

// --- Descripción en palabras (antes mostraba nombres de hueso crudos) ---

const BONE_WORDS: Record<string, string> = {
  head: "cabeza",
  neck: "cuello",
  spine: "columna",
  chest: "columna",
  upperChest: "columna",
  hips: "cadera",
  Shoulder: "hombro",
  UpperArm: "brazo",
  LowerArm: "antebrazo",
  Hand: "muñeca",
  UpperLeg: "muslo",
  LowerLeg: "pierna",
  Foot: "pie",
};

function boneWord(bone: string): string {
  const side = bone.startsWith("left") ? "izquierdo" : bone.startsWith("right") ? "derecho" : null;
  const base = side ? bone.replace(/^(left|right)/, "") : bone;
  const word = BONE_WORDS[base] ?? base;
  if (!side) return word;
  // "muñeca", "cadera", "pierna": femeninas.
  const feminine = word.endsWith("a");
  return `${word} ${feminine ? side.replace(/o$/, "a") : side}`;
}

// Coma decimal: 1,2 s.
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// "mano relajada, apenas curvada" → "mano relajada". Los gestos que ella
// inventó no tienen descripción: se muestra su nombre.
function handWord(gesture: string): string {
  const description = HAND_PRESET_DESCRIPTIONS[gesture];
  if (!description) return gesture;
  return description.split(/[,(:]/)[0].trim();
}

function describeQuirk(quirk: StoredQuirk): string {
  const parts: string[] = [];
  if (quirk.movement) {
    const bones = [...new Set(quirk.movement.entries.map((e) => boneWord(e.bone)))];
    const timing = quirk.movement.animated
      ? `animado, ${seconds(quirk.movement.durationMs)} por ciclo × ${quirk.revertAfterCycles ?? DEFAULT_QUIRK_REVERT_CYCLES}`
      : seconds(quirk.movement.durationMs);
    parts.push(bones.join(" · "), timing);
  }
  if (quirk.handLeft && quirk.handLeft === quirk.handRight) {
    parts.push(`manos: ${handWord(quirk.handLeft)}`);
  } else {
    if (quirk.handLeft) parts.push(`mano izq: ${handWord(quirk.handLeft)}`);
    if (quirk.handRight) parts.push(`mano der: ${handWord(quirk.handRight)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "sin movimiento de cuerpo ni manos";
}
