import { useEffect, useRef, useState } from "react";
import { drawRingThumb, reduceMotion } from "../../lib/lightEffects";
import {
  BLEND_NAMES,
  CATEGORIES,
  COLOR_PALETTES,
  CategoryId,
  DEFAULT_EFFECT_COLORS,
  EFFECT_HINTS,
  EFFECT_KINDS,
  EFFECT_NAMES,
  MAX_EFFECT_COLORS,
  MUSIC_MODES,
  Effect,
  EffectKind,
  Layer,
  LayerBlend,
  REACTIVE_KINDS,
  Scene,
  categoryEffect,
  categoryLayers,
  makeEffect,
  normalizeHex,
} from "../../lib/lights";
import type { MikuEffect } from "../../lib/mikuLights";
import { KeyboardStrips, describeStrips } from "../../lib/lights";
import { StripsEditor, drawStripsThumb } from "./LightsStripsCard";

// "strips": las tiras del teclado AULA (su propio editor, ver LightsStripsCard).
type Selection = CategoryId | "all" | "strips";

type LightsSceneTabProps = {
  scene: Scene;
  selected: Selection;
  onSelect: (group: Selection) => void;
  // Cambia el efecto del grupo elegido. `final`: el cambio terminó (soltar
  // un deslizador, un clic): ahí se anota para deshacer.
  onChange: (effect: Effect, final: boolean) => void;
  // Las capas del grupo elegido (fase 4).
  onLayersChange: (layers: Layer[], final: boolean) => void;
  recentColors: string[];
  zoneCounts: Record<CategoryId, number>;
  // Los efectos que diseñó Miku (fase 6), en su propia sección de la galería.
  mikuEffects: MikuEffect[];
  onDeleteMikuEffect: (id: string) => void;
  // Las tiras del teclado, o null si no hay teclado AULA.
  strips: KeyboardStrips | null;
  onStrips: (next: KeyboardStrips, final: boolean) => void;
};

// Qué ajustes usa cada efecto (el resto se esconde).
const USES: Record<EffectKind, { speed: boolean; size: boolean; direction: boolean; colors: boolean }> = {
  static: { speed: false, size: false, direction: false, colors: true },
  breathe: { speed: true, size: false, direction: false, colors: true },
  heartbeat: { speed: true, size: false, direction: false, colors: true },
  flow: { speed: true, size: true, direction: true, colors: true },
  rainbow: { speed: true, size: false, direction: true, colors: true },
  wave: { speed: true, size: true, direction: true, colors: true },
  comet: { speed: true, size: true, direction: true, colors: true },
  sparkle: { speed: false, size: true, direction: false, colors: true },
  fire: { speed: true, size: false, direction: false, colors: true },
  // El tamaño solo cuenta en "Golpe" (cuánto dura el pulso).
  music: { speed: false, size: true, direction: false, colors: true },
  voice: { speed: false, size: false, direction: false, colors: true },
  mood: { speed: false, size: false, direction: false, colors: true },
  // Los colores son los de fuera de un juego (con "Solo en juegos").
  screen: { speed: false, size: false, direction: false, colors: true },
  notify: { speed: false, size: false, direction: false, colors: true },
};

const BADGES: Partial<Record<EffectKind, string>> = {
  music: "REACTIVO",
  screen: "REACTIVO",
  notify: "REACTIVO",
  voice: "MIKU",
  mood: "MIKU",
};

const PALETTE = [
  { hex: "#39C5BB", name: "Turquesa Miku" },
  { hex: "#F0508F", name: "Rosa" },
  { hex: "#FFFFFF", name: "Blanco" },
  { hex: "#8A5CF6", name: "Violeta" },
  { hex: "#2F6BFF", name: "Azul" },
  { hex: "#3DDC84", name: "Verde" },
  { hex: "#FFD166", name: "Amarillo" },
  { hex: "#FF8A3D", name: "Naranja" },
  { hex: "#FF3B3B", name: "Rojo" },
];
const MAX_COLORS = MAX_EFFECT_COLORS;

