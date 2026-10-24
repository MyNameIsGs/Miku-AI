import { useEffect, useRef, useState } from "react";
import { rgbCss } from "../../lib/lightEffects";
import { RgbDevice, RgbZone, Scene, deviceKeys, isResizable, zoneKey, zoneLabel, deviceTitle, zoneOptions } from "../../lib/lights";

type Rgb = [number, number, number];

type LightsPreviewProps = {
  devices: RgbDevice[];
  // Para cuántos ventiladores hay en cada conector y qué zonas no se tocan.
  scene: Scene | null;
  // Lo que están mostrando las luces ahora, por zona (los cuadros del motor).
  frame: Record<string, Rgb[]>;
  selected: string | null;
  identifying: string | null;
  onSelect: (zoneKey: string | null) => void;
};

// Dónde quedó dibujada cada zona, para el mouse.
type Hit = { key: string; label: string; leds: number; x: number; y: number; w: number; h: number };

const W = 684;
const H = 132;
const S = 2; // el canvas va al doble para que se vea nítido

// Vista previa de las luces (docs/luces-argb/PLAN.md §3.1): el gabinete
// en esquema con lo que detecta OpenRGB -- cada ventilador como un anillo
// de sus LEDs, la RAM como barras, las luces de la placa, el teclado como
// grilla y el micrófono -- pintado con los cuadros reales del motor.
export function LightsPreview({ devices, scene, frame, selected, identifying, onSelect }: LightsPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const blink = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    blink.current += 1;
    draw(ctx, devices, scene, frame, selected, identifying, blink.current, hits.current);
  });

  function hitAt(e: React.MouseEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return hits.current.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) ?? null;
  }

  return (
    <div className="lights-preview-canvas">
      <canvas
        ref={canvasRef}
        width={W * S}
        height={H * S}
        aria-label="Vista previa en vivo de las luces"
        onMouseMove={(e) => {
          const h = hitAt(e);
          const r = canvasRef.current!.getBoundingClientRect();
          setTip(h ? { text: `${h.label} · ${h.leds} ${h.leds === 1 ? "LED" : "LEDs"}`, x: e.clientX - r.left + 14, y: e.clientY - r.top + 10 } : null);
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => onSelect(hitAt(e)?.key ?? null)}
      />
      {tip && (
        <div className="lights-preview-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  devices: RgbDevice[],
  scene: Scene | null,
  frame: Record<string, Rgb[]>,
  selected: string | null,
  identifying: string | null,
  tick: number,
  hits: Hit[],
) {
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, W, H);
  hits.length = 0;
  const keys = deviceKeys(devices);
  const keyOf = (d: RgbDevice, z: RgbZone) => zoneKey(keys.get(d.index)!, z.name);
  const colorsOf = (key: string, n: number): Rgb[] => {
    if (identifying === key) return Array(n).fill(Math.floor(tick / 8) % 2 ? [255, 255, 255] : [0, 0, 0]);
    const c = frame[key];
    return Array.from({ length: n }, (_, i) => c?.[i] ?? [22, 36, 39]);
  };

  const led = (x: number, y: number, r: number, c: Rgb) => {
    const lum = (c[0] + c[1] + c[2]) / 765;
    ctx.fillStyle = lum < 0.02 ? "#162427" : rgbCss(c);
    ctx.shadowColor = rgbCss(c, 0.9);
    ctx.shadowBlur = lum < 0.02 ? 0 : 7;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  };
  const label = (text: string, x: number, y: number) => {
    ctx.fillStyle = "#7E9B98";
    ctx.font = "600 9px 'Chakra Petch', monospace";
    ctx.fillText(text, x, y);
  };
  const addHit = (key: string, label: string, leds: number, x: number, y: number, w: number, h: number) =>
    hits.push({ key, label, leds, x, y, w, h });

  // El gabinete.
  ctx.strokeStyle = "rgba(157,185,182,.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(8, 6, 392, 118, 12);
  ctx.stroke();
  label("GABINETE", 18, 20);

  const board = devices.filter((d) => d.kind === "placa madre");
  const ram = devices.filter((d) => d.kind === "RAM").sort((a, b) => a.index - b.index);
  const outside = devices.filter((d) => d.kind !== "placa madre" && d.kind !== "RAM");

  // Placa: las luces de un LED como puntos a la izquierda.
  let dotY = 44;
  for (const d of board) {
    for (const z of d.zones.filter((z) => !isResizable(z) && z.leds > 0)) {
      const key = keyOf(d, z);
      const cs = colorsOf(key, z.leds);
      cs.forEach((c, i) => led(34 + i * 10, dotY, 6, c));
      label(zoneLabel(z).toUpperCase(), 48 + (z.leds - 1) * 10, dotY + 3);
      addHit(key, zoneLabel(z), z.leds, 22, dotY - 10, 110, 20);
      dotY += 30;
    }
  }

  // RAM: barras verticales.
  ram.forEach((d, k) => {
    for (const z of d.zones.filter((z) => z.leds > 0)) {
      const key = keyOf(d, z);
      const x = 168 + k * 22;
      ctx.fillStyle = "#0E1B1D";
      ctx.fillRect(x - 6, 22, 14, 92);
      const cs = colorsOf(key, z.leds);
      const step = 84 / Math.max(1, z.leds);
      cs.forEach((c, i) => led(x + 1, 28 + i * step, 3.4, c));
      addHit(key, deviceTitle(d, devices), z.leds, x - 8, 18, 18, 100);
    }
  });
  if (ram.length) label("RAM", 162, 122);

  // Ventiladores: un anillo por ventilador (un conector puede tener varios
  // encadenados, ver ZoneOptions.fans), en el orden físico de sus LEDs.
  const fans = board.flatMap((d) =>
    d.zones
      .filter((z) => isResizable(z) && z.leds > 0)
      .flatMap((z) => {
        const key = keyOf(d, z);
        const count = Math.max(1, Math.min(zoneOptions(scene, key).fans, z.leds));
        const per = Math.max(1, Math.floor(z.leds / count));
        return Array.from({ length: count }, (_, f) => ({ z, key, f, count, from: f * per, size: f === count - 1 ? z.leds - f * per : per }));
      }),
  );
  const ringR = fans.length > 2 ? 22 : 30;
  const ringGap = fans.length > 2 ? 52 : 74;
  fans.forEach(({ z, key, f, count, from, size }, k) => {
    const cx = (fans.length > 2 ? 250 : 268) + k * ringGap;
    const cy = 66;
    const r = ringR;
    ctx.strokeStyle = "rgba(157,185,182,.16)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const cs = colorsOf(key, z.leds).slice(from, from + size);
    cs.forEach((c, i) => {
      const a = -Math.PI / 2 + (i / size) * Math.PI * 2;
      led(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size > 16 ? 3 : 4, c);
    });
    const name = zoneLabel(z).replace("Conector ", "").toUpperCase();
    label(count > 1 ? `${name}·${f + 1}` : name, cx - (count > 1 ? 24 : 20), cy + 3);
    addHit(key, count > 1 ? `${zoneLabel(z)} · ventilador ${f + 1}` : zoneLabel(z), size, cx - r - 8, cy - r - 8, 2 * r + 16, 2 * r + 16);
  });
  if (fans.length === 0) label("SIN VENTILADORES CONFIGURADOS", 236, 70);

  // Afuera: teclado como grilla, micrófono de pie, el resto como tiras.
  let x0 = 414;
  for (const d of outside) {
    for (const z of d.zones.filter((z) => z.leds > 0)) {
      const key = keyOf(d, z);
      const cs = colorsOf(key, z.leds);
      if (d.kind === "teclado") {
        const cols = 17;
        const rows = Math.ceil(z.leds / cols);
        label("TECLADO", x0, 34);
        cs.forEach((c, i) => {
          ctx.fillStyle = rgbCss(c);
          ctx.shadowColor = rgbCss(c, 0.6);
          ctx.shadowBlur = 3;
          ctx.beginPath();
          ctx.roundRect(x0 + (i % cols) * 11, 40 + Math.floor(i / cols) * 11, 9, 9, 2);
          ctx.fill();
        });
        ctx.shadowBlur = 0;
        addHit(key, d.name, z.leds, x0 - 4, 36, cols * 11 + 6, rows * 11 + 8);
        x0 += cols * 11 + 22;
      } else if (d.kind === "micrófono") {
        const mx = x0 + 14;
        ctx.strokeStyle = "rgba(157,185,182,.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(mx - 14, 30, 28, 56, 14);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx, 86);
        ctx.lineTo(mx, 106);
        ctx.moveTo(mx - 12, 108);
        ctx.lineTo(mx + 12, 108);
        ctx.stroke();
        cs.forEach((c, i) => led(mx, 46 + i * (24 / Math.max(1, z.leds - 1)), 7, c));
        label("MIC", mx - 9, 122);
        addHit(key, d.name, z.leds, mx - 18, 26, 36, 86);
        x0 += 46;
      } else {
        label(d.name.toUpperCase().slice(0, 14), x0, 34);
        cs.slice(0, 12).forEach((c, i) => led(x0 + 6 + i * 8, 46, 3, c));
        addHit(key, d.name, z.leds, x0, 36, 100, 20);
        x0 += 110;
      }
    }
  }

  // La zona elegida, con un recuadro punteado.
  const sel = hits.find((h) => h.key === selected);
  if (sel) {
    ctx.strokeStyle = "#7FE3DA";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    ctx.setLineDash([]);
  }
}
