import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { IconClose, IconReload } from "./Icons";
import type { MotionPhase } from "../hooks/usePresenceMotion";
import {
  DEFAULT_GLOBAL,
  EFFECT_KINDS,
  EFFECT_NAMES,
  EffectKind,
  LightsGlobal,
  RgbDevice,
  RgbZone,
  Scene,
  allZoneKeys,
  deviceKeys,
  deviceTitle,
  effectOfZone,
  isResizable,
  listDevices,
  loadLightsState,
  makeEffect,
  normalizeHex,
  probeZone,
  resizeZone,
  rgbToHex,
  saveLightsState,
  sendGlobal,
  setPreview,
  setScene,
  withZoneEffect,
  zoneKey,
  zoneLabel,
} from "../lib/lights";

type LightsPanelProps = {
  onClose: () => void;
  motion?: MotionPhase;
};

// Colores rápidos: los de Miku primero.
const PALETTE = [
  { hex: "#39C5BB", name: "Turquesa Miku" },
  { hex: "#F0508F", name: "Rosa" },
  { hex: "#FFFFFF", name: "Blanco" },
  { hex: "#8A5CF6", name: "Violeta" },
  { hex: "#2F6BFF", name: "Azul" },
  { hex: "#3DDC84", name: "Verde" },
  { hex: "#FF8A3D", name: "Naranja" },
  { hex: "#FF3B3B", name: "Rojo" },
];

// Asistente de los ventiladores: mientras se ajusta, todos los LEDs en
// turquesa y el último en rosa -- el número está bien cuando el rosa cae
// en el último LED del último ventilador enchufado a ese conector.
const SETUP_BODY = "#39C5BB";
const SETUP_LAST = "#F0508F";

// Orden de los dispositivos en el panel.
const KIND_ORDER = ["placa madre", "RAM", "tarjeta de video", "refrigeración", "tira LED", "gabinete", "teclado", "mouse", "micrófono"];

type FanSetup = { deviceIndex: number; zoneIndex: number; key: string; count: number; original: number };
type PreviewZone = { key: string; colors: [number, number, number][] };

