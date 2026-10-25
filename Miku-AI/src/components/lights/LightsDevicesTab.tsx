import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CATEGORIES,
  EFFECT_NAMES,
  RgbDevice,
  RgbZone,
  Scene,
  ZoneOptions,
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
  zoneOptions,
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
  onRefresh: () => void;
  onError: (err: unknown) => void;
};

type ServiceStatus = { service: string; protocol: number; devices: number; error: string | null };

// Asistente de los conectores: mientras se ajusta, todos los LEDs en
// turquesa y el último en rosa -- el número está bien cuando el rosa cae
// en el último LED del último ventilador enchufado a ese conector.
const SETUP_BODY = "#39C5BB";
const SETUP_LAST = "#F0508F";
const TEST_STEP_MS = 220;

const KIND_ORDER = ["placa madre", "RAM", "tarjeta de video", "refrigeración", "tira LED", "gabinete", "teclado", "mouse", "micrófono"];

type FanSetup = { deviceIndex: number; zoneIndex: number; key: string; count: number; original: number };

// Qué LED físico es el k-ésimo del efecto en cada ventilador (lo mismo que
// map_led en lights_engine.rs, al revés): para "Probar LEDs".
function physicalOf(k: number, leds: number, options: ZoneOptions): number[] {
  const fans = Math.max(1, Math.min(options.fans, leds));
  const per = Math.max(1, Math.floor(leds / fans));
  return Array.from({ length: fans }, (_, fan) => {
    const size = fan === fans - 1 ? leds - fan * per : per;
    const logical = options.reverse ? (size - (k % size)) % size : k % size;
    return fan * per + ((logical + options.offset) % size);
  });
}

