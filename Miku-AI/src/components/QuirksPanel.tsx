import { QuirksStore, StoredQuirk } from "../lib/quirks";
import { DEFAULT_QUIRK_REVERT_CYCLES } from "../config/constants";

type QuirksPanelProps = {
  quirks: QuirksStore;
  onConfirm: (name: string) => void;
  onRevertToEvaluando: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
};

// Idea nueva: los quirks de Fase 7 eran 100% invisibles fuera de leer
// .settings.dat a mano -- este panel es solo de VISUALIZACIÓN y control
// manual (confirmar/revertir/borrar), nunca crea uno nuevo -- eso sigue
// siendo decisión exclusiva de Miku vía [CREAR_QUIRK], acá no se agrega
// ninguna forma de que Sebastián le imponga un quirk propio.
export function QuirksPanel({
  quirks,
  onConfirm,
  onRevertToEvaluando,
  onDelete,
  onClose,
}: QuirksPanelProps) {
  const names = Object.keys(quirks).sort();

  return (
    <div className="app-launcher-panel">
      <div className="app-launcher-header">
        <span>Quirks de Miku</span>
        <button onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      <p className="app-launcher-hint">
        Movimientos que Miku inventó por su cuenta en los momentos de
        silencio. Solo ella los crea -- acá puedes confirmarlos, devolverlos
        a evaluación, o borrarlos, pero no crear uno nuevo.
      </p>
      <div className="app-launcher-section">
        {names.length === 0 && (
          <p className="app-launcher-empty">
            Todavía no inventó ningún quirk propio.
          </p>
        )}
        {names.map((name) => (
          <QuirkRow
            key={name}
            name={name}
            quirk={quirks[name]}
            onConfirm={() => onConfirm(name)}
            onRevertToEvaluando={() => onRevertToEvaluando(name)}
            onDelete={() => onDelete(name)}
          />
        ))}
      </div>
    </div>
  );
}

function describeQuirk(quirk: StoredQuirk): string {
  const parts: string[] = [];
  if (quirk.movement) {
    const bones = [...new Set(quirk.movement.entries.map((e) => e.bone))];
    const seconds = (quirk.movement.durationMs / 1000).toFixed(1);
    if (quirk.movement.animated) {
      const cycles = quirk.revertAfterCycles ?? DEFAULT_QUIRK_REVERT_CYCLES;
      parts.push(`${bones.join("/")} (animado, ${seconds}s/ciclo x${cycles})`);
    } else {
      parts.push(`${bones.join("/")} (${seconds}s)`);
    }
  }
  if (quirk.handLeft || quirk.handRight) {
    const hands = [
      quirk.handLeft ? `izq=${quirk.handLeft}` : null,
      quirk.handRight ? `der=${quirk.handRight}` : null,
    ].filter(Boolean);
    parts.push(hands.join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : "(sin movimiento de cuerpo ni manos)";
}

function QuirkRow({
  name,
  quirk,
  onConfirm,
  onRevertToEvaluando,
  onDelete,
}: {
  name: string;
  quirk: StoredQuirk;
  onConfirm: () => void;
  onRevertToEvaluando: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="app-launcher-app-row">
      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 2 }}>
        <span className="app-launcher-app-name">
          {name}{" "}
          <span
            style={{
              fontSize: 11,
              opacity: 0.7,
              fontWeight: "normal",
            }}
          >
            ({quirk.state === "evaluando" ? "evaluando" : "confirmado"})
          </span>
        </span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{describeQuirk(quirk)}</span>
      </div>
      {quirk.state === "evaluando" ? (
        <button onClick={onConfirm} title="Confirmar este quirk">
          ✓
        </button>
      ) : (
        <button onClick={onRevertToEvaluando} title="Volver a poner en evaluación">
          ↺
        </button>
      )}
      <button onClick={onDelete} title="Eliminar este quirk">
        🗑
      </button>
    </div>
  );
}
