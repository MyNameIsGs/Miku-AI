import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { IconClose, IconReload } from "./Icons";
import type { MotionPhase } from "../hooks/usePresenceMotion";
import {
  CATEGORIES,
  CategoryId,
  DEFAULT_GLOBAL,
  Effect,
  LightsGlobal,
  RgbDevice,
  Scene,
  categoryOf,
  deviceKeys,
  listDevices,
  loadLightsState,
  normalizeScene,
  probeZone,
  rgbToHex,
  saveLightsState,
  sendGlobal,
  sendScene,
  setPreview,
  withCategoryEffect,
  withCategoryLayers,
  zoneKey,
  zonesByCategory,
} from "../lib/lights";
import { LightsPreview } from "./lights/LightsPreview";
import { LightsSceneTab } from "./lights/LightsSceneTab";
import { LightsDevicesTab } from "./lights/LightsDevicesTab";
import { LightsMapTab } from "./lights/LightsMapTab";
import { LightsProfilesTab } from "./lights/LightsProfilesTab";
import { LightsStripsCard } from "./lights/LightsStripsCard";
import { LightsMikuBar } from "./lights/LightsMikuBar";
import { MikuLightsState, deleteMikuEffect, loadMikuLights, onMikuLightsChange } from "../lib/mikuLights";

type LightsPanelProps = {
  onClose: () => void;
  motion?: MotionPhase;
};

type Rgb = [number, number, number];
type PreviewZone = { key: string; colors: Rgb[] };
type Tab = "escena" | "dispositivos" | "mapa" | "perfiles";
const TAB_NAMES: Record<Tab, string> = { escena: "Escena", dispositivos: "Dispositivos", mapa: "Mapa", perfiles: "Perfiles" };
type Selection = CategoryId | "all";