// Pestaña Dispositivos del panel Luces (PLAN.md §3.3): el estado de
// OpenRGB, cada dispositivo con "Miku lo maneja" y su corrección de color,
// y cada zona con su color propio, Identificar, y en los conectores ARGB el
// asistente de LEDs y cómo están armados los ventiladores.
export function LightsDevicesTab({ devices, scene, sizes, live, onScene, onDevice, onSizes, onIdentify, onRefresh, onError }: LightsDevicesTabProps) {
  const [setup, setSetup] = useState<FanSetup | null>(null);
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  // Qué zona corrige cada dispositivo ("all" = todas a la vez).
  const [gainTarget, setGainTarget] = useState<Record<number, string>>({});
  const testTimer = useRef<number | null>(null);
  const keys = deviceKeys(devices);
  const keyOf = (device: RgbDevice, zone: RgbZone) => zoneKey(keys.get(device.index) ?? device.name, zone.name);
  const deviceZoneKeys = (device: RgbDevice) => device.zones.map((z) => keyOf(device, z));
  const ownGroup = (key: string) => scene.groups.find((g) => !g.category && g.zones.includes(key));
  const excluded = new Set(scene.excluded ?? []);

  useEffect(() => {
    invoke<ServiceStatus>("rgb_estado").then(setStatus).catch(onError);
    return () => {
      if (testTimer.current) clearInterval(testTimer.current);
    };
  }, []);

  // --- Opciones por zona y por dispositivo ---

  function setOptions(key: string, patch: Partial<ZoneOptions>, final = true) {
    onScene({ ...scene, zones: { ...scene.zones, [key]: { ...zoneOptions(scene, key), ...patch } } }, final);
  }

  // La corrección de color va por zona: "all" cambia todas las del
  // dispositivo, si no solo esa (pedido de Sebastián: los ventiladores de
  // un conector ARGB no se ven igual que las luces de la placa, y en el
  // micrófono la luz de arriba domina a la de abajo).
  // `channel` 3 = intensidad: escala los tres canales juntos, sin cambiar el tono.
  function setGain(device: RgbDevice, target: string, channel: number, value: number, final: boolean) {
    const zones = { ...scene.zones };
    const targets = target === "all" ? deviceZoneKeys(device) : [target];
    for (const key of targets) {
      const current = zoneOptions(scene, key);
      let gain = [...current.gain] as [number, number, number];
      if (channel === 3) {
        const top = Math.max(...gain);
        gain = gain.map((g) => (top === 0 ? value / 100 : (g / top) * (value / 100))) as [number, number, number];
      } else {
        gain[channel] = value / 100;
      }
      zones[key] = { ...current, gain };
    }
    onScene({ ...scene, zones }, final);
  }

  function setManaged(device: RgbDevice, managed: boolean) {
    const mine = deviceZoneKeys(device);
    const rest = (scene.excluded ?? []).filter((k) => !mine.includes(k));
    onScene({ ...scene, excluded: managed ? rest : [...rest, ...mine] }, true);
  }

  // "Probar LEDs": recorre el ventilador de a un LED en el orden del
  // efecto (el LED 1 primero, en su sentido), en blanco sobre turquesa
  // tenue, en todos los ventiladores del conector a la vez.
  function testLeds(key: string, zone: RgbZone) {
    if (testTimer.current) clearInterval(testTimer.current);
    const options = zoneOptions(scene, key);
    const per = Math.max(1, Math.floor(zone.leds / Math.max(1, Math.min(options.fans, zone.leds))));
    let k = 0;
    setTesting(key);
    testTimer.current = window.setInterval(() => {
      if (k >= per) {
        clearInterval(testTimer.current!);
        testTimer.current = null;
        probeZone(key, null).catch(onError);
        setTesting(null);
        return;
      }
      const lit = new Set(physicalOf(k, zone.leds, options));
      probeZone(key, Array.from({ length: zone.leds }, (_, i) => (lit.has(i) ? "#FFFFFF" : "#0E3B38"))).catch(onError);
      k += 1;
    }, TEST_STEP_MS);
  }

  // --- Asistente de cantidad de LEDs ---

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
    setOpenZone(null);
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
  const serviceOk = status?.service === "corriendo" && !status.error;

  return (
    <div className="lights-devices">
      <section className="lights-module lights-service" aria-label="Estado de OpenRGB">
        <span className={`lights-led ${serviceOk ? "ok" : "warn"}`} />
        <div className="lights-service-text">
          <span className="lights-zone-name">Servicio de OpenRGB</span>
          <span className="lights-zone-detail">
            {status === null
              ? "Revisando…"
              : status.error
                ? `${status.service === "corriendo" ? "Corriendo" : `Servicio ${status.service}`} · ${status.error}`
                : `Corriendo · protocolo ${status.protocol} · ${status.devices} dispositivos`}
          </span>
        </div>
        <button
          className="m-btn m-btn-small"
          onClick={() => {
            setStatus(null);
            invoke<ServiceStatus>("rgb_estado").then(setStatus).catch(onError);
            onRefresh();
          }}
        >
          Volver a buscar
        </button>
      </section>

      {sorted.map((device) => {
        const managed = !deviceZoneKeys(device).every((k) => excluded.has(k));
        const lit = device.zones.filter((z) => z.leds > 0);
        const target = lit.some((z) => keyOf(device, z) === gainTarget[device.index]) ? gainTarget[device.index] : "all";
        const gain = zoneOptions(scene, target === "all" ? (deviceZoneKeys(device)[0] ?? "") : target).gain;
        const differs = target === "all" && new Set(lit.map((z) => JSON.stringify(zoneOptions(scene, keyOf(device, z)).gain))).size > 1;
        return (
          <section key={device.index} className={`lights-module ${managed ? "" : "lights-excluded"}`} aria-label={deviceTitle(device, devices)}>
            <div className="lights-device-head">
              <span className="lights-module-title">{device.kind.toUpperCase()}</span>
              <span className="lights-device-name">{deviceTitle(device, devices)}</span>
              <span className="lights-device-spacer" />
              <span className="lights-zone-detail">{managed ? "Miku lo maneja" : "Con su propio programa"}</span>
              <button
                className={`lights-switch ${managed ? "on" : ""}`}
                onClick={() => setManaged(device, !managed)}
                aria-pressed={managed}
                aria-label={`Miku maneja ${deviceTitle(device, devices)}`}
                title={managed ? "Apágalo y Miku no toca este dispositivo" : "Prende para que Miku lo maneje"}
              >
                <span className="lights-switch-knob" />
              </button>
            </div>

            {managed && (
              <>
                <ul className="lights-zones">
                  {device.zones.map((zone) => {
                    const key = keyOf(device, zone);
                    const effect = effectOfZone(scene, key);
                    const own = ownGroup(key);
                    const options = zoneOptions(scene, key);
                    const shown = live[key] ?? effect?.colors[0] ?? SETUP_BODY;
                    const resizable = isResizable(zone);
                    const inSetup = setup?.key === key;
                    const open = openZone === key;
                    const category = CATEGORIES.find((c) => c.id === categoryOf(device, zone))!.name;
                    const fans = Math.max(1, Math.min(options.fans, zone.leds || 1));
                    const per = zone.leds > 0 ? Math.floor(zone.leds / fans) : 0;
                    return (
                      <li key={zone.index} className={`lights-zone ${inSetup || open ? "setup" : ""}`}>
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
                                : `${resizable && fans > 1 ? `${fans} ventiladores × ${per} LEDs` : `${zone.leds} ${zone.leds === 1 ? "LED" : "LEDs"}`} · ${own ? EFFECT_NAMES[own.effect.kind] : `grupo ${category}`}`}
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
                            {resizable && zone.leds > 0 && !inSetup && (
                              <button className={`m-btn m-btn-small ${open ? "on" : ""}`} onClick={() => setOpenZone(open ? null : key)} aria-expanded={open}>
                                Ajustes
                              </button>
                            )}
                            {resizable && !inSetup && zone.leds === 0 && (
                              <button className="m-btn m-btn-small m-btn-primary" onClick={() => startSetup(device, zone)} disabled={setup !== null}>
                                Configurar
                              </button>
                            )}
                          </div>
                        </div>

                        {open && !inSetup && (
                          <div className="lights-fanopts">
                            <div className="lights-dial" aria-label="Dónde está el LED 1">
                              {Array.from({ length: Math.max(1, per) }, (_, i) => {
                                const a = -Math.PI / 2 + (i / Math.max(1, per)) * Math.PI * 2;
                                return (
                                  <button
                                    key={i}
                                    className={`lights-dial-led ${i === options.offset % Math.max(1, per) ? "first" : ""}`}
                                    style={{ left: `${50 + Math.cos(a) * 40}%`, top: `${50 + Math.sin(a) * 40}%` }}
                                    onClick={() => setOptions(key, { offset: i })}
                                    aria-label={`El LED 1 es el ${i + 1}`}
                                    title={i === options.offset ? "LED 1" : "Empieza aquí"}
                                  />
                                );
                              })}
                              <span className="lights-dial-center">
                                TOCA DÓNDE
                                <br />
                                EMPIEZA
                              </span>
                            </div>
                            <div className="lights-fanopts-rows">
                              <div className="lights-fanopts-row">
                                <span>Ventiladores en el conector</span>
                                <div className="lights-stepper">
                                  <button className="m-btn m-btn-small" onClick={() => setOptions(key, { fans: Math.max(1, fans - 1), offset: 0 })} disabled={fans <= 1}>
                                    −
                                  </button>
                                  <span className="lights-stepper-value lights-stepper-static">{fans}</span>
                                  <button
                                    className="m-btn m-btn-small"
                                    onClick={() => setOptions(key, { fans: Math.min(zone.leds, fans + 1), offset: 0 })}
                                    disabled={fans >= zone.leds}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              <div className="lights-fanopts-row">
                                <span>Sentido de giro</span>
                                <div className="lights-seg">
                                  <button className={!options.reverse ? "on" : ""} onClick={() => setOptions(key, { reverse: false })}>
                                    Horario
                                  </button>
                                  <button className={options.reverse ? "on" : ""} onClick={() => setOptions(key, { reverse: true })}>
                                    Antihorario
                                  </button>
                                </div>
                              </div>
                              <div className="lights-fanopts-row">
                                <span className="lights-zone-detail">
                                  {zone.leds} LEDs en total{fans > 1 ? ` · ${per} por ventilador` : ""}
                                </span>
                                <div className="lights-zone-actions">
                                  <button className="m-btn m-btn-small" onClick={() => testLeds(key, zone)} disabled={testing !== null}>
                                    {testing === key ? "Probando…" : "Probar LEDs"}
                                  </button>
                                  <button className="m-btn m-btn-small" onClick={() => startSetup(device, zone)} disabled={setup !== null}>
                                    Cambiar cantidad
                                  </button>
                                  <button className="m-btn m-btn-small" onClick={() => resetZone(device, zone)} title="Dejar este conector sin configurar, para empezar de cero">
                                    Desconfigurar
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

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

                <details className="lights-gain">
                  <summary>Corrección de color</summary>
                  <p className="lights-zone-detail">Para que el blanco se vea igual en todas las luces, o bajarle la fuerza a una que domina.</p>
                  {lit.length > 1 && (
                    <div className="lights-seg lights-gain-target" role="radiogroup" aria-label="Qué corregir">
                      <button role="radio" aria-checked={target === "all"} className={target === "all" ? "on" : ""} onClick={() => setGainTarget({ ...gainTarget, [device.index]: "all" })}>
                        Todo
                      </button>
                      {lit.map((z) => {
                        const k = keyOf(device, z);
                        return (
                          <button key={k} role="radio" aria-checked={target === k} className={target === k ? "on" : ""} onClick={() => setGainTarget({ ...gainTarget, [device.index]: k })}>
                            {zoneLabel(z)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {differs && <p className="lights-zone-detail">Las zonas tienen correcciones distintas: mover un control aquí las iguala.</p>}
                  {["Rojo", "Verde", "Azul", "Intensidad"].map((name, ch) => {
                    const value = Math.round((ch === 3 ? Math.max(...gain) : gain[ch]) * 100);
                    return (
                      <label key={name} className="lights-gain-row">
                        <span>{name}</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={value}
                          onChange={(e) => setGain(device, target, ch, Number(e.target.value), false)}
                          onPointerUp={(e) => setGain(device, target, ch, Number((e.target as HTMLInputElement).value), true)}
                          onKeyUp={(e) => setGain(device, target, ch, Number((e.target as HTMLInputElement).value), true)}
                        />
                        <span className="lights-param-value">{value}%</span>
                      </label>
                    );
                  })}
                </details>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