// Al elegir Fuego o Arcoíris arrancan con su paleta (con los colores de otro
// efecto no se reconocerían); el resto conserva los que había.
const withKind = (effect: Effect, kind: EffectKind): Effect =>
  kind !== effect.kind && DEFAULT_EFFECT_COLORS[kind] ? { ...effect, kind, colors: DEFAULT_EFFECT_COLORS[kind]! } : { ...effect, kind };

// Pestaña Escena del panel Luces (PLAN.md §3.2): los grupos a la
// izquierda, y a la derecha el efecto del grupo elegido con sus ajustes.
export function LightsSceneTab({
  scene,
  selected,
  onSelect,
  onChange,
  onLayersChange,
  recentColors,
  zoneCounts,
  mikuEffects,
  onDeleteMikuEffect,
  strips,
  onStrips,
}: LightsSceneTabProps) {
  const group = selected === "strips" ? "all" : selected;
  const effect = categoryEffect(scene, group);
  const layers = categoryLayers(scene, group);
  const uses = USES[effect.kind];
  // Qué color del degradado se está editando.
  const [stop, setStop] = useState(0);
  const thumbs = useRef(new Map<string, HTMLCanvasElement>());
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const mikuRef = useRef(mikuEffects);
  mikuRef.current = mikuEffects;
  const stripsRef = useRef(strips);
  stripsRef.current = strips;

  useEffect(() => setStop(0), [selected]);

  // Miniaturas animadas (las de los grupos y las de la galería).
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      // "Reducir movimiento" de Windows: las miniaturas quedan quietas.
      const t = reduceMotion() ? 0 : (now - start) / 1000;
      for (const [id, canvas] of thumbs.current) {
        const [kind, value] = id.split(":");
        if (kind === "group") drawRingThumb(canvas, categoryEffect(sceneRef.current, value as CategoryId | "all"), id, t);
        else if (kind === "layer") {
          const layer = categoryLayers(sceneRef.current, selectedRef.current === "strips" ? "all" : selectedRef.current)[Number(value)];
          if (layer) drawRingThumb(canvas, layer.effect, id, t);
        } else if (kind === "strip" || kind === "stripgroup") {
          const s = stripsRef.current;
          if (s) {
            const [, mode, which] = id.split(":");
            drawStripsThumb(canvas, s, t, kind === "strip" ? { mode: Number(mode), which: which as "both" | "bottom" | "top" } : undefined);
          }
        } else if (kind === "miku") {
          const own = mikuRef.current.find((e) => e.id === value);
          if (own) drawRingThumb(canvas, own.effect, id, t);
        } else
          drawRingThumb(canvas, { ...withKind(effectRef.current, value as EffectKind), brightness: 100 }, id, t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const thumbRef = (id: string) => (el: HTMLCanvasElement | null) => {
    if (el) thumbs.current.set(id, el);
    else thumbs.current.delete(id);
  };

  const update = (patch: Partial<Effect>, final = true) => onChange({ ...effect, ...patch }, final);
  const colors = effect.colors.length > 0 ? effect.colors : ["#39C5BB"];
  const current = Math.min(stop, colors.length - 1);
  const setColor = (hex: string, final = true) => {
    const next = [...colors];
    next[current] = normalizeHex(hex);
    update({ colors: next }, final);
  };

  const groups: { id: CategoryId | "all"; name: string; count: number }[] = [
    {
      id: "all",
      name: "Todo",
      count: Object.values(zoneCounts).reduce((a, b) => a + b, 0),
    },
    ...CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      count: zoneCounts[c.id],
    })),
  ];

  return (
    <div className="lights-scene">
      <div className="lights-groups" role="listbox" aria-label="Grupos">
        {groups.map((g) => {
          const fx = categoryEffect(scene, g.id);
          const mixed = g.id === "all" && CATEGORIES.some((c) => JSON.stringify(categoryEffect(scene, c.id)) !== JSON.stringify(fx));
          return (
            <button
              key={g.id}
              role="option"
              aria-selected={selected === g.id}
              className={`lights-group ${selected === g.id ? "sel" : ""}`}
              onClick={() => onSelect(g.id)}
              disabled={g.count === 0}
              title={g.count === 0 ? "No hay luces de este tipo" : undefined}
            >
              <canvas ref={thumbRef(`group:${g.id}`)} width={60} height={60} aria-hidden="true" />
              <span className="lights-group-text">
                <span className="lights-group-name">{g.name}</span>
                <span className="lights-group-fx">{g.count === 0 ? "Sin luces" : mixed ? "Mezcla de efectos" : EFFECT_NAMES[fx.kind]}</span>
              </span>
            </button>
          );
        })}
        {strips && (
          <button
            role="option"
            aria-selected={selected === "strips"}
            className={`lights-group ${selected === "strips" ? "sel" : ""}`}
            onClick={() => onSelect("strips")}
          >
            <canvas ref={thumbRef("stripgroup:x")} width={60} height={60} aria-hidden="true" />
            <span className="lights-group-text">
              <span className="lights-group-name">Tiras</span>
              <span className="lights-group-fx">
                {strips.bottom.mode === 0 && strips.top.mode === 0 ? "Apagadas" : describeStrips(strips)}
              </span>
            </span>
          </button>
        )}
      </div>

      <div className="lights-editor">
        {selected === "strips" && strips ? (
          <StripsEditor strips={strips} onChange={onStrips} thumbRef={thumbRef} />
        ) : (
          <section className="lights-module">
            <div className="lights-editor-head">
              <span className="lights-module-title">
                <span className="lights-n">01</span>EFECTO · {groups.find((g) => g.id === selected)?.name.toUpperCase()}
              </span>
              <span className="lights-hint-small">{EFFECT_HINTS[effect.kind]}</span>
            </div>
            {[
              {
                label: "BÁSICOS",
                kinds: EFFECT_KINDS.filter((k) => !REACTIVE_KINDS.includes(k)),
              },
              { label: "REACTIVOS", kinds: REACTIVE_KINDS },
            ].map((section) => (
              <div key={section.label}>
                <span className="lights-colors-label">{section.label}</span>
                <div className="lights-gallery" role="radiogroup" aria-label={`Efectos ${section.label.toLowerCase()}`}>
                  {section.kinds.map((kind) => (
                    <button
                      key={kind}
                      role="radio"
                      aria-checked={effect.kind === kind}
                      className={`lights-fx ${effect.kind === kind ? "sel" : ""}`}
                      onClick={() => onChange(withKind(effect, kind), true)}
                    >
                      <canvas ref={thumbRef(`fx:${kind}`)} width={144} height={88} aria-hidden="true" />
                      <span>{EFFECT_NAMES[kind]}</span>
                      {BADGES[kind] && <span className="lights-fx-badge">{BADGES[kind]}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {mikuEffects.length > 0 && (
              <div>
                <span className="lights-colors-label">SUYOS</span>
                <div className="lights-gallery" role="radiogroup" aria-label="Efectos que diseñó Miku">
                  {mikuEffects.map((own) => {
                    const on = JSON.stringify(own.effect) === JSON.stringify(effect);
                    return (
                      <div key={own.id} className="lights-fx-wrap">
                        <button
                          role="radio"
                          aria-checked={on}
                          className={`lights-fx ${on ? "sel" : ""}`}
                          onClick={() => onChange(own.effect, true)}
                          title={`${own.description || own.name} · lo diseñó el ${own.created}`}
                        >
                          <canvas ref={thumbRef(`miku:${own.id}`)} width={144} height={88} aria-hidden="true" />
                          <span>{own.name}</span>
                          <span className="lights-fx-badge">DISEÑADO POR ELLA</span>
                        </button>
                        <button
                          className="lights-fx-delete"
                          onClick={() => onDeleteMikuEffect(own.id)}
                          aria-label={`Borrar el efecto ${own.name}`}
                          title="Borrar este efecto suyo"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="lights-section">
              <span className="lights-module-title">
                <span className="lights-n">02</span>AJUSTES
              </span>
              <div className="lights-params">
                {uses.speed && (
                  <Slider label="Velocidad" value={effect.speed} min={1} max={100} onChange={(v, f) => update({ speed: v }, f)} />
                )}
                <Slider
                  label="Brillo del grupo"
                  value={effect.brightness}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(v, f) => update({ brightness: v }, f)}
                />
                {uses.size && !(effect.kind === "music" && effect.mode) && (
                  <Slider
                    label={
                      effect.kind === "sparkle"
                        ? "Cantidad"
                        : effect.kind === "comet"
                          ? "Estela"
                          : effect.kind === "music"
                            ? "Duración del golpe"
                            : effect.kind === "flow"
                              ? "Largo del degradado"
                              : "Ancho"
                    }
                    value={effect.size}
                    min={1}
                    max={100}
                    onChange={(v, f) => update({ size: v }, f)}
                  />
                )}
                {effect.kind === "music" && (
                  <div className="lights-param">
                    <span className="lights-param-label">Modo</span>
                    <div className="lights-seg" role="radiogroup" aria-label="Modo de la música">
                      {MUSIC_MODES.map((m) => (
                        <button
                          key={m.id}
                          role="radio"
                          aria-checked={(effect.mode ?? "") === m.id}
                          className={(effect.mode ?? "") === m.id ? "on" : ""}
                          onClick={() => update({ mode: m.id })}
                          title={m.hint}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {effect.kind === "screen" && (
                  <div className="lights-param">
                    <span className="lights-param-label">Solo en juegos</span>
                    <div className="lights-fanopts-row">
                      <span className="lights-zone-detail">Fuera de un juego, sus colores quietos</span>
                      <button
                        className={`lights-switch lights-switch-small ${effect.mode === "juegos" ? "on" : ""}`}
                        onClick={() => update({ mode: effect.mode === "juegos" ? "" : "juegos" })}
                        aria-pressed={effect.mode === "juegos"}
                        aria-label="Pantalla solo en juegos"
                      >
                        <span className="lights-switch-knob" />
                      </button>
                    </div>
                  </div>
                )}
                {uses.direction && (
                  <div className="lights-param">
                    <span className="lights-param-label">Dirección</span>
                    <div className="lights-dir">
                      <button className={`m-btn m-btn-small ${effect.direction < 0 ? "on" : ""}`} onClick={() => update({ direction: -1 })}>
                        ← Izquierda
                      </button>
                      <button className={`m-btn m-btn-small ${effect.direction > 0 ? "on" : ""}`} onClick={() => update({ direction: 1 })}>
                        Derecha →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {uses.colors && (
              <div className="lights-section">
                <span className="lights-module-title">
                  <span className="lights-n">03</span>COLORES
                </span>
                <div className="lights-gradient-row">
                  <div
                    className="lights-gradient"
                    style={{
                      background: colors.length > 1 ? `linear-gradient(90deg, ${colors.join(", ")})` : colors[0],
                    }}
                    title="Doble clic agrega un color"
                    onDoubleClick={() => {
                      if (colors.length >= MAX_COLORS) return;
                      update({ colors: [...colors, colors[colors.length - 1]] });
                      setStop(colors.length);
                    }}
                  >
                    {colors.map((c, i) => (
                      <button
                        key={i}
                        className={`lights-stop ${i === current ? "sel" : ""}`}
                        style={{
                          left: `${colors.length > 1 ? (i / (colors.length - 1)) * 100 : 50}%`,
                          ["--c" as string]: c,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStop(i);
                        }}
                        aria-label={`Color ${i + 1}: ${c}`}
                        aria-pressed={i === current}
                      />
                    ))}
                  </div>
                  <button
                    className="m-btn m-btn-small"
                    onClick={() => {
                      update({ colors: [...colors, colors[current]] });
                      setStop(colors.length);
                    }}
                    disabled={colors.length >= MAX_COLORS}
                    title="Agregar un color"
                  >
                    + Color
                  </button>
                  <button
                    className="m-btn m-btn-small"
                    onClick={() => {
                      update({ colors: colors.filter((_, i) => i !== current) });
                      setStop(Math.max(0, current - 1));
                    }}
                    disabled={colors.length <= 1}
                    title="Quitar el color elegido"
                  >
                    Quitar
                  </button>
                </div>
                <div className="lights-colors">
                  <span className="lights-colors-label">COLOR {current + 1}</span>
                  {PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      className={`lights-chip ${colors[current] === c.hex ? "sel" : ""}`}
                      style={{ background: c.hex }}
                      onClick={() => setColor(c.hex)}
                      aria-label={c.name}
                      title={c.name}
                    />
                  ))}
                  <label className="lights-chip lights-chip-custom" title="Otro color">
                    <input
                      type="color"
                      value={colors[current].toLowerCase()}
                      onChange={(e) => setColor(e.target.value, false)}
                      onBlur={(e) => setColor(e.target.value)}
                      aria-label="Otro color"
                    />
                  </label>
                  <HexInput value={colors[current]} onCommit={(hex) => setColor(hex)} />
                </div>
                <div className="lights-colors">
                  <span className="lights-colors-label">PALETAS</span>
                  {COLOR_PALETTES.map((p) => (
                    <button
                      key={p.id}
                      className={`m-btn m-btn-small lights-palette ${JSON.stringify(colors) === JSON.stringify(p.colors) ? "on" : ""}`}
                      onClick={() => {
                        update({ colors: p.colors });
                        setStop(0);
                      }}
                      title={`Poner los colores ${p.name}`}
                    >
                      <span className="lights-palette-swatch" style={{ background: `linear-gradient(90deg, ${p.colors.join(", ")})` }} aria-hidden="true" />
                      {p.name}
                    </button>
                  ))}
                </div>
                {recentColors.length > 0 && (
                  <div className="lights-colors">
                    <span className="lights-colors-label">RECIENTES</span>
                    {recentColors.map((c) => (
                      <button
                        key={c}
                        className="lights-chip"
                        style={{ background: c }}
                        onClick={() => setColor(c)}
                        aria-label={`Reciente ${c}`}
                        title={c}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            <LayersEditor layers={layers} onChange={onLayersChange} thumbRef={thumbRef} />
          </section>
        )}
      </div>
    </div>
  );
}

// Capas del grupo (PLAN.md §2): efectos encima del de base. La más útil es
// "Avisos" (un destello con cada correo o recordatorio, invisible el resto
// del tiempo); por eso tiene su propio botón.
function LayersEditor({
  layers,
  onChange,
  thumbRef,
}: {
  layers: Layer[];
  onChange: (layers: Layer[], final: boolean) => void;
  thumbRef: (id: string) => (el: HTMLCanvasElement | null) => void;
}) {
  const set = (i: number, patch: Partial<Layer>, final = true) =>
    onChange(
      layers.map((l, k) => (k === i ? { ...l, ...patch } : l)),
      final,
    );
  const move = (i: number, d: number) => {
    const next = [...layers];
    const [l] = next.splice(i, 1);
    next.splice(i + d, 0, l);
    onChange(next, true);
  };
  const add = (layer: Layer) => onChange([...layers, layer], true);
  const hasNotify = layers.some((l) => l.effect.kind === "notify");
  return (
    <div className="lights-section">
      <div className="lights-editor-head">
        <span className="lights-module-title">
          <span className="lights-n">04</span>CAPAS
        </span>
        <div className="lights-zone-actions">
          {!hasNotify && (
            <button
              className="m-btn m-btn-small"
              onClick={() =>
                add({
                  effect: makeEffect("notify", ["#F0508F"]),
                  opacity: 100,
                  blend: "normal",
                  visible: true,
                })
              }
              title="Un destello rosa con cada aviso (correo, recordatorio, evento)"
            >
              + Avisos
            </button>
          )}
          <button
            className="m-btn m-btn-small"
            onClick={() =>
              add({
                effect: makeEffect("sparkle", ["#FFFFFF"], { size: 25 }),
                opacity: 60,
                blend: "add",
                visible: true,
              })
            }
          >
            + Capa
          </button>
        </div>
      </div>
      {layers.length === 0 ? (
        <span className="lights-hint-small lights-left">Sin capas: solo el efecto de base.</span>
      ) : (
        <ul className="lights-layers">
          {[...layers].reverse().map((layer, r) => {
            const i = layers.length - 1 - r;
            return (
              <li key={i} className={`lights-layer ${layer.visible ? "" : "hidden"}`}>
                <canvas ref={thumbRef(`layer:${i}`)} width={60} height={60} aria-hidden="true" />
                <select
                  className="lights-select lights-layer-fx"
                  value={layer.effect.kind}
                  onChange={(e) =>
                    set(i, { effect: withKind(layer.effect, e.target.value as EffectKind) })
                  }
                  aria-label="Efecto de la capa"
                >
                  {EFFECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EFFECT_NAMES[k]}
                    </option>
                  ))}
                </select>
                <label
                  className="lights-chip lights-layer-color"
                  style={{ background: layer.effect.colors[0] ?? "#FFFFFF" }}
                  title="Color de la capa"
                >
                  <input
                    type="color"
                    value={(layer.effect.colors[0] ?? "#FFFFFF").toLowerCase()}
                    onChange={(e) =>
                      set(
                        i,
                        {
                          effect: {
                            ...layer.effect,
                            colors: [normalizeHex(e.target.value), ...layer.effect.colors.slice(1)],
                          },
                        },
                        false,
                      )
                    }
                    onBlur={(e) =>
                      set(i, {
                        effect: {
                          ...layer.effect,
                          colors: [normalizeHex(e.target.value), ...layer.effect.colors.slice(1)],
                        },
                      })
                    }
                    aria-label="Color de la capa"
                  />
                </label>
                <div className="lights-layer-bottom">
                  <select
                    className="lights-select"
                    value={layer.blend}
                    onChange={(e) => set(i, { blend: e.target.value as LayerBlend })}
                    aria-label="Cómo se mezcla"
                  >
                    {(Object.keys(BLEND_NAMES) as LayerBlend[]).map((b) => (
                      <option key={b} value={b}>
                        {BLEND_NAMES[b]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={layer.opacity}
                    onChange={(e) => set(i, { opacity: Number(e.target.value) }, false)}
                    onPointerUp={(e) =>
                      set(i, {
                        opacity: Number((e.target as HTMLInputElement).value),
                      })
                    }
                    aria-label="Opacidad de la capa"
                    title={`Opacidad ${Math.round(layer.opacity)}%`}
                  />
                  <div className="lights-layer-actions">
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={() => move(i, 1)}
                      disabled={i === layers.length - 1}
                      aria-label="Subir la capa"
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Bajar la capa"
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      className={`m-btn m-btn-small m-btn-icon ${layer.visible ? "" : "on"}`}
                      onClick={() => set(i, { visible: !layer.visible })}
                      aria-pressed={!layer.visible}
                      aria-label={layer.visible ? "Ocultar la capa" : "Mostrar la capa"}
                      title={layer.visible ? "Ocultar" : "Mostrar"}
                    >
                      {layer.visible ? "◉" : "○"}
                    </button>
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={() =>
                        onChange(
                          layers.filter((_, k) => k !== i),
                          true,
                        )
                      }
                      aria-label="Quitar la capa"
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number, final: boolean) => void;
}) {
  return (
    <label className="lights-param">
      <span className="lights-param-row">
        <span className="lights-param-label">{label}</span>
        <span className="lights-param-value">
          {Math.round(value)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), false)}
        onPointerUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
        onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value), true)}
      />
    </label>
  );
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (/^#?[0-9a-f]{6}$/i.test(text.trim())) onCommit(normalizeHex(text));
    else setText(value);
  };
  return (
    <input
      className="lights-hex"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      aria-label="Color en hexadecimal"
      spellCheck={false}
    />
  );
}
