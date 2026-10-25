import { useEffect, useState } from "react";
import {
  KeyboardStrips,
  STRIP_BRIGHTNESS_MAX,
  STRIP_COLORS,
  STRIP_SPEED_MAX,
  STRIP_MODES,
  Scene,
  readStrips,
  resolveStrips,
  stripUsesColor,
} from "../../lib/lights";

type LightsStripsCardProps = {
  scene: Scene;
  onScene: (next: Scene, final: boolean) => void;
};

// Las tiras del teclado AULA (pestaña Escena). Van aparte de los grupos
// porque no aceptan cualquier color ni efectos de Miku: tienen sus propios
// modos y 7 colores, y cada cambio hace parpadear el teclado un instante.
export function LightsStripsCard({ scene, onScene }: LightsStripsCardProps) {
  // Si la escena todavía no dice nada de las tiras, se muestra cómo están
  // en el teclado (lo que se haya puesto con Fn).
  const [fromKeyboard, setFromKeyboard] = useState<KeyboardStrips | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scene.keyboardStrips) return;
    readStrips()
      .then(setFromKeyboard)
      .catch((err) => setError(String(err)));
  }, [scene.keyboardStrips]);

  const strips = scene.keyboardStrips ?? fromKeyboard;
  if (!strips) {
    return error ? <p className="lights-strips-note">Tiras del teclado: {error}</p> : null;
  }
  const shown = resolveStrips({ ...scene, keyboardStrips: strips }) ?? strips;

  const change = (patch: Partial<KeyboardStrips>) => onScene({ ...scene, keyboardStrips: { ...strips, ...patch } }, true);
  const bottom = (patch: Partial<KeyboardStrips["bottom"]>) => change({ bottom: { ...strips.bottom, ...patch } });
  const top = (patch: Partial<KeyboardStrips["top"]>) => change({ top: { ...strips.top, ...patch } });

  return (
    <div className="lights-section lights-strips">
      <span className="lights-module-title">
        <span className="lights-n">04</span>TIRAS DEL TECLADO
      </span>
      <p className="lights-strips-note">Modos y colores propios del teclado. Cada cambio lo hace parpadear un instante.</p>

      <StripRow
        title="Abajo"
        hint="Izquierda y derecha"
        mode={strips.bottom.mode}
        color={shown.bottom.color}
        follow={!!strips.follow}
        onMode={(mode) => bottom({ mode })}
        onColor={(color) => bottom({ color })}
      />
      {strips.bottom.mode !== 0 && (
        <div className="lights-params">
          <Level label="Brillo" names={Array.from({ length: STRIP_BRIGHTNESS_MAX + 1 }, (_, i) => String(i + 1))} value={strips.bottom.brightness} onChange={(brightness) => bottom({ brightness })} />
          {strips.bottom.mode !== 3 && <Level label="Velocidad" names={SPEED_NAMES} value={strips.bottom.speed} onChange={(speed) => bottom({ speed })} />}
        </div>
      )}

      <StripRow
        title="Arriba"
        hint="Debajo de DEL / END"
        mode={strips.top.mode}
        color={shown.top.color}
        follow={!!strips.follow}
        onMode={(mode) => top({ mode })}
        onColor={(color) => top({ color })}
      />

      <label className="lights-strips-follow">
        <input type="checkbox" checked={!!strips.follow} onChange={(e) => change({ follow: e.target.checked })} />
        Color según el grupo Periféricos (el más parecido de los 7)
      </label>
    </div>
  );
}

function StripRow(props: {
  title: string;
  hint: string;
  mode: number;
  color: number;
  follow: boolean;
  onMode: (mode: number) => void;
  onColor: (color: number) => void;
}) {
  return (
    <div className="lights-strip-row">
      <div className="lights-strip-head">
        <span className="lights-param-label">{props.title}</span>
        <span className="lights-strip-hint">{props.hint}</span>
      </div>
      <div className="lights-seg" role="radiogroup" aria-label={`Modo de la tira de ${props.title.toLowerCase()}`}>
        {STRIP_MODES.map((name, i) => (
          <button key={name} role="radio" aria-checked={props.mode === i} className={props.mode === i ? "on" : ""} onClick={() => props.onMode(i)}>
            {name}
          </button>
        ))}
      </div>
      {stripUsesColor(props.mode) && (
        <div className="lights-colors" role="radiogroup" aria-label={`Color de la tira de ${props.title.toLowerCase()}`}>
          {STRIP_COLORS.map((c, i) => (
            <button
              key={c.name}
              role="radio"
              aria-checked={props.color === i}
              className={`lights-chip ${props.color === i ? "sel" : ""}`}
              style={{ background: c.hex }}
              title={props.follow ? `${c.name} (sigue a la escena)` : c.name}
              disabled={props.follow}
              onClick={() => props.onColor(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const SPEED_NAMES = ["Lenta", "Media", "Rápida"].slice(0, STRIP_SPEED_MAX + 1);

function Level({ label, names, value, onChange }: { label: string; names: string[]; value: number; onChange: (v: number) => void }) {
  return (
    <div className="lights-param">
      <span className="lights-param-label">{label}</span>
      <div className="lights-seg" role="radiogroup" aria-label={label}>
        {names.map((name, i) => (
          <button key={name} role="radio" aria-checked={value === i} className={value === i ? "on" : ""} onClick={() => onChange(i)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
