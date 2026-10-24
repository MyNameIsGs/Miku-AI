import { useState } from "react";
import {
  CATEGORIES,
  EFFECT_NAMES,
  RgbDevice,
  RgbZone,
  Scene,
  categoryOf,
  deviceKeys,
  deviceTitle,
  effectOfZone,
  isResizable,
  makeEffect,
  normalizeHex,
  probeZone,
  resizeZone,
  withZoneEffect,
  zoneKey,
  zoneLabel,
} from "../../lib/lights";

type LightsDevicesTabProps = {
  devices: RgbDevice[];
  scene: Scene;
  sizes: Record<string, number>;
  live: Record<string, string>;
  onScene: (scene: Scene, final: boolean) => void;
  onDevice: (device: RgbDevice) => void;
  onSizes: (sizes: Record<string, number>) => void;
  onIdentify: (zoneKey: string) => void;
  onError: (err: unknown) => void;
};

// Asistente de los ventiladores: mientras se ajusta, todos los LEDs en
// turquesa y el último en rosa -- el número está bien cuando el rosa cae
// en el último LED del último ventilador enchufado a ese conector.
const SETUP_BODY = "#39C5BB";
const SETUP_LAST = "#F0508F";

const KIND_ORDER = ["placa madre", "RAM", "tarjeta de video", "refrigeración", "tira LED", "gabinete", "teclado", "mouse", "micrófono"];

type FanSetup = { deviceIndex: number; zoneIndex: number; key: string; count: number; original: number };

