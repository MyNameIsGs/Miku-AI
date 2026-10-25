import { useState } from "react";
import { rgbCss } from "../../lib/lightEffects";
import {
  KeyboardStrips,
  STRIP_BRIGHTNESS_MAX,
  STRIP_COLORS,
  STRIP_MODES,
  STRIP_SPEED_MAX,
  hexToRgb,
  stripUsesColor,
} from "../../lib/lights";

// Las tiras del teclado AULA en la pestaña Escena: un grupo más en la lista
// de la izquierda ("Tiras"), con su editor a la derecha igual que el de los
// efectos (galería con miniaturas animadas, ajustes, colores). Van aparte
// de los grupos de OpenRGB porque tienen sus propios modos y 7 colores, y
// cada cambio hace parpadear el teclado un instante.

type Which = "both" | "bottom" | "top";
const WHICH_NAMES: Record<Which, string> = { both: "Las tres", bottom: "Abajo", top: "Arriba" };
const SPEED_NAMES = ["Lenta", "Media", "Rápida"].slice(0, STRIP_SPEED_MAX + 1);
const MODE_HINTS = [
  "Apagadas.",
  "Un arcoíris que corre a lo largo de la tira.",
  "La tira entera va cambiando de color.",
  "Un color quieto.",
  "Un color que sube y baja suave.",
];

function hue(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))));
  };
  return [f(5), f(3), f(1)];
}

// El color de un punto de la tira (x de 0 a 1) en el instante t, según su
// modo. Una aproximación de lo que hace el teclado, para las miniaturas.
function stripColor(mode: number, color: number, x: number, t: number, speed = 1): [number, number, number] {
  const v = 0.35 + speed * 0.3;
  switch (mode) {
    case 1:
      return hue((x + t * 0.25 * v) % 1);
    case 2:
      return hue((t * 0.12 * v) % 1);
    case 3:
      return hexToRgb(STRIP_COLORS[color]?.hex ?? "#FFFFFF");
    case 4: {
      const k = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 2.2 * v));
      return hexToRgb(STRIP_COLORS[color]?.hex ?? "#FFFFFF").map((c) => c * k) as [number, number, number];
    }
    default:
      return [0, 0, 0];
  }
}

// Un teclado en esquema con sus tres tiras: las dos de abajo (izquierda y
// derecha) y la de arriba (bajo el bloque DEL/END/PgDn).
export function drawStripsThumb(canvas: HTMLCanvasElement, strips: KeyboardStrips, t: number, only?: { mode: number; which: Which }) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#081113";
  g.fillRect(0, 0, w, h);
  const kx = w * 0.1;
  const ky = h * 0.2;
  const kw = w * 0.8;
  const kh = h * 0.48;
  // Cuerpo y teclas.
  g.fillStyle = "#1b2a2d";
  g.beginPath();
  g.roundRect(kx, ky, kw, kh, Math.max(2, h * 0.05));
  g.fill();
  g.fillStyle = "rgba(234, 244, 243, 0.12)";
  const cols = 15;
  const rows = 5;
  const main = kw * 0.78;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.fillRect(kx + kw * 0.03 + (c * main) / cols, ky + kh * 0.1 + (r * kh * 0.8) / rows, main / cols - 1.5, (kh * 0.8) / rows - 1.5);
    }
  }
  const navX = kx + kw * 0.84;
  const navW = kw * 0.13;
  for (let r = 0; r < 2; r++) g.fillRect(navX, ky + kh * 0.1 + (r * kh * 0.8) / rows, navW, (kh * 0.8) / rows - 1.5);

  const bottomMode = only && only.which !== "top" ? only.mode : strips.bottom.mode;
  const topMode = only && only.which !== "bottom" ? only.mode : strips.top.mode;
  const speed = strips.bottom.speed;
  const level = 0.45 + (0.55 * strips.bottom.brightness) / STRIP_BRIGHTNESS_MAX;
  const bar = (x: number, y: number, bw: number, bh: number, mode: number, color: number, k: number) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const c = stripColor(mode, color, (x - kx + (i / n) * bw) / kw, t, speed).map((v) => v * k);
      g.fillStyle = mode === 0 ? "rgba(234, 244, 243, 0.08)" : rgbCss(c);
      g.shadowColor = mode === 0 ? "transparent" : rgbCss(c, 0.8);
      g.shadowBlur = mode === 0 ? 0 : 6;
      g.fillRect(x + (i * bw) / n, y, bw / n + 0.5, bh);
    }
    g.shadowBlur = 0;
  };
  const stripH = Math.max(2, h * 0.06);
  // Abajo: a izquierda y derecha, pegadas al borde de abajo.
  bar(kx + kw * 0.04, ky + kh + h * 0.06, kw * 0.4, stripH, bottomMode, strips.bottom.color, level);
  bar(kx + kw * 0.56, ky + kh + h * 0.06, kw * 0.4, stripH, bottomMode, strips.bottom.color, level);
  // Arriba: bajo el bloque de navegación.
  bar(navX, ky + kh * 0.47, navW, stripH, topMode, strips.top.color, 1);
}

