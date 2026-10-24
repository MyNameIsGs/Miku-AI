import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

// Luces RGB de la PC: lo que comparten el panel Luces y la tool
// controlar_luces. El hardware lo maneja el servicio de OpenRGB (ver
// openrgb.rs); los efectos los dibuja el motor en Rust (lights_engine.rs).
//
// Lo que se ve es una *escena*: grupos de zonas, cada uno con su efecto.
// Se guarda acá (local, .settings.dat) junto con cuántos LEDs tiene cada
// conector ARGB, y se vuelve a mandar al motor al abrir la app: al
// reiniciar la PC, la RAM vuelve a su efecto de hardware y la placa se
// olvida de cuántos LEDs tiene cada ventilador.

export type RgbZone = {
  index: number;
  name: string;
  leds: number;
  ledsMin: number;
  ledsMax: number;
  start: number;
};

export type RgbDevice = {
  index: number;
  name: string;
  kind: string;
  zones: RgbZone[];
  leds: number;
  modes: string[];
  activeMode: number;
};

export const EFFECT_KINDS = ["static", "breathe", "rainbow", "wave", "comet", "sparkle", "fire"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT_NAMES: Record<EffectKind, string> = {
  static: "Estático",
  breathe: "Respirar",
  rainbow: "Arcoíris",
  wave: "Ola",
  comet: "Cometa",
  sparkle: "Destellos",
  fire: "Fuego",
};

export type Effect = {
  kind: EffectKind;
  colors: string[]; // "#39C5BB"
  speed: number; // 1-100
  brightness: number; // 0-100
  size: number; // 1-100
  direction: 1 | -1;
};

// `category`: grupo del panel (ver CATEGORIES). Sin category, es una zona
// con su propio efecto (un color elegido a mano en Dispositivos), que se
// dibuja encima de su grupo. El motor no mira estos campos.
export type LightGroup = { zones: string[]; effect: Effect; category?: CategoryId };
export type Scene = { groups: LightGroup[]; positions: Record<string, number> };
export type LightsGlobal = { on: boolean; brightness: number; paused: boolean; fps: number };

type LightsState = {
  sizes: Record<string, number>;
  scene: Scene | null;
  global: LightsGlobal;
};

const STORE_KEY = "lights";
export const DEFAULT_GLOBAL: LightsGlobal = { on: true, brightness: 100, paused: false, fps: 30 };

export function makeEffect(kind: EffectKind, colors: string[], patch: Partial<Effect> = {}): Effect {
  return { kind, colors, speed: 50, brightness: 100, size: 40, direction: 1, ...patch };
}

export async function loadLightsState(): Promise<LightsState> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const saved = await store.get<Partial<LightsState> & { colors?: Record<string, string> }>(STORE_KEY);
    let scene = saved?.scene ?? null;
    // Antes (737c876) se guardaba un color suelto por zona: pasa a una
    // escena con un grupo estático por zona.
    if (!scene && saved?.colors && Object.keys(saved.colors).length > 0) {
      scene = {
        groups: Object.entries(saved.colors).map(([zone, color]) => ({ zones: [zone], effect: makeEffect("static", [color]) })),
        positions: {},
      };
    }
    return { sizes: saved?.sizes ?? {}, scene, global: { ...DEFAULT_GLOBAL, ...saved?.global } };
  } catch (err) {
    console.error("[Luces] No se pudo cargar lo guardado:", err);
    return { sizes: {}, scene: null, global: DEFAULT_GLOBAL };
  }
}

export async function saveLightsState(state: LightsState) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, state);
    await store.save();
  } catch (err) {
    console.error("[Luces] No se pudo guardar:", err);
  }
}

// --- Al motor ---

function toEngine(scene: Scene) {
  return {
    groups: scene.groups.map((g) => ({ zones: g.zones, effect: { ...g.effect, colors: g.effect.colors.map(hexToRgb) } })),
    positions: scene.positions,
  };
}

export const sendScene = (scene: Scene) => invoke("luces_escena", { escena: toEngine(scene) });
export const sendGlobal = (global: LightsGlobal) => invoke("luces_global", { global });
// El asistente de ventiladores: pinta la zona a mano (null la devuelve al efecto).
export const probeZone = (zoneKey: string, colors: string[] | null) =>
  invoke("luces_probar_zona", { zona: zoneKey, colores: colors ? colors.map(hexToRgb) : null });
export const setPreview = (active: boolean) => invoke("luces_vista_previa", { activa: active });

export async function setScene(scene: Scene) {
  await sendScene(scene);
  const state = await loadLightsState();
  await saveLightsState({ ...state, scene });
}

export async function setGlobal(global: LightsGlobal) {
  await sendGlobal(global);
  const state = await loadLightsState();
  await saveLightsState({ ...state, global });
}

