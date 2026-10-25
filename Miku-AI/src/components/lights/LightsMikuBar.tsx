import { MikuLightsState, setMikuDecides } from "../../lib/mikuLights";

type LightsMikuBarProps = {
  mine: MikuLightsState;
  onError: (err: unknown) => void;
};

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `hace ${hours} h`;
}

// "Que Miku lo decida" (fase 6, pestaña Escena): con el interruptor
// prendido ella elige las luces según el momento; los perfiles automáticos
// de Sebastián siguen mandando. Al apagarlo vuelve la escena de antes.
export function LightsMikuBar({ mine, onError }: LightsMikuBarProps) {
  const { on, lastNote, lastAt } = mine.decides;
  return (
    <section className={`lights-module lights-miku-bar ${on ? "on" : ""}`} aria-label="Que Miku lo decida">
      <button
        className={`lights-switch ${on ? "on" : ""}`}
        onClick={() => setMikuDecides(!on).catch(onError)}
        aria-pressed={on}
        aria-label="Que Miku lo decida"
        title={on ? "Apágalo y vuelven las luces que tenías" : "Ella elige las luces según el momento"}
      >
        <span className="lights-switch-knob" />
      </button>
      <div className="lights-miku-text">
        <span className="lights-zone-name">Que Miku lo decida</span>
        <span className="lights-zone-detail">
          {!on
            ? "Ella elige las luces según la música, la hora, su ánimo y lo que estés haciendo. Tus perfiles automáticos siguen mandando."
            : lastNote && lastAt
              ? `Miku: «${lastNote}» · ${ago(lastAt)}`
              : lastAt
                ? `Las dejó como estaban · ${ago(lastAt)}`
                : "Elige en cuanto cambie el momento (o en unos minutos)."}
        </span>
      </div>
      {mine.effects.length > 0 && <span className="lights-badge">{mine.effects.length} EFECTOS SUYOS</span>}
    </section>
  );
}