type StripsEditorProps = {
  strips: KeyboardStrips;
  // `final`: el cambio terminó (soltar el deslizador): ahí se escribe al
  // teclado y se anota para deshacer.
  onChange: (next: KeyboardStrips, final: boolean) => void;
  thumbRef: (id: string) => (el: HTMLCanvasElement | null) => void;
};

export function StripsEditor({ strips, onChange, thumbRef }: StripsEditorProps) {
  const [which, setWhich] = useState<Which>("both");
  const mode = which === "top" ? strips.top.mode : strips.bottom.mode;
  const color = which === "top" ? strips.top.color : strips.bottom.color;
  const showLevels = which !== "top" && strips.bottom.mode !== 0;

  const set = (patch: { mode?: number; color?: number }, final = true) => {
    const next = { ...strips, follow: patch.color !== undefined ? false : strips.follow };
    if (which !== "top") next.bottom = { ...strips.bottom, ...patch };
    if (which !== "bottom") next.top = { ...strips.top, ...patch };
    onChange(next, final);
  };
  const setBottom = (patch: Partial<KeyboardStrips["bottom"]>, final: boolean) =>
    onChange({ ...strips, bottom: { ...strips.bottom, ...patch } }, final);

  return (
    <section className="lights-module">
      <div className="lights-editor-head">
        <span className="lights-module-title">
          <span className="lights-n">01</span>MODO · TIRAS DEL TECLADO
        </span>
        <span className="lights-hint-small">{MODE_HINTS[mode] ?? ""} Cada cambio hace parpadear el teclado un instante.</span>
      </div>
      <div className="lights-seg lights-strips-which" role="radiogroup" aria-label="Qué tiras">
        {(Object.keys(WHICH_NAMES) as Which[]).map((k) => (
          <button key={k} role="radio" aria-checked={which === k} className={which === k ? "on" : ""} onClick={() => setWhich(k)}>
            {WHICH_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="lights-gallery" role="radiogroup" aria-label="Modo de las tiras">
        {STRIP_MODES.map((name, i) => (
          <button
            key={name}
            role="radio"
            aria-checked={mode === i}
            className={`lights-fx ${mode === i ? "sel" : ""}`}
            onClick={() => set({ mode: i })}
          >
            <canvas ref={thumbRef(`strip:${i}:${which}`)} width={144} height={88} aria-hidden="true" />
            <span>{name}</span>
          </button>
        ))}
      </div>

      {showLevels && (
        <div className="lights-section">
          <span className="lights-module-title">
            <span className="lights-n">02</span>AJUSTES · ABAJO
          </span>
          <div className="lights-params">
            <StepSlider
              label="Brillo"
              value={strips.bottom.brightness}
              max={STRIP_BRIGHTNESS_MAX}
              display={(v) => `${v + 1} de ${STRIP_BRIGHTNESS_MAX + 1}`}
              onChange={(brightness, final) => setBottom({ brightness }, final)}
            />
            {strips.bottom.mode !== 3 && (
              <StepSlider
                label="Velocidad"
                value={strips.bottom.speed}
                max={STRIP_SPEED_MAX}
                display={(v) => SPEED_NAMES[v]}
                onChange={(speed, final) => setBottom({ speed }, final)}
              />
            )}
          </div>
        </div>
      )}

      {stripUsesColor(mode) && (
        <div className="lights-section">
          <span className="lights-module-title">
            <span className="lights-n">{showLevels ? "03" : "02"}</span>COLOR
          </span>
          <div className="lights-colors" role="radiogroup" aria-label="Color de las tiras">
            <span className="lights-colors-label">{strips.follow ? "SIGUE A LA ESCENA" : "SUS 7 COLORES"}</span>
            {STRIP_COLORS.map((c, i) => (
              <button
                key={c.name}
                role="radio"
                aria-checked={color === i}
                className={`lights-chip ${color === i ? "sel" : ""}`}
                style={{ background: c.hex }}
                title={c.name}
                aria-label={c.name}
                onClick={() => set({ color: i })}
              />
            ))}
          </div>
          <div className="lights-fanopts-row">
            <span className="lights-param-label">Igual que el grupo Periféricos (el más parecido de los 7)</span>
            <button
              className={`lights-switch lights-switch-small ${strips.follow ? "on" : ""}`}
              onClick={() => onChange({ ...strips, follow: !strips.follow }, true)}
              aria-pressed={!!strips.follow}
              aria-label="Color igual que el grupo Periféricos"
            >
              <span className="lights-switch-knob" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Un deslizador de pocos pasos con el mismo aspecto que los de los efectos.
function StepSlider({
  label,
  value,
  max,
  display,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  display: (v: number) => string;
  onChange: (v: number, final: boolean) => void;
}) {
  return (
    <label className="lights-param">
      <span className="lights-param-row">
        <span className="lights-param-label">{label}</span>
        <span className="lights-param-value">{display(value)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
      />
    </label>
  );
}