// --- Escenas ---

// La zona pasa a tener su propio efecto: sale del grupo donde estaba.
export function withZoneEffect(scene: Scene | null, zoneKey: string, effect: Effect): Scene {
  // Los grupos del panel la siguen nombrando (el efecto propio se dibuja
  // encima); de los demás sale.
  const groups = (scene?.groups ?? [])
    .map((g) => (g.category ? g : { ...g, zones: g.zones.filter((z) => z !== zoneKey) }))
    .filter((g) => g.category || g.zones.length > 0);
  return { groups: [...groups, { zones: [zoneKey], effect }], positions: scene?.positions ?? {} };
}

// Varias zonas juntas con un mismo efecto (las demás quedan como estaban).
export function withZonesEffect(scene: Scene | null, zoneKeys: string[], effect: Effect): Scene {
  const set = new Set(zoneKeys);
  const groups = (scene?.groups ?? [])
    .map((g) => (g.category ? g : { ...g, zones: g.zones.filter((z) => !set.has(z)) }))
    .filter((g) => g.category || g.zones.length > 0);
  return { groups: [...groups, { zones: zoneKeys, effect }], positions: scene?.positions ?? {} };
}

// El efecto que se ve en una zona: el último grupo que la nombra (el motor
// dibuja en orden, así que el último gana).
export function effectOfZone(scene: Scene | null, zoneKey: string): Effect | null {
  const groups = scene?.groups ?? [];
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i].zones.includes(zoneKey)) return groups[i].effect;
  return null;
}

// --- Grupos del panel (fase 2) ---

export type CategoryId = "fans" | "ram" | "board" | "periph";

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: "fans", name: "Ventiladores" },
  { id: "ram", name: "RAM" },
  { id: "board", name: "Placa" },
  { id: "periph", name: "Periféricos" },
];

export function categoryOf(device: RgbDevice, zone: RgbZone): CategoryId {
  if (isResizable(zone)) return "fans";
  if (device.kind === "RAM") return "ram";
  if (device.kind === "placa madre") return "board";
  return "periph";
}

export function zonesByCategory(devices: RgbDevice[]): Record<CategoryId, string[]> {
  const keys = deviceKeys(devices);
  const out: Record<CategoryId, string[]> = { fans: [], ram: [], board: [], periph: [] };
  for (const device of devices) {
    for (const zone of device.zones) out[categoryOf(device, zone)].push(zoneKey(keys.get(device.index)!, zone.name));
  }
  return out;
}

const DEFAULT_EFFECT = makeEffect("static", ["#39C5BB"]);

// Lleva cualquier escena (las de la fase 1 eran un grupo con todo, o un
// grupo por zona) a la forma del panel: un grupo por categoría, con el
// efecto que tenía su primera zona, y después las zonas con efecto propio.
export function normalizeScene(scene: Scene | null, devices: RgbDevice[]): Scene {
  const byCategory = zonesByCategory(devices);
  const groups: LightGroup[] = CATEGORIES.map(({ id }) => {
    const existing = scene?.groups.find((g) => g.category === id);
    const first = byCategory[id][0];
    const fromZone = !existing && first ? scene?.groups.find((g) => g.zones.includes(first))?.effect : null;
    return { category: id, zones: byCategory[id], effect: existing?.effect ?? fromZone ?? DEFAULT_EFFECT };
  });
  // Zonas con efecto propio: las que en la escena vieja no tenían el mismo
  // efecto que su grupo.
  const own: LightGroup[] = [];
  for (const g of scene?.groups ?? []) {
    if (g.category) continue;
    for (const zone of g.zones) {
      const category = groups.find((c) => c.zones.includes(zone));
      if (category && JSON.stringify(category.effect) !== JSON.stringify(g.effect)) own.push({ zones: [zone], effect: g.effect });
    }
  }
  return { groups: [...groups, ...own], positions: scene?.positions ?? {} };
}

// Cambia el efecto de un grupo del panel ("all" = los cuatro). Las zonas
// de ese grupo dejan de tener efecto propio: "ventiladores en ola" es todos.
export function withCategoryEffect(scene: Scene, category: CategoryId | "all", effect: Effect): Scene {
  const ids = category === "all" ? CATEGORIES.map((c) => c.id) : [category];
  const touched = new Set(scene.groups.filter((g) => g.category && ids.includes(g.category)).flatMap((g) => g.zones));
  return {
    ...scene,
    groups: scene.groups
      .map((g) => (g.category && ids.includes(g.category) ? { ...g, effect } : g))
      .filter((g) => g.category || !g.zones.some((z) => touched.has(z))),
  };
}

export function categoryEffect(scene: Scene, category: CategoryId | "all"): Effect {
  const id = category === "all" ? "fans" : category;
  return scene.groups.find((g) => g.category === id)?.effect ?? DEFAULT_EFFECT;
}