// Pestaña Dispositivos del panel Luces (PLAN.md §3.3; la fase 3 la amplía
// con el sentido de giro, excluir y la corrección de color): cada zona con
// su estado, un color propio por zona, y el asistente de los conectores
// ARGB.
export function LightsDevicesTab({ devices, scene, sizes, live, onScene, onDevice, onSizes, onIdentify, onError }: LightsDevicesTabProps) {
  const [setup, setSetup] = useState<FanSetup | null>(null);
  const keys = deviceKeys(devices);
  const keyOf = (device: RgbDevice, zone: RgbZone) => zoneKey(keys.get(device.index) ?? device.name, zone.name);
  const ownGroup = (key: string) => scene.groups.find((g) => !g.category && g.zones.includes(key));

  async function showSetupCount(current: FanSetup, count: number) {
    const device = devices.find((d) => d.index === current.deviceIndex);
    const zone = device?.zones.find((z) => z.index === current.zoneIndex);
    if (!device || !zone) return;
    try {
      onDevice(await resizeZone(device, zone, count));
      await probeZone(current.key, [...Array(Math.max(0, count - 1)).fill(SETUP_BODY), SETUP_LAST]);
    } catch (err) {
      onError(err);
    }
  }

  function startSetup(device: RgbDevice, zone: RgbZone) {
    const next = { deviceIndex: device.index, zoneIndex: zone.index, key: keyOf(device, zone), count: zone.leds > 0 ? zone.leds : 8, original: zone.leds };
    setSetup(next);
    showSetupCount(next, next.count);
  }

  function changeSetupCount(delta: number | null, exact?: number) {
    if (!setup) return;
    const zone = devices.find((d) => d.index === setup.deviceIndex)?.zones.find((z) => z.index === setup.zoneIndex);
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
    const device = devices.find((d) => d.index === current.deviceIndex);
    const zone = device?.zones.find((z) => z.index === current.zoneIndex);
    if (!device || !zone) return;
    try {
      const size = save ? current.count : current.original;
      onDevice(await resizeZone(device, zone, size));
      await probeZone(current.key, null);
      if (save) onSizes({ ...sizes, [current.key]: size });
    } catch (err) {
      onError(err);
    }
  }

  // Volver a empezar con un conector: 0 LEDs y sin tamaño guardado.
  async function resetZone(device: RgbDevice, zone: RgbZone) {
    const key = keyOf(device, zone);
    try {
      onDevice(await resizeZone(device, zone, 0));
      const next = { ...sizes };
      delete next[key];
      onSizes(next);
    } catch (err) {
      onError(err);
    }
  }

  function removeOwn(key: string) {
    onScene({ ...scene, groups: scene.groups.map((g) => (g.category ? g : { ...g, zones: g.zones.filter((z) => z !== key) })).filter((g) => g.category || g.zones.length > 0) }, true);
  }

  const sorted = [...devices].sort(
    (a, b) => (KIND_ORDER.indexOf(a.kind) + 1 || 99) - (KIND_ORDER.indexOf(b.kind) + 1 || 99) || a.index - b.index,
  );

  return (
    <div className="lights-devices">
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
              const own = ownGroup(key);
              const shown = live[key] ?? effect?.colors[0] ?? SETUP_BODY;
              const resizable = isResizable(zone);
              const inSetup = setup?.key === key;
              const category = CATEGORIES.find((c) => c.id === categoryOf(device, zone))!.name;
              return (
                <li key={zone.index} className={`lights-zone ${inSetup ? "setup" : ""}`}>
                  <div className="lights-zone-main">
                    <label
                      className={`lights-zone-color ${zone.leds === 0 ? "empty" : ""}`}
                      style={zone.leds > 0 ? { background: shown } : undefined}
                      title={zone.leds > 0 ? "Color propio para esta zona" : "Primero dile cuántos LEDs tiene"}
                    >
                      <input
                        type="color"
                        value={(effect?.colors[0] ?? SETUP_BODY).toLowerCase()}
                        disabled={zone.leds === 0 || inSetup}
                        onChange={(e) => onScene(withZoneEffect(scene, key, makeEffect("static", [normalizeHex(e.target.value)])), false)}
                        onBlur={(e) => onScene(withZoneEffect(scene, key, makeEffect("static", [normalizeHex(e.target.value)])), true)}
                        aria-label={`Color propio de ${zoneLabel(zone)}`}
                      />
                    </label>
                    <div className="lights-zone-text">
                      <span className="lights-zone-name">
                        {zoneLabel(zone)}
                        {own && <span className="lights-badge">COLOR PROPIO</span>}
                      </span>
                      <span className="lights-zone-detail">
                        {resizable && zone.leds === 0
                          ? "Sin configurar: dile cuántos LEDs tiene lo enchufado"
                          : `${zone.leds} ${zone.leds === 1 ? "LED" : "LEDs"} · ${own ? EFFECT_NAMES[own.effect.kind] : `grupo ${category}`}`}
                      </span>
                    </div>
                    <div className="lights-zone-actions">
                      {own && !inSetup && (
                        <button className="m-btn m-btn-small" onClick={() => removeOwn(key)} title={`Volver al efecto del grupo ${category}`}>
                          Usar el del grupo
                        </button>
                      )}
                      {zone.leds > 0 && !inSetup && (
                        <button className="m-btn m-btn-small" onClick={() => onIdentify(key)} title="La hace parpadear en blanco para encontrarla">
                          Identificar
                        </button>
                      )}
                      {resizable && !inSetup && zone.leds > 0 && (
                        <button className="m-btn m-btn-small" onClick={() => resetZone(device, zone)} disabled={setup !== null} title="Dejar este conector sin configurar, para empezar de cero">
                          Desconfigurar
                        </button>
                      )}
                      {resizable && !inSetup && (
                        <button className={`m-btn m-btn-small ${zone.leds === 0 ? "m-btn-primary" : ""}`} onClick={() => startSetup(device, zone)} disabled={setup !== null}>
                          {zone.leds === 0 ? "Configurar" : "Ajustar LEDs"}
                        </button>
                      )}
                    </div>
                  </div>

                  {inSetup && setup && (
                    <div className="lights-setup">
                      <p className="lights-setup-text">
                        Mira lo que está enchufado a este conector: los LEDs se prenden en turquesa y el último en{" "}
                        <span className="lights-pink">rosa</span>. Ajusta el número hasta que el rosa quede justo en el último LED del
                        último ventilador. Si no se prende nada, no hay nada enchufado aquí.
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
    </div>
  );
}
