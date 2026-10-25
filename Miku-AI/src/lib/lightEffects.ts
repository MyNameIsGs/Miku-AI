import type { Effect } from "./lights";

// Los efectos de luz en TypeScript, iguales a los del motor (render en
// lights_engine.rs): solo para las miniaturas animadas del panel Luces. Lo
// que se ve en la vista previa grande no sale de acá: son los cuadros
// reales que manda el motor ("luces-cuadro").

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function gradientAt(colors: string[], t: number): Rgb {
  if (colors.length === 0) return [57, 197, 187];
  if (colors.length === 1) return hexToRgb(colors[0]);
  const x = (((t % 1) + 1) % 1) * colors.length;
  const i = Math.floor(x);
  return mix(hexToRgb(colors[i % colors.length]), hexToRgb(colors[(i + 1) % colors.length]), x - i);
}

function hue(h: number): Rgb {
  const f = (n: number) => {
    const k = (n + (((h % 1) + 1) % 1) * 6) % 6;
    return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

// Destellos: estado por miniatura y LED, con su propio azar.
const sparkles = new Map<string, { until: number; on: boolean; color: number }>();

export function effectColor(effect: Effect, id: string, pos: number, i: number, n: number, t: number): Rgb {
  const sp = Math.max(1, effect.speed) / 50;
  const along = n > 1 ? i / n : 0;
  const dir = effect.direction < 0 ? -1 : 1;
  const colors = effect.colors;
  switch (effect.kind) {
    case "breathe": {
      const k = (Math.sin(t * sp * 2) + 1) / 2;
      const which = Math.floor((t * sp) / Math.PI) / Math.max(1, colors.length);
      return gradientAt(colors, which).map((x) => x * (0.12 + 0.88 * k)) as Rgb;
    }
    case "heartbeat": {
      const p = (((t * sp * 0.8) % 1) + 1) % 1;
      const pulse = (c: number) => Math.exp(-(((p - c) / 0.06) ** 2));
      const k = Math.min(1, pulse(0.1) + 0.65 * pulse(0.32));
      return gradientAt(colors, 0).map((x) => x * (0.08 + 0.92 * k)) as Rgb;
    }
    case "rainbow":
      return hue(t * sp * 0.15 + along * dir);
    case "flow": {
      const stretch = 0.3 + effect.size / 60;
      return gradientAt(colors, along / stretch - t * sp * 0.2 * dir);
    }
    case "wave": {
      const width = 0.15 + effect.size / 120;
      return gradientAt(colors, (pos + along * 0.12) / width - t * sp * 0.35 * dir);
    }
    case "comet": {
      const head = (((t * sp * 0.8 * dir) % 1) + 1) % 1;
      let d = (((along - head) % 1) + 1) % 1;
      if (dir > 0) d = (((1 - d) % 1) + 1) % 1;
      const tail = Math.max(0, 1 - d * (6 - effect.size / 25));
      return gradientAt(colors, 0).map((x) => x * tail) as Rgb;
    }
    case "sparkle": {
      const key = `${id}:${i}`;
      let s = sparkles.get(key);
      if (!s || s.until < t) {
        s = { until: t + 0.2 + Math.random() * 1.4, on: Math.random() < effect.size / 160, color: Math.floor(Math.random() * Math.max(1, colors.length)) };
        sparkles.set(key, s);
      }
      return s.on && colors.length > 0 ? hexToRgb(colors[Math.min(s.color, colors.length - 1)]) : [0, 0, 0];
    }
    case "fire": {
      const f = 0.55 + 0.45 * Math.sin(t * 9 * sp + i * 1.7 + Math.sin(t * 3 + i));
      return mix([255, 60, 0], [255, 190, 40], f).map((x) => x * (0.5 + f / 2)) as Rgb;
    }
    // Reactivos: en las miniaturas no hay música ni voz de verdad, así que
    // se simulan (un golpe a 120 BPM, una voz hablando, un ánimo que va y
    // viene, una pantalla que cambia, un aviso cada tanto).
    case "music": {
      const beat = Math.floor(t / 0.5);
      const pulse = Math.exp(-((t % 0.5) * 1000) / (60 + effect.size * 4));
      return gradientAt(colors, beat / Math.max(1, colors.length) + (pos + along * 0.2) * 0.3).map((x) => x * (0.08 + 0.92 * pulse)) as Rgb;
    }
    case "voice": {
      const v = Math.abs(Math.sin(t * 7) * Math.sin(t * 2.3));
      return gradientAt(colors, 0).map((x) => x * (0.15 + 0.85 * v)) as Rgb;
    }
    case "mood": {
      const k = (Math.sin(t * 0.6) + 1) / 2;
      return mix(gradientAt(colors, 0), [255, 209, 102], k).map((x) => x * (0.45 + 0.45 * k)) as Rgb;
    }
    case "screen":
      return mix(hue(t * 0.05), [128, 128, 128], 0.35);
    case "notify": {
      const ms = (t % 2.5) * 1000;
      const amount = ms < 1400 ? Math.abs(Math.sin((ms / 1400) * Math.PI * 4)) * (1 - ms / 1400) : 0;
      return gradientAt(colors.length ? colors : ["#F0508F"], 0).map((x) => x * amount) as Rgb;
    }
    default:
      return gradientAt(colors, along);
  }
}

export const rgbCss = (c: readonly number[], alpha = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;

// Miniatura: un anillo de 12 LEDs con el efecto.
export function drawRingThumb(canvas: HTMLCanvasElement, effect: Effect, id: string, t: number) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#081113";
  g.fillRect(0, 0, w, h);
  const n = 12;
  const r = Math.min(w, h) * 0.32;
  for (let i = 0; i < n; i++) {
    const c = effectColor(effect, id, 0.5, i, n, t).map((x) => (x * effect.brightness) / 100);
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    g.fillStyle = rgbCss(c);
    g.shadowColor = rgbCss(c, 0.8);
    g.shadowBlur = 6;
    g.beginPath();
    g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, Math.max(2, r * 0.2), 0, Math.PI * 2);
    g.fill();
  }
  g.shadowBlur = 0;
}

// "Reducir movimiento" de Windows (Configuración > Accesibilidad > Efectos
// visuales > Efectos de animación): las miniaturas del panel quedan
// quietas. La vista previa de arriba sigue, porque es información.
let reduceQuery: MediaQueryList | null = null;
export function reduceMotion(): boolean {
  reduceQuery ??= typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  return reduceQuery?.matches ?? false;
}