const UNDO_LIMIT = 50;
const RECENT_KEY = "miku.lights.recent";
const IDENTIFY_MS = 3000;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// Panel de luces RGB, fase 2 de docs/luces-argb/PLAN.md (maqueta en
// docs/luces-argb/maqueta.html): vista previa en vivo arriba con el brillo
// general, y pestañas Escena, Dispositivos, Mapa y Perfiles. Los efectos los dibuja el motor en Rust (lights_engine.rs);
// el panel solo arma la escena y se la manda.
export function LightsPanel({ onClose, motion }: LightsPanelProps) {
  const [devices, setDevices] = useState<RgbDevice[] | null>(null);
  const [scene, setSceneState] = useState<Scene | null>(null);
  const [global, setGlobalState] = useState<LightsGlobal>(DEFAULT_GLOBAL);
  const [sizes, setSizesState] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("escena");
  const [group, setGroup] = useState<Selection>("all");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState<string | null>(null);
  const [frame, setFrame] = useState<Record<string, Rgb[]>>({});
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [history, setHistory] = useState<{ past: Scene[]; future: Scene[] }>({ past: [], future: [] });
  const [mine, setMine] = useState<MikuLightsState | null>(null);
  // La escena al empezar un arrastre (para deshacer el arrastre entero).
  const dragStart = useRef<Scene | null>(null);
  const timers = useRef<Record<string, number>>({});

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [list, state] = await Promise.all([listDevices(), loadLightsState()]);
      setDevices(list);
      setSceneState(normalizeScene(state.scene, list));
      setGlobalState(state.global);
      setSizesState(state.sizes);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }

  // Lo de Miku: sus efectos y "Que Miku lo decida". Cuando ella cambia
  // algo, la escena del panel se vuelve a leer.
  useEffect(() => {
    loadMikuLights().then(setMine).catch(console.error);
    return onMikuLightsChange((state) => {
      setMine(state);
      loadLightsState()
        .then((saved) => setSceneState((current) => (current && saved.scene && devicesRef.current ? normalizeScene(saved.scene, devicesRef.current) : current)))
        .catch(console.error);
    });
  }, []);
  const devicesRef = useRef<RgbDevice[] | null>(null);
  devicesRef.current = devices;

  useEffect(() => {
    refresh();
    setPreview(true).catch(console.error);
    const unlisten = listen<PreviewZone[]>("luces-cuadro", (event) => {
      const next: Record<string, Rgb[]> = {};
      for (const zone of event.payload) next[zone.key] = zone.colors;
      setFrame(next);
    });
    return () => {
      setPreview(false).catch(console.error);
      unlisten.then((u) => u());
    };
  }, []);

  function later(id: string, fn: () => void, ms = 60) {
    clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(fn, ms);
  }

  async function persist(patch: Partial<{ scene: Scene; global: LightsGlobal; sizes: Record<string, number> }>) {
    const state = await loadLightsState();
    await saveLightsState({ ...state, ...patch });
  }

  // Cada cambio va al motor enseguida (agrupado cada 60 ms); al terminar
  // (soltar el deslizador, un clic) se guarda y se anota para deshacer.
  function changeScene(next: Scene, final: boolean) {
    if (!scene) return;
    if (!dragStart.current) dragStart.current = scene;
    setSceneState(next);
    later("send", () => sendScene(next).catch(fail));
    if (final) {
      const before = dragStart.current;
      dragStart.current = null;
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        setHistory((h) => ({ past: [...h.past, before].slice(-UNDO_LIMIT), future: [] }));
      }
      later("save", () => persist({ scene: next }).catch(fail), 300);
    }
  }

  function restore(target: Scene) {
    setSceneState(target);
    sendScene(target).catch(fail);
    persist({ scene: target }).catch(fail);
  }

  function undo() {
    if (!scene || history.past.length === 0) return;
    const prev = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [scene, ...history.future] });
    restore(prev);
  }

  function redo() {
    if (!scene || history.future.length === 0) return;
    const next = history.future[0];
    setHistory({ past: [...history.past, scene], future: history.future.slice(1) });
    restore(next);
  }

  // Ctrl+Z / Ctrl+Y (no mientras se escribe en un campo de texto).
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "text") return;
      if (!e.ctrlKey) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRef.current.undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        undoRef.current.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function changeGroupEffect(effect: Effect, final: boolean) {
    if (!scene) return;
    changeScene(withCategoryEffect(scene, group, effect), final);
    if (final) {
      const next = [...effect.colors, ...recent.filter((c) => !effect.colors.includes(c))].slice(0, 8);
      if (JSON.stringify(next) !== JSON.stringify(recent)) {
        setRecent(next);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          // Sin almacenamiento local: los recientes duran lo que dure el panel.
        }
      }
    }
  }

  function changeGlobal(next: LightsGlobal) {
    setGlobalState(next);
    later("global", () => {
      sendGlobal(next).catch(fail);
      persist({ global: next }).catch(fail);
    });
  }

  function changeSizes(next: Record<string, number>) {
    setSizesState(next);
    persist({ sizes: next }).catch(fail);
  }

  // Identificar: la zona parpadea en blanco unos segundos, en las luces de
  // verdad y en la vista previa.
  function identify(key: string) {
    setIdentifying(key);
    let on = true;
    const id = window.setInterval(() => {
      probeZone(key, [on ? "#FFFFFF" : "#000000"]).catch(fail);
      on = !on;
    }, 250);
    window.setTimeout(() => {
      clearInterval(id);
      probeZone(key, null).catch(fail);
      setIdentifying(null);
    }, IDENTIFY_MS);
  }

  function selectZone(key: string | null) {
    setSelectedZone(key);
    if (!key || !devices) return;
    const keys = deviceKeys(devices);
    for (const d of devices) {
      for (const z of d.zones) if (zoneKey(keys.get(d.index)!, z.name) === key) setGroup(categoryOf(d, z));
    }
  }

  const live: Record<string, string> = {};
  for (const [key, colors] of Object.entries(frame)) if (colors[0]) live[key] = rgbToHex(colors[0]);
  const counts = devices ? zonesByCategory(devices.map((d) => ({ ...d, zones: d.zones.filter((z) => z.leds > 0) }))) : null;
  const zoneCounts = Object.fromEntries(CATEGORIES.map((c) => [c.id, counts?.[c.id].length ?? 0])) as Record<CategoryId, number>;

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
          <button className="m-btn m-btn-small m-btn-icon" onClick={undo} disabled={history.past.length === 0} aria-label="Deshacer" title="Deshacer (Ctrl+Z)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
          </button>
          <button className="m-btn m-btn-small m-btn-icon" onClick={redo} disabled={history.future.length === 0} aria-label="Rehacer" title="Rehacer (Ctrl+Y)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 14 5-5-5-5" />
              <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
            </svg>
          </button>
          <button className="m-btn m-btn-small m-btn-icon" onClick={refresh} disabled={loading} aria-label="Volver a buscar dispositivos" title="Volver a buscar dispositivos">
            <IconReload size={16} />
          </button>
          <button className="m-panel-close" onClick={onClose} aria-label="Cerrar luces">
            <IconClose />
          </button>
        </div>
      </div>

      <div className="lights-preview">
        {devices && <LightsPreview devices={devices} scene={scene} frame={frame} selected={selectedZone} identifying={identifying} onSelect={selectZone} />}
        <div className="lights-preview-bar">
          <button
            className={`lights-switch ${global.on ? "on" : ""}`}
            onClick={() => changeGlobal({ ...global, on: !global.on })}
            aria-pressed={global.on}
            aria-label={global.on ? "Apagar todas las luces" : "Prender las luces"}
            title={global.on ? "Apagar todas las luces" : "Prender las luces"}
          >
            <span className="lights-switch-knob" />
          </button>
          <span className="lights-global-label">BRILLO</span>
          <input type="range" min={0} max={100} value={global.brightness} onChange={(e) => changeGlobal({ ...global, brightness: Number(e.target.value) })} aria-label="Brillo general" />
          <span className="lights-global-value">{global.brightness}%</span>
          <button className={`m-btn m-btn-small ${global.paused ? "on" : ""}`} onClick={() => changeGlobal({ ...global, paused: !global.paused })} title="Dejar los efectos quietos en este cuadro">
            {global.paused ? "Seguir" : "Pausar"}
          </button>
          <button className="m-btn m-btn-small" onClick={() => selectedZone && identify(selectedZone)} disabled={!selectedZone || identifying !== null} title={selectedZone ? "Hace parpadear la zona elegida" : "Elige una zona en la vista previa"}>
            Identificar
          </button>
        </div>
      </div>

      <div className="lights-tabs" role="tablist">
        {(Object.keys(TAB_NAMES) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`lights-tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
            {TAB_NAMES[t]}
          </button>
        ))}
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
        {devices && devices.length > 0 && scene && tab === "escena" && mine && <LightsMikuBar mine={mine} onError={fail} />}
        {devices && devices.length > 0 && scene && tab === "escena" && (
          <LightsSceneTab
            scene={scene}
            selected={group}
            onSelect={setGroup}
            onChange={changeGroupEffect}
            onLayersChange={(layers, final) => changeScene(withCategoryLayers(scene, group, layers), final)}
            recentColors={recent}
            zoneCounts={zoneCounts}
            mikuEffects={mine?.effects ?? []}
            onDeleteMikuEffect={(id) => deleteMikuEffect(id).catch(fail)}
          />
        )}
        {devices && scene && tab === "escena" && devices.some((d) => /aula/i.test(d.name)) && <LightsStripsCard scene={scene} onScene={changeScene} />}
        {devices && devices.length > 0 && scene && tab === "dispositivos" && (
          <LightsDevicesTab
            devices={devices}
            scene={scene}
            sizes={sizes}
            live={live}
            onScene={changeScene}
            onDevice={(updated) => setDevices((list) => list?.map((d) => (d.index === updated.index ? updated : d)) ?? null)}
            onSizes={changeSizes}
            onIdentify={identify}
            onRefresh={refresh}
            onError={fail}
          />
        )}
        {devices && devices.length > 0 && scene && tab === "mapa" && <LightsMapTab devices={devices} scene={scene} frame={frame} onScene={changeScene} />}
        {devices && devices.length > 0 && scene && tab === "perfiles" && (
          <LightsProfilesTab scene={scene} global={global} onGlobal={changeGlobal} onApplied={refresh} onError={fail} />
        )}
      </div>
    </div>
  );
}