// --- Dispositivos ---

// Clave estable de cada dispositivo, igual que openrgb::device_keys: su
// nombre, y si hay varios iguales (los dos módulos de RAM se llaman "ENE
// DRAM") el orden entre ellos. El número que da OpenRGB puede cambiar si
// aparece un dispositivo nuevo.
export function deviceKeys(devices: RgbDevice[]): Map<number, string> {
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  for (const device of [...devices].sort((a, b) => a.index - b.index)) {
    const n = (seen.get(device.name) ?? 0) + 1;
    seen.set(device.name, n);
    keys.set(device.index, n === 1 ? device.name : `${device.name}#${n}`);
  }
  return keys;
}

export const zoneKey = (deviceKey: string, zoneName: string) => `${deviceKey}|${zoneName}`;

export function allZoneKeys(devices: RgbDevice[], indices: number[] = []): string[] {
  const keys = deviceKeys(devices);
  return devices
    .filter((d) => indices.length === 0 || indices.includes(d.index))
    .flatMap((d) => d.zones.map((z) => zoneKey(keys.get(d.index)!, z.name)));
}

// Los conectores ARGB de la placa: la placa no sabe qué hay enchufado.
export const isResizable = (zone: RgbZone) => zone.ledsMax > zone.ledsMin;

const ZONE_LABELS: Record<string, string> = {
  "Chipset Accent": "Luz del chipset",
  LED_C: "Luz de la placa",
  DRAM: "Módulo",
  Keyboard: "Teclado",
  Microphone: "Micrófono",
};

export function zoneLabel(zone: RgbZone): string {
  const argb = zone.name.match(/^ARGB(?:_V\d)?_(\d+)$/i);
  if (argb) return `Conector ARGB ${argb[1]}`;
  return ZONE_LABELS[zone.name] ?? zone.name;
}

// "ENE DRAM" dos veces -> "RAM · módulo 1" y "RAM · módulo 2".
export function deviceTitle(device: RgbDevice, devices: RgbDevice[]): string {
  const same = devices.filter((d) => d.name === device.name).sort((a, b) => a.index - b.index);
  const base = device.kind === "RAM" ? "RAM" : device.name;
  return same.length > 1 ? `${base} · módulo ${same.indexOf(device) + 1}` : base;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export const rgbToHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function normalizeHex(text: string): string {
  return `#${text.trim().replace("#", "").toUpperCase()}`;
}

export const listDevices = () => invoke<RgbDevice[]>("rgb_listar");

export function resizeZone(device: RgbDevice, zone: RgbZone, size: number) {
  return invoke<RgbDevice>("rgb_redimensionar_zona", {
    dispositivo: device.index,
    zona: zone.index,
    tamano: size,
  });
}

// Un efecto en dispositivos enteros (la tool de Miku, "todo a la vez" en el
// panel). Vacío = todos. Devuelve los nombres de los que cambió.
export async function applyToDevices(effect: Effect, indices: number[]): Promise<string[]> {
  const devices = await listDevices();
  const targets = devices.filter((d) => indices.length === 0 || indices.includes(d.index));
  const state = await loadLightsState();
  const zones = allZoneKeys(devices, indices);
  // Todo a la vez: los cuatro grupos del panel con este efecto.
  const scene =
    indices.length === 0
      ? withCategoryEffect(normalizeScene(state.scene, devices), "all", effect)
      : withZonesEffect(normalizeScene(state.scene, devices), zones, effect);
  await setScene(scene);
  return targets.map((d) => deviceTitle(d, devices));
}

// Al arrancar: vuelve a poner los tamaños de los conectores y le manda al
// motor la escena guardada. El servicio de OpenRGB puede estar todavía
// detectando si la PC recién prendió, así que se reintenta un par de veces
// (el motor solo, por su lado, se reconecta cuando OpenRGB vuelve).
export async function restoreLights() {
  const state = await loadLightsState();
  if (state.scene) {
    await sendGlobal(state.global);
    await sendScene(state.scene);
  }
  if (Object.keys(state.sizes).length === 0) return;
  for (const waitMs of [0, 20000, 60000]) {
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const devices = await listDevices();
      if (devices.length === 0) continue;
      const keys = deviceKeys(devices);
      for (const device of devices) {
        let current = device;
        for (const zone of device.zones) {
          const size = state.sizes[zoneKey(keys.get(device.index)!, zone.name)];
          if (size !== undefined && isResizable(zone) && zone.leds !== size) {
            current = await resizeZone(current, zone, size);
          }
        }
      }
      console.log("[Luces] Tamaños de los conectores restaurados.");
      return;
    } catch (err) {
      console.warn("[Luces] Todavía no se pudieron restaurar:", err);
    }
  }
}