// Panel de luces RGB. Fase 1 de docs/luces-argb/PLAN.md: además del color
// por zona y el asistente de ventiladores, un efecto para todo a la vez
// (lo dibuja el motor en Rust, lights_engine.rs), brillo general y el
// interruptor. La fase 2 lo reemplaza por el panel de la maqueta.
export function LightsPanel({ onClose, motion }: LightsPanelProps) {
  const [devices, setDevices] = useState<RgbDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scene, setSceneState] = useState<Scene | null>(null);
  const [global, setGlobalState] = useState<LightsGlobal>(DEFAULT_GLOBAL);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [setup, setSetup] = useState<FanSetup | null>(null);
  // Lo que están mostrando las luces ahora (primer LED de cada zona).
  const [live, setLive] = useState<Record<string, string>>({});
  // "Todo a la vez": efecto y dos colores.
  const [allKind, setAllKind] = useState<EffectKind>("static");
  const [allColors, setAllColors] = useState<[string, string]>(["#39C5BB", "#F0508F"]);
  const [allSpeed, setAllSpeed] = useState(50);
  const timers = useRef<Record<string, number>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [list, state] = await Promise.all([listDevices(), loadLightsState()]);
      setDevices(list);
      setSceneState(state.scene);
      setGlobalState(state.global);
      setSizes(state.sizes);
      // Si toda la escena es un solo grupo, "todo a la vez" arranca con él.
      const only = state.scene?.groups.length === 1 ? state.scene.groups[0].effect : null;
      if (only) {
        setAllKind(only.kind);
        setAllColors([only.colors[0] ?? "#39C5BB", only.colors[1] ?? only.colors[0] ?? "#F0508F"]);
        setAllSpeed(only.speed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    setPreview(true).catch(console.error);
    const unlisten = listen<PreviewZone[]>("luces-cuadro", (event) => {
      const next: Record<string, string> = {};
      for (const zone of event.payload) if (zone.colors[0]) next[zone.key] = rgbToHex(zone.colors[0]);
      setLive(next);
    });
    return () => {
      setPreview(false).catch(console.error);
      unlisten.then((u) => u());
    };
  }, []);

  const keys = devices ? deviceKeys(devices) : new Map<number, string>();
  const keyOf = (device: RgbDevice, zone: RgbZone) => zoneKey(keys.get(device.index) ?? device.name, zone.name);
  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  // Se manda como mucho cada 80 ms por cosa (los deslizadores y el selector
  // de color mandan cambios sin parar mientras se arrastran).
  function later(id: string, fn: () => void) {
    clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(fn, 80);
  }

  function updateScene(next: Scene) {
    setSceneState(next);
    later("scene", () => setScene(next).catch(fail));
  }

  function updateGlobal(next: LightsGlobal) {
    setGlobalState(next);
    later("global", async () => {
      try {
        await sendGlobal(next);
        const state = await loadLightsState();
        await saveLightsState({ ...state, global: next });
      } catch (err) {
        fail(err);
      }
    });
  }

  function applyAll(kind: EffectKind, colors: [string, string], speed: number) {
    if (!devices) return;
    const effectColors = kind === "static" ? [colors[0]] : colors;
    updateScene({ groups: [{ zones: allZoneKeys(devices), effect: makeEffect(kind, effectColors, { speed }) }], positions: scene?.positions ?? {} });
  }

  function setZoneColor(device: RgbDevice, zone: RgbZone, hex: string) {
    updateScene(withZoneEffect(scene, keyOf(device, zone), makeEffect("static", [normalizeHex(hex)])));
  }

  // --- Asistente de ventiladores ---

  function replaceDevice(updated: RgbDevice) {
    setDevices((list) => list?.map((d) => (d.index === updated.index ? updated : d)) ?? null);
  }

  async function showSetupCount(current: FanSetup, count: number) {
    const device = devices?.find((d) => d.index === current.deviceIndex);
    const zone = device?.zones.find((z) => z.index === current.zoneIndex);
    if (!device || !zone) return;
    try {
      replaceDevice(await resizeZone(device, zone, count));
      await probeZone(current.key, [...Array(Math.max(0, count - 1)).fill(SETUP_BODY), SETUP_LAST]);
    } catch (err) {
      fail(err);
    }
  }

  function startSetup(device: RgbDevice, zone: RgbZone) {
    const next = { deviceIndex: device.index, zoneIndex: zone.index, key: keyOf(device, zone), count: zone.leds > 0 ? zone.leds : 8, original: zone.leds };
    setSetup(next);
    showSetupCount(next, next.count);
  }

  function changeSetupCount(delta: number | null, exact?: number) {
    if (!setup) return;
    const zone = devices?.find((d) => d.index === setup.deviceIndex)?.zones.find((z) => z.index === setup.zoneIndex);
    if (!zone) return;
    const wanted = exact ?? setup.count + (delta ?? 0);
    const count = Math.max(Math.max(1, zone.ledsMin), Math.min(zone.ledsMax, Math.round(wanted)));
    if (count === setup.count) return;
    const next = { ...setup, count };
    setSetup(next);
    showSetupCount(next, count);
  }

  async function finishSetup(save: boolean) {
    if (!setup) return;
    const current = setup;
    setSetup(null);
    const device = devices?.find((d) => d.index === current.deviceIndex);
    const zone = device?.zones.find((z) => z.index === current.zoneIndex);
    if (!device || !zone) return;
    try {
      const size = save ? current.count : current.original;
      replaceDevice(await resizeZone(device, zone, size));
      await probeZone(current.key, null);
      const nextSizes = save ? { ...sizes, [current.key]: size } : sizes;
      setSizes(nextSizes);
      // Una zona nueva sin efecto: entra con el turquesa de Miku.
      let nextScene = scene;
      if (save && size > 0 && !effectOfZone(scene, current.key)) {
        nextScene = withZoneEffect(scene, current.key, makeEffect("static", Array.of(SETUP_BODY)));
        setSceneState(nextScene);
        await setScene(nextScene);
      }
      const state = await loadLightsState();
      await saveLightsState({ ...state, sizes: nextSizes, scene: nextScene });
    } catch (err) {
      fail(err);
    }
  }

  // Volver a empezar con un conector: 0 LEDs, sin tamaño guardado y fuera
  // de la escena (pedido de Sebastián: no había forma de deshacerlo).
  async function resetZone(device: RgbDevice, zone: RgbZone) {
    const key = keyOf(device, zone);
    try {
      replaceDevice(await resizeZone(device, zone, 0));
      const nextSizes = { ...sizes };
      delete nextSizes[key];
      setSizes(nextSizes);
      const nextScene = scene
        ? {
            ...scene,
            groups: scene.groups.map((g) => ({ ...g, zones: g.zones.filter((z) => z !== key) })).filter((g) => g.zones.length > 0),
          }
        : null;
      setSceneState(nextScene);
      if (nextScene) await setScene(nextScene);
      const state = await loadLightsState();
      await saveLightsState({ ...state, sizes: nextSizes, scene: nextScene });
    } catch (err) {
      fail(err);
    }
  }

  const sorted = [...(devices ?? [])].sort(
    (a, b) =>
      (KIND_ORDER.indexOf(a.kind) + 1 || 99) - (KIND_ORDER.indexOf(b.kind) + 1 || 99) || a.index - b.index,
  );

  return (
    <div className="m-panel lights-panel" data-motion={motion} role="dialog" aria-labelledby="lights-title">
      <div className="m-panel-header">
        <div className="m-panel-heading">
          <h2 id="lights-title" className="m-panel-title">
            Luces
          </h2>
          <span className="m-panel-tag">RGB</span>
        </div>
        <div className="lights-header-actions">
          <button
            className="m-btn m-btn-small m-btn-icon"
            onClick={refresh}
            disabled={loading}
            aria-label="Volver a buscar dispositivos"
            title="Volver a buscar dispositivos"
          >
            <IconReload size={16} />
          </button>
          <button className="m-panel-close" onClick={onClose} aria-label="Cerrar luces">
            <IconClose />
          </button>
        </div>
      </div>

      <div className="lights-global">
        <button
          className={`lights-switch ${global.on ? "on" : ""}`}
          onClick={() => updateGlobal({ ...global, on: !global.on })}
          aria-pressed={global.on}
          aria-label={global.on ? "Apagar todas las luces" : "Prender las luces"}
          title={global.on ? "Apagar todas las luces" : "Prender las luces"}
        >
          <span className="lights-switch-knob" />
        </button>
        <span className="lights-global-label">BRILLO</span>
        <input
          type="range"
          min={0}
          max={100}
          value={global.brightness}
          onChange={(e) => updateGlobal({ ...global, brightness: Number(e.target.value) })}
          aria-label="Brillo general"
        />
        <span className="lights-global-value">{global.brightness}%</span>
        <button className={`m-btn m-btn-small ${global.paused ? "on" : ""}`} onClick={() => updateGlobal({ ...global, paused: !global.paused })}>
          {global.paused ? "Seguir" : "Pausar"}
        </button>
      </div>

      <div className="m-panel-body">
        {error && (
          <div className="lights-error" role="alert">
            {error}
          </div>
        )}

        {devices === null && !error && <p className="lights-loading">Buscando las luces…</p>}

        {devices && devices.length === 0 && (
          <div className="m-empty">
            <p className="m-empty-title">OpenRGB no ve ninguna luz</p>
            <p className="m-empty-text">Puede estar todavía detectando: prueba de nuevo en unos segundos.</p>
          </div>
        )}

        {devices && devices.length > 0 && (
          <>
            <section className="lights-module lights-all" aria-label="Todas las luces">
              <div className="lights-module-title">TODO A LA VEZ</div>
              <div className="lights-effects" role="radiogroup" aria-label="Efecto">
                {EFFECT_KINDS.map((kind) => (
                  <button
                    key={kind}
                    role="radio"
                    aria-checked={allKind === kind}
                    className={`lights-effect ${allKind === kind ? "on" : ""}`}
                    onClick={() => {
                      setAllKind(kind);
                      applyAll(kind, allColors, allSpeed);
                    }}
                  >
                    {EFFECT_NAMES[kind]}
                  </button>
                ))}
              </div>
              <div className="lights-swatches">
                {PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    className="lights-swatch"
                    style={{ background: c.hex }}
                    onClick={() => {
                      const next: [string, string] = [c.hex, allColors[1]];
                      setAllColors(next);
                      applyAll(allKind, next, allSpeed);
                    }}
                    aria-label={`Color 1: ${c.name}`}
                    title={c.name}
                  />
                ))}
                {[0, 1].map((slot) => (
                  <label key={slot} className="lights-slot" title={`Color ${slot + 1}`}>
                    <span className="lights-slot-color" style={{ background: allColors[slot] }}>
                      <input
                        type="color"
                        value={allColors[slot].toLowerCase()}
                        onChange={(e) => {
                          const next: [string, string] = slot === 0 ? [normalizeHex(e.target.value), allColors[1]] : [allColors[0], normalizeHex(e.target.value)];
                          setAllColors(next);
                          applyAll(allKind, next, allSpeed);
                        }}
                        aria-label={`Color ${slot + 1}`}
                      />
                    </span>
                    <span className="lights-slot-label">{slot + 1}</span>
                  </label>
                ))}
              </div>
              {allKind !== "static" && (
                <div className="lights-speed">
                  <span className="lights-global-label">VELOCIDAD</span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={allSpeed}
                    onChange={(e) => {
                      setAllSpeed(Number(e.target.value));
                      applyAll(allKind, allColors, Number(e.target.value));
                    }}
                    aria-label="Velocidad del efecto"
                  />
                  <span className="lights-global-value">{allSpeed}</span>
                </div>
              )}
            </section>

            {sorted.map((device) => (
              <section key={device.index} className="lights-module" aria-label={deviceTitle(device, devices)}>
                <div className="lights-device-head">
                  <span className="lights-module-title">{device.kind.toUpperCase()}</span>
                  <span className="lights-device-name">{deviceTitle(device, devices)}</span>
                </div>
                <ul className="lights-zones">
                  {device.zones.map((zone) => {
                    const key = keyOf(device, zone);
                    const effect = effectOfZone(scene, key);
                    const shown = live[key] ?? effect?.colors[0] ?? "#39C5BB";
                    const resizable = isResizable(zone);
                    const inSetup = setup?.key === key;
                    return (
                      <li key={zone.index} className={`lights-zone ${inSetup ? "setup" : ""}`}>
                        <div className="lights-zone-main">
                          <label
                            className={`lights-zone-color ${zone.leds === 0 ? "empty" : ""}`}
                            style={zone.leds > 0 ? { background: shown } : undefined}
                            title={zone.leds > 0 ? "Cambiar color" : "Primero dile cuántos LEDs tiene"}
                          >
                            <input
                              type="color"
                              value={(effect?.colors[0] ?? "#39C5BB").toLowerCase()}
                              disabled={zone.leds === 0 || inSetup}
                              onChange={(e) => setZoneColor(device, zone, e.target.value)}
                              aria-label={`Color de ${zoneLabel(zone)}`}
                            />
                          </label>
                          <div className="lights-zone-text">
                            <span className="lights-zone-name">{zoneLabel(zone)}</span>
                            <span className="lights-zone-detail">
                              {resizable && zone.leds === 0
                                ? "Sin configurar: dile cuántos LEDs tiene lo enchufado"
                                : `${zone.leds} ${zone.leds === 1 ? "LED" : "LEDs"}${effect ? ` · ${EFFECT_NAMES[effect.kind]}` : ""}`}
                            </span>
                          </div>
                          {resizable && !inSetup && zone.leds > 0 && (
                            <button
                              className="m-btn m-btn-small"
                              onClick={() => resetZone(device, zone)}
                              disabled={setup !== null}
                              title="Dejar este conector sin configurar, para empezar de cero"
                            >
                              Desconfigurar
                            </button>
                          )}
                          {resizable && !inSetup && (
                            <button
                              className={`m-btn m-btn-small ${zone.leds === 0 ? "m-btn-primary" : ""}`}
                              onClick={() => startSetup(device, zone)}
                              disabled={setup !== null}
                            >
                              {zone.leds === 0 ? "Configurar" : "Ajustar LEDs"}
                            </button>
                          )}
                        </div>

                        {inSetup && setup && (
                          <div className="lights-setup">
                            <p className="lights-setup-text">
                              Mira lo que está enchufado a este conector: los LEDs se prenden en turquesa y el
                              último en <span className="lights-pink">rosa</span>. Ajusta el número hasta que el rosa
                              quede justo en el último LED del último ventilador. Si no se prende nada, no hay nada
                              enchufado aquí.
                            </p>
                            <div className="lights-stepper">
                              <button className="m-btn m-btn-small" onClick={() => changeSetupCount(-10)}>
                                −10
                              </button>
                              <button className="m-btn m-btn-small" onClick={() => changeSetupCount(-1)}>
                                −1
                              </button>
                              <input
                                className="lights-stepper-value"
                                type="number"
                                min={Math.max(1, zone.ledsMin)}
                                max={zone.ledsMax}
                                value={setup.count}
                                onChange={(e) => changeSetupCount(null, Number(e.target.value))}
                                aria-label="Cantidad de LEDs"
                              />
                              <button className="m-btn m-btn-small" onClick={() => changeSetupCount(1)}>
                                +1
                              </button>
                              <button className="m-btn m-btn-small" onClick={() => changeSetupCount(10)}>
                                +10
                              </button>
                              <span className="lights-stepper-unit">LEDs</span>
                            </div>
                            <div className="lights-setup-actions">
                              <button className="m-btn m-btn-small" onClick={() => finishSetup(false)}>
                                Cancelar
                              </button>
                              <button className="m-btn m-btn-small m-btn-primary" onClick={() => finishSetup(true)}>
                                Listo
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
