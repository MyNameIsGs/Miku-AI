import { useEffect, useRef, useState } from "react";
import { IconClose, IconReload } from "./Icons";
import type { MotionPhase } from "../hooks/usePresenceMotion";
import {
  RgbDevice,
  RgbZone,
  deviceKeys,
  deviceTitle,
  isResizable,
  listDevices,
  loadLightsState,
  normalizeHex,
  paintDevices,
  paintZone,
  resizeZone,
  saveLightsState,
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
const OFF = "#000000";

// Asistente de los ventiladores: mientras se ajusta, todos los LEDs en
// turquesa y el último en rosa -- el número está bien cuando el rosa cae
// en el último LED del último ventilador enchufado a ese conector.
const SETUP_BODY = "#39C5BB";
const SETUP_LAST = "#F0508F";

// Orden de los dispositivos en el panel.
const KIND_ORDER = ["placa madre", "RAM", "tarjeta de video", "refrigeración", "tira LED", "gabinete", "teclado", "mouse", "micrófono"];

type FanSetup = { deviceIndex: number; zoneIndex: number; count: number; original: number };

// Panel de luces RGB (2026-10-22, pedido de Sebastián): todos los
// dispositivos que ve OpenRGB con sus zonas, un color por zona, y el
// asistente para decirle a la placa cuántos LEDs tiene lo enchufado en cada
// conector ARGB. Mismo marco que los demás paneles (diseño v1 §4).
export function LightsPanel({ onClose, motion }: LightsPanelProps) {
  const [devices, setDevices] = useState<RgbDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [setup, setSetup] = useState<FanSetup | null>(null);
  const paintTimers = useRef<Record<string, number>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [list, state] = await Promise.all([listDevices(), loadLightsState()]);
      setDevices(list);
      setColors(state.colors);
      setSizes(state.sizes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const keys = devices ? deviceKeys(devices) : new Map<number, string>();
  const keyOf = (device: RgbDevice, zone: RgbZone) => zoneKey(keys.get(device.index) ?? device.name, zone.name);

  function persist(nextColors: Record<string, string>, nextSizes: Record<string, number>) {
    saveLightsState({ colors: nextColors, sizes: nextSizes });
  }

  // El selector de color manda cambios sin parar mientras se arrastra: se
  // pinta como mucho cada 80 ms por zona.
  function setZoneColor(device: RgbDevice, zone: RgbZone, hex: string) {
    const key = keyOf(device, zone);
    const color = normalizeHex(hex);
    const next = { ...colors, [key]: color };
    setColors(next);
    clearTimeout(paintTimers.current[key]);
    paintTimers.current[key] = window.setTimeout(() => {
      paintZone(device, zone, [color]).catch((err) => setError(String(err)));
      persist(next, sizes);
    }, 80);
  }

  async function setAllColor(hex: string) {
    try {
      await paintDevices(hex, []);
      setColors((await loadLightsState()).colors);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Asistente de ventiladores ---

  function replaceDevice(updated: RgbDevice) {
    setDevices((list) => list?.map((d) => (d.index === updated.index ? updated : d)) ?? null);
  }

  async function showSetupCount(deviceIndex: number, zoneIndex: number, count: number) {
    const device = devices?.find((d) => d.index === deviceIndex);
    const zone = device?.zones.find((z) => z.index === zoneIndex);
    if (!device || !zone) return;
    try {
      const updated = await resizeZone(device, zone, count);
      replaceDevice(updated);
      const resized = updated.zones.find((z) => z.index === zoneIndex)!;
      if (resized.leds > 0) {
        await paintZone(updated, resized, [...Array(resized.leds - 1).fill(SETUP_BODY), SETUP_LAST]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startSetup(device: RgbDevice, zone: RgbZone) {
    const count = zone.leds > 0 ? zone.leds : 8;
    setSetup({ deviceIndex: device.index, zoneIndex: zone.index, count, original: zone.leds });
    showSetupCount(device.index, zone.index, count);
  }

  function changeSetupCount(delta: number | null, exact?: number) {
    if (!setup) return;
    const device = devices?.find((d) => d.index === setup.deviceIndex);
    const zone = device?.zones.find((z) => z.index === setup.zoneIndex);
    if (!zone) return;
    const wanted = exact ?? setup.count + (delta ?? 0);
    const count = Math.max(Math.max(1, zone.ledsMin), Math.min(zone.ledsMax, Math.round(wanted)));
    if (count === setup.count) return;
    setSetup({ ...setup, count });
    showSetupCount(setup.deviceIndex, setup.zoneIndex, count);
  }

  async function finishSetup(save: boolean) {
    if (!setup) return;
    const current = setup;
    setSetup(null);
    const device = devices?.find((d) => d.index === current.deviceIndex);
    const zone = device?.zones.find((z) => z.index === current.zoneIndex);
    if (!device || !zone) return;
    const key = keyOf(device, zone);
    try {
      const size = save ? current.count : current.original;
      const updated = await resizeZone(device, zone, size);
      replaceDevice(updated);
      const nextSizes = save ? { ...sizes, [key]: size } : sizes;
      setSizes(nextSizes);
      persist(colors, nextSizes);
      // Vuelve al color de la zona (o al de Miku si todavía no tenía).
      const resized = updated.zones.find((z) => z.index === current.zoneIndex)!;
      if (resized.leds > 0) await paintZone(updated, resized, [colors[key] ?? SETUP_BODY]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

      <p className="lights-hint">
        Las luces de tu PC a través de OpenRGB. Los colores se guardan y vuelven solos al prender la PC; Miku también
        puede cambiarlos si se lo pides.
      </p>

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
              <div className="lights-swatches">
                {PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    className="lights-swatch"
                    style={{ background: c.hex }}
                    onClick={() => setAllColor(c.hex)}
                    aria-label={`Todo en ${c.name}`}
                    title={c.name}
                  />
                ))}
                <label className="lights-swatch lights-swatch-custom" title="Otro color">
                  <input
                    type="color"
                    defaultValue="#39C5BB"
                    onChange={(e) => setAllColor(e.target.value)}
                    aria-label="Todo en otro color"
                  />
                </label>
                <button className="m-btn m-btn-small" onClick={() => setAllColor(OFF)}>
                  Apagar todo
                </button>
              </div>
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
                    const color = colors[key] ?? "#39C5BB";
                    const resizable = isResizable(zone);
                    const inSetup = setup?.deviceIndex === device.index && setup.zoneIndex === zone.index;
                    return (
                      <li key={zone.index} className={`lights-zone ${inSetup ? "setup" : ""}`}>
                        <div className="lights-zone-main">
                          <label
                            className={`lights-zone-color ${zone.leds === 0 ? "empty" : ""}`}
                            style={zone.leds > 0 ? { background: color } : undefined}
                            title={zone.leds > 0 ? "Cambiar color" : "Primero dile cuántos LEDs tiene"}
                          >
                            <input
                              type="color"
                              value={color.toLowerCase()}
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
                                : `${zone.leds} ${zone.leds === 1 ? "LED" : "LEDs"}`}
                            </span>
                          </div>
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
