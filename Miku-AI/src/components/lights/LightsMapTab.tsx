import { useRef, useState } from "react";
import { rgbCss } from "../../lib/lightEffects";
import { RgbDevice, RgbZone, Scene, deviceKeys, deviceTitle, isResizable, zoneKey, zoneLabel, zoneOptions } from "../../lib/lights";

type Rgb = [number, number, number];

type LightsMapTabProps = {
  devices: RgbDevice[];
  scene: Scene;
  frame: Record<string, Rgb[]>;
  onScene: (scene: Scene, final: boolean) => void;
};

type Shape = "fan" | "ram" | "chip" | "keyboard" | "mic" | "strip";
type MapZone = { key: string; device: RgbDevice; zone: RgbZone; shape: Shape; inside: boolean };

const DARK: Rgb = [22, 36, 39];

function shapeOf(device: RgbDevice, zone: RgbZone): Shape {
  if (isResizable(zone)) return "fan";
  if (device.kind === "RAM") return "ram";
  if (device.kind === "placa madre") return "chip";
  if (device.kind === "teclado") return "keyboard";
  if (device.kind === "micrófono") return "mic";
  return "strip";
}

// Dónde va cada zona si todavía no la moviste: dentro del gabinete la
// placa a la izquierda, la RAM al medio y los ventiladores a la derecha;
// afuera, el resto en columna.
function defaultLayout(zones: MapZone[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const count: Record<Shape, number> = { fan: 0, ram: 0, chip: 0, keyboard: 0, mic: 0, strip: 0 };
  for (const z of zones) {
    const n = count[z.shape]++;
    out[z.key] =
      z.shape === "chip"
        ? { x: 0.1, y: 0.3 + n * 0.25 }
        : z.shape === "ram"
          ? { x: 0.26 + n * 0.06, y: 0.35 }
          : z.shape === "fan"
            ? { x: 0.48 + n * 0.12, y: 0.4 }
            : z.shape === "keyboard"
              ? { x: 0.78, y: 0.72 }
              : z.shape === "mic"
                ? { x: 0.88, y: 0.22 }
                : { x: 0.8, y: 0.45 + n * 0.12 };
  }
  return out;
}

// Plantillas para empezar (PLAN.md §3.4): dónde van los conectores de
// ventiladores en el gabinete (y en algunas, la RAM y la placa). En el mapa la izquierda es la parte de atrás
// (donde está la placa) y la derecha el frente, así que la ola entra por
// atrás y sale por el frente. La RAM y la placa quedan donde siempre.
type Template = {
  id: string;
  name: string;
  fans: (n: number, total: number) => { x: number; y: number };
  others?: (zone: MapZone, n: number) => { x: number; y: number } | null;
};

const column = (x: number, n: number, total: number) => ({ x, y: total === 1 ? 0.45 : 0.18 + (n * 0.6) / Math.max(1, total - 1) });
const row = (y: number, n: number, total: number) => ({ x: total === 1 ? 0.6 : 0.36 + (n * 0.48) / Math.max(1, total - 1), y });

// Las tres de la maqueta aprobada (docs/luces-argb/maqueta.html). Cada
// una dice dónde van los conectores de ventiladores (en orden: el primero,
// el segundo...) y, si quiere, la RAM y la placa.
const TEMPLATES: Template[] = [
  {
    id: "3-front-1-back",
    name: "3 al frente + 1 atrás",
    // Hasta tres al frente, en columna; el cuarto (y los que sigan) atrás.
    fans: (n, total) => (n < 3 ? column(0.9, n, Math.min(3, total)) : { x: 0.08, y: 0.22 + (n - 3) * 0.2 }),
  },
  {
    id: "glass-tower",
    name: "Torre con vidrio",
    // Tres al frente, dos en el techo y uno atrás; la RAM y la placa a la
    // vista en el medio, como se ven por el vidrio.
    fans: (n, total) =>
      n < 3 ? column(0.9, n, Math.min(3, total)) : n < 5 ? row(0.1, n - 3, Math.min(2, total - 3)) : { x: 0.08, y: 0.3 },
    others: (z, n) => (z.shape === "ram" ? { x: 0.42 + n * 0.07, y: 0.32 } : z.shape === "chip" ? { x: 0.28, y: 0.52 + n * 0.18 } : null),
  },
  {
    id: "compact-desk",
    name: "Escritorio compacto",
    // Gabinete chico: los ventiladores juntos al frente, la RAM y la placa
    // pegadas a ellos.
    fans: (n, total) => ({ x: 0.84, y: total === 1 ? 0.5 : 0.3 + (n * 0.4) / Math.max(1, total - 1) }),
    others: (z, n) => (z.shape === "ram" ? { x: 0.5 + n * 0.07, y: 0.45 } : z.shape === "chip" ? { x: 0.32, y: 0.45 + n * 0.18 } : null),
  },
];

function templateLayout(template: Template, zones: MapZone[]): Record<string, { x: number; y: number }> {
  const out = defaultLayout(zones);
  const count: Record<Shape, number> = { fan: 0, ram: 0, chip: 0, keyboard: 0, mic: 0, strip: 0 };
  const fans = zones.filter((z) => z.shape === "fan");
  for (const z of zones) {
    const n = count[z.shape]++;
    const place = z.shape === "fan" ? template.fans(n, fans.length) : template.others?.(z, n);
    if (place) out[z.key] = place;
  }
  return out;
}

// Pestaña Mapa del panel Luces (PLAN.md §3.4): cada zona con su forma real
// -- el teclado con sus teclas y el micrófono de pie, como pidió Sebastián
// al aprobar la maqueta --, arrastrable a su lugar en el gabinete. La
// posición horizontal es por donde pasa la ola de un lado al otro.
export function LightsMapTab({ devices, scene, frame, onScene }: LightsMapTabProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ key: string; x: number; y: number } | null>(null);
  const keys = deviceKeys(devices);
  const excluded = new Set(scene.excluded ?? []);

  const zones: MapZone[] = devices.flatMap((device) =>
    device.zones
      .filter((zone) => zone.leds > 0)
      .map((zone) => {
        const shape = shapeOf(device, zone);
        return {
          key: zoneKey(keys.get(device.index)!, zone.name),
          device,
          zone,
          shape,
          inside: shape !== "keyboard" && shape !== "mic" && shape !== "strip",
        };
      }),
  );
  const auto = defaultLayout(zones);
  const posOf = (key: string) => (dragging?.key === key ? dragging : (scene.layout?.[key] ?? auto[key]));
  const colorsOf = (key: string, n: number): Rgb[] => Array.from({ length: n }, (_, i) => frame[key]?.[i] ?? DARK);

  function save(layout: Record<string, { x: number; y: number }>) {
    // El motor usa la x para la ola (positions); el mapa guarda las dos.
    const positions = Object.fromEntries(Object.entries(layout).map(([k, p]) => [k, p.x]));
    onScene({ ...scene, layout, positions }, true);
  }

  function startDrag(e: React.PointerEvent, key: string) {
    const stage = stageRef.current;
    if (!stage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(key);
    const rect = stage.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => ({
      key,
      x: Math.min(0.97, Math.max(0.03, (ev.clientX - rect.left) / rect.width)),
      y: Math.min(0.94, Math.max(0.06, (ev.clientY - rect.top) / rect.height)),
    });
    const target = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => setDragging(at(ev));
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      const end = at(ev);
      setDragging(null);
      save({ ...auto, ...scene.layout, [key]: { x: end.x, y: end.y } });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up, { once: true });
  }

  const sel = zones.find((z) => z.key === selected);
  const selOptions = sel ? zoneOptions(scene, sel.key) : null;

  return (
    <div className="lights-map">
      <div ref={stageRef} className="lights-map-stage">
        <div className="lights-map-case">
          <span className="lights-map-label">GABINETE</span>
        </div>
        <span className="lights-map-label lights-map-outside">FUERA</span>
        {zones.map((z) => {
          const p = posOf(z.key);
          return (
            <button
              key={z.key}
              className={`lights-map-item lights-map-${z.shape} ${selected === z.key ? "sel" : ""} ${excluded.has(z.key) ? "off" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onPointerDown={(e) => startDrag(e, z.key)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.05 : 0.01;
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
                if (!d) return;
                e.preventDefault();
                save({
                  ...auto,
                  ...scene.layout,
                  [z.key]: { x: Math.min(0.97, Math.max(0.03, p.x + d[0])), y: Math.min(0.94, Math.max(0.06, p.y + d[1])) },
                });
              }}
              aria-label={`${zoneLabel(z.zone)} de ${deviceTitle(z.device, devices)}: arrástralo o muévelo con las flechas`}
              title={`${deviceTitle(z.device, devices)} · ${zoneLabel(z.zone)}`}
            >
              <ZoneShape
                shape={z.shape}
                colors={colorsOf(z.key, z.zone.leds)}
                fans={Math.max(1, Math.min(zoneOptions(scene, z.key).fans, z.zone.leds))}
              />
              <span className="lights-map-name">
                {z.shape === "ram" ? deviceTitle(z.device, devices).replace("RAM · ", "") : zoneLabel(z.zone).replace("Conector ", "")}
              </span>
            </button>
          );
        })}
      </div>

      <aside className="lights-map-side">
        <span className="lights-module-title">ZONA ELEGIDA</span>
        {sel && selOptions ? (
          <>
            <span className="lights-zone-name">{zoneLabel(sel.zone)}</span>
            <span className="lights-zone-detail">{deviceTitle(sel.device, devices)}</span>
            {sel.shape === "fan" && (
              <>
                <button
                  className="m-btn m-btn-small"
                  onClick={() =>
                    onScene({ ...scene, zones: { ...scene.zones, [sel.key]: { ...selOptions, offset: selOptions.offset + 1 } } }, true)
                  }
                >
                  Rotar LED 1 ↻
                </button>
                <button
                  className={`m-btn m-btn-small ${selOptions.reverse ? "on" : ""}`}
                  onClick={() =>
                    onScene({ ...scene, zones: { ...scene.zones, [sel.key]: { ...selOptions, reverse: !selOptions.reverse } } }, true)
                  }
                >
                  Espejar
                </button>
              </>
            )}
          </>
        ) : (
          <span className="lights-zone-detail">Toca una zona del mapa.</span>
        )}
        <span className="lights-module-title lights-map-templates-title">PLANTILLAS</span>
        <div className="lights-map-templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="m-btn m-btn-small"
              onClick={() => save(templateLayout(t, zones))}
              title="Acomoda los ventiladores así; después puedes moverlos"
            >
              {t.name}
            </button>
          ))}
          <button
            className="m-btn m-btn-small"
            onClick={() => {
              const rest = { ...scene };
              delete rest.layout;
              onScene({ ...rest, positions: {} }, true);
            }}
            disabled={!scene.layout}
          >
            Ordenar solo
          </button>
        </div>
        <p className="lights-zone-detail">
          Arrastra cada zona a su lugar real: la ola cruza el gabinete de izquierda a derecha según este mapa.
        </p>
      </aside>
    </div>
  );
}

function ZoneShape({ shape, colors, fans }: { shape: Shape; colors: Rgb[]; fans: number }) {
  const fill = (c: Rgb) => rgbCss(c);
  if (shape === "fan") {
    const per = Math.max(1, Math.floor(colors.length / fans));
    return (
      <span className="lights-map-fans">
        {Array.from({ length: fans }, (_, f) => {
          const own = colors.slice(f * per, f === fans - 1 ? colors.length : (f + 1) * per);
          return (
            <svg key={f} width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
              <circle cx="23" cy="23" r="19" fill="none" stroke="rgba(157,185,182,.25)" strokeWidth="4" />
              <circle cx="23" cy="23" r="5" fill="#122326" />
              {[0, 1, 2, 3, 4].map((b) => (
                <path key={b} d="M23 23 L23 9 A7 7 0 0 1 29 13 Z" fill="rgba(157,185,182,.18)" transform={`rotate(${b * 72} 23 23)`} />
              ))}
              {own.map((c, i) => {
                const a = -Math.PI / 2 + (i / own.length) * Math.PI * 2;
                return (
                  <circle
                    key={i}
                    cx={23 + Math.cos(a) * 19}
                    cy={23 + Math.sin(a) * 19}
                    r="3"
                    fill={fill(c)}
                    style={{ filter: `drop-shadow(0 0 3px ${fill(c)})` }}
                  />
                );
              })}
            </svg>
          );
        })}
      </span>
    );
  }
  if (shape === "ram") {
    return (
      <svg width="16" height="62" viewBox="0 0 16 62" aria-hidden="true">
        <rect x="1" y="1" width="14" height="60" rx="2" fill="#0E1B1D" stroke="rgba(157,185,182,.3)" />
        {colors.map((c, i) => (
          <rect
            key={i}
            x="4"
            y={4 + (i * 30) / Math.max(1, colors.length)}
            width="8"
            height={Math.max(2, 28 / Math.max(1, colors.length))}
            rx="1"
            fill={fill(c)}
          />
        ))}
      </svg>
    );
  }
  if (shape === "chip") {
    return (
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect x="5" y="5" width="20" height="20" rx="3" fill="#122326" stroke="rgba(157,185,182,.35)" />
        {[9, 15, 21].map((p) => (
          <g key={p} stroke="rgba(157,185,182,.35)">
            <line x1={p} y1="1" x2={p} y2="5" />
            <line x1={p} y1="25" x2={p} y2="29" />
          </g>
        ))}
        <circle
          cx="15"
          cy="15"
          r="5"
          fill={fill(colors[0] ?? DARK)}
          style={{ filter: `drop-shadow(0 0 4px ${fill(colors[0] ?? DARK)})` }}
        />
      </svg>
    );
  }
  if (shape === "keyboard") {
    // Teclado de verdad: filas de teclas con la barra espaciadora.
    const cols = 17;
    const rows = Math.ceil(colors.length / cols);
    return (
      <svg width={cols * 9 + 8} height={rows * 9 + 8} viewBox={`0 0 ${cols * 9 + 8} ${rows * 9 + 8}`} aria-hidden="true">
        <rect x="0.5" y="0.5" width={cols * 9 + 7} height={rows * 9 + 7} rx="5" fill="#0E1B1D" stroke="rgba(157,185,182,.35)" />
        {colors.map((c, i) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const isSpace = row === rows - 1 && col >= 5 && col <= 10;
          if (isSpace && col !== 5) return null;
          return <rect key={i} x={4 + col * 9} y={4 + row * 9} width={isSpace ? 9 * 6 - 1.5 : 7.5} height="7.5" rx="1.5" fill={fill(c)} />;
        })}
      </svg>
    );
  }
  if (shape === "mic") {
    // Micrófono de pie: la cápsula con sus luces, el soporte y la base.
    return (
      <svg width="34" height="70" viewBox="0 0 34 70" aria-hidden="true">
        <rect x="8" y="2" width="18" height="34" rx="9" fill="#0E1B1D" stroke="rgba(157,185,182,.4)" />
        {colors.map((c, i) => (
          <circle
            key={i}
            cx="17"
            cy={11 + i * (16 / Math.max(1, colors.length - 1))}
            r="5"
            fill={fill(c)}
            style={{ filter: `drop-shadow(0 0 4px ${fill(c)})` }}
          />
        ))}
        <path d="M5 26 a12 12 0 0 0 24 0" fill="none" stroke="rgba(157,185,182,.4)" strokeWidth="2" />
        <line x1="17" y1="38" x2="17" y2="62" stroke="rgba(157,185,182,.4)" strokeWidth="2" />
        <rect x="6" y="62" width="22" height="5" rx="2.5" fill="rgba(157,185,182,.35)" />
      </svg>
    );
  }
  return (
    <svg width="60" height="12" viewBox="0 0 60 12" aria-hidden="true">
      {colors.slice(0, 10).map((c, i) => (
        <circle key={i} cx={5 + i * 5.5} cy="6" r="2.5" fill={fill(c)} />
      ))}
    </svg>
  );
}
