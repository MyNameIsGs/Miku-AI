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

export const EFFECT_KINDS = [
  "static",
  "breathe",
  "heartbeat",
  "rainbow",
  "wave",
  "flow",
  "comet",
  "sparkle",
  "fire",
  // Reactivos (fase 4): la música de la PC, la voz y el ánimo de Miku, la
  // pantalla, y los avisos (transparente salvo el destello: para capas).
  "music",
  "voice",
  "mood",
  "screen",
  "notify",
] as const;
export const REACTIVE_KINDS: EffectKind[] = ["music", "voice", "mood", "screen", "notify"];
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EFFECT_NAMES: Record<EffectKind, string> = {
  static: "Estático",
  breathe: "Respirar",
  heartbeat: "Latido",
  rainbow: "Arcoíris",
  wave: "Ola",
  flow: "Degradado",
  comet: "Cometa",
  sparkle: "Destellos",
  fire: "Fuego",
  music: "Música",
  voice: "Su voz",
  mood: "Su ánimo",
  screen: "Pantalla",
  notify: "Avisos",
};

// Qué hace cada efecto, en una línea (el panel y Miku leen lo mismo).
export const EFFECT_HINTS: Record<EffectKind, string> = {
  static: "Un color o un degradado quieto.",
  breathe: "Sube y baja suave; con varios colores, uno por respiración.",
  heartbeat: "Dos golpes seguidos y una pausa, como un corazón.",
  flow: "Los colores se mezclan y corren a lo largo de cada zona.",
  rainbow: "Recorre sus colores como un arcoíris (con la paleta Arcoíris, todo el espectro).",
  wave: "Una banda de colores que cruza el gabinete.",
  comet: "Un punto con estela; en los ventiladores gira.",
  sparkle: "LEDs al azar que se prenden y apagan.",
  fire: "Parpadeo como una llama, entre sus colores (del más oscuro al más claro).",
  music: "Pulsa con cada golpe de lo que suena en la PC y cambia de color.",
  voice: "Respira con la voz de Miku; rosa cuando escucha, barrido cuando piensa.",
  mood: "El color de su ánimo, más fuerte cuanto más lo siente.",
  screen: "El color promedio de la pantalla (ambilight).",
  notify: "Apagado, salvo un destello con cada aviso. Mejor como capa.",
};

// Cuántos de sus colores usa cada efecto (para que Miku no elija de más).
export const EFFECT_COLOR_USE: Record<EffectKind, string> = {
  static: "1 o más (varios = degradado)",
  breathe: "1 o más (uno por respiración)",
  heartbeat: "solo el primero",
  flow: "2 o más",
  rainbow: "2 o más (con menos, el espectro entero)",
  wave: "1 o más",
  comet: "solo el primero",
  sparkle: "1 o más (cada destello elige uno)",
  fire: "1 o más (sin colores, la llama naranja de siempre)",
  music: "1 o más (cambia con cada golpe)",
  voice: "solo el primero (su color en reposo)",
  mood: "ninguno (usa el color de cada ánimo)",
  screen: "los de fuera de un juego, con 'juegos'",
  notify: "el primero (si no, el color de cada aviso)",
};

export const MAX_EFFECT_COLORS = 6;

// Paletas listas: un clic las pone enteras en cualquier efecto. Fuego y
// Arcoíris son además lo que usan esos efectos si no traen colores propios
// (antes los tenían fijos en el motor; con estos colores se ven igual).
export const COLOR_PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: "fuego", name: "Fuego", colors: ["#FF3C00", "#FFBE28"] },
  { id: "arcoiris", name: "Arcoíris", colors: ["#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF"] },
  { id: "miku", name: "Miku", colors: ["#39C5BB", "#F0508F"] },
];
export const paletteColors = (id: string) => COLOR_PALETTES.find((p) => p.id === id)?.colors ?? null;

// Los colores con que arranca un efecto cuando se lo elige sin colores.
export const DEFAULT_EFFECT_COLORS: Partial<Record<EffectKind, string[]>> = {
  fire: paletteColors("fuego")!,
  rainbow: paletteColors("arcoiris")!,
};

export type Effect = {
  kind: EffectKind;
  colors: string[]; // "#39C5BB"
  speed: number; // 1-100
  brightness: number; // 0-100
  size: number; // 1-100
  direction: 1 | -1;
  // Variante (ver Effect en lights_engine.rs): en "music", "" (golpe) |
  // "vumetro" | "espectro"; en "screen", "juegos" = solo con un juego.
  mode?: string;
};

export const MUSIC_MODES: { id: string; name: string; hint: string }[] = [
  { id: "", name: "Golpe", hint: "Pulsa con cada golpe y cambia de color." },
  { id: "vumetro", name: "Vúmetro", hint: "Cada zona se llena según el volumen." },
  { id: "espectro", name: "Espectro", hint: "A lo largo de cada zona, de los graves a los agudos." },
];

// `category`: grupo del panel (ver CATEGORIES). Sin category, es una zona
// con su propio efecto (un color elegido a mano en Dispositivos), que se
// dibuja encima de su grupo. El motor no mira estos campos.
export type LightGroup = { zones: string[]; effect: Effect; category?: CategoryId; layers?: Layer[] };

// Un efecto apilado encima del de base del grupo (fase 4).
export type LayerBlend = "normal" | "add" | "multiply" | "screen";
export type Layer = { effect: Effect; opacity: number; blend: LayerBlend; visible: boolean };
export const BLEND_NAMES: Record<LayerBlend, string> = { normal: "Normal", add: "Sumar", multiply: "Multiplicar", screen: "Aclarar" };
// Cómo está armada una zona de verdad (fase 3, ver ZoneOptions en
// lights_engine.rs): ventiladores encadenados en un conector, dónde está
// el LED 1 de cada uno, el sentido, y la corrección de color (0 a 1 por
// canal).
// ledLevels: fuerza de cada LED (0 a 1), para zonas chicas con LEDs que
// se ven distinto (el micrófono: arriba y abajo).
export type ZoneOptions = { fans: number; offset: number; reverse: boolean; gain: [number, number, number]; ledLevels?: number[] };
export const DEFAULT_ZONE_OPTIONS: ZoneOptions = { fans: 1, offset: 0, reverse: false, gain: [1, 1, 1] };

export type Scene = {
  groups: LightGroup[];
  // Posición de cada zona en el mapa del gabinete (0 a 1 en cada eje); el
  // motor usa la x para que la ola cruce el PC entero.
  positions: Record<string, number>;
  layout?: Record<string, { x: number; y: number }>;
  zones?: Record<string, ZoneOptions>;
  // Zonas que Miku no toca.
  excluded?: string[];
  // Las tiras del teclado AULA (no pasan por OpenRGB, ver
  // keyboard_strips.rs). Sin esto, quedan como estén.
  keyboardStrips?: KeyboardStrips;
  // Dispositivos que Miku no maneja y quedan en un modo de su propio
  // hardware (clave del dispositivo -> nombre del modo, ej. "Rainbow").
  hardwareModes?: Record<string, string>;
};

export const setHardwareMode = (device: RgbDevice, mode: string) => invoke("rgb_modo_hardware", { dispositivo: device.index, modo: mode });
export const redoDirect = (device: RgbDevice) => invoke("luces_rehacer_directo", { nombre: device.name });

// --- Tiras del teclado AULA F87 Pro ---
//
// Modos y colores propios del teclado: no aceptan cualquier color ni
// efectos cuadro a cuadro, y cada cambio hace parpadear el teclado entero
// (por eso solo se escriben cuando cambian).

export type KeyboardStrips = {
  // Las dos de abajo, a izquierda y derecha.
  bottom: { mode: number; color: number; brightness: number; speed: number };
  // La de arriba, debajo del bloque DEL/END/PgDn.
  top: { mode: number; color: number };
  // El color sigue al grupo Periféricos de la escena (el más parecido de
  // los 7).
  follow?: boolean;
};

export const STRIP_MODES = ["Apagadas", "Arcoíris", "Arcoíris 2", "Sólido", "Respirar"];
// Mismo orden que los números del teclado.
export const STRIP_COLORS = [
  { name: "Rojo", hex: "#FF2A2A" },
  { name: "Verde", hex: "#2AE05A" },
  { name: "Azul", hex: "#2F6BFF" },
  { name: "Amarillo", hex: "#FFE14D" },
  { name: "Rosa", hex: "#F0508F" },
  { name: "Azul claro", hex: "#4DE3F0" },
  { name: "Blanco", hex: "#FFFFFF" },
];
// Brillo (5 niveles) y velocidad (lento, medio, rápido) de las de abajo,
// desde 0; más = más. Un valor más alto reinicia el teclado a fábrica.
export const STRIP_BRIGHTNESS_MAX = 4;
export const STRIP_SPEED_MAX = 2;
// Los modos que usan el color (los arcoíris lo ignoran).
export const stripUsesColor = (mode: number) => mode === 3 || mode === 4;

// El color de las tiras más parecido a uno cualquiera: blanco si es casi
// gris; si no, el más cercano de los otros 6 (comparando a pleno brillo,
// para que un rojo oscuro siga siendo rojo).
export function nearestStripColor(hex: string): number {
  const rgb = hexToRgb(hex);
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  if (max === 0 || (max - min) / max < 0.25) return 6;
  const full = rgb.map((x) => (x * 255) / max);
  let best = 0;
  let bestDistance = Infinity;
  STRIP_COLORS.slice(0, 6).forEach((c, i) => {
    const distance = hexToRgb(c.hex).reduce((sum, x, k) => sum + (x - full[k]) ** 2, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

// Las tiras que tocan con esta escena (con "seguir a la escena" ya
// resuelto), o null si la escena no dice nada de ellas.
export function resolveStrips(scene: Scene): KeyboardStrips | null {
  const s = scene.keyboardStrips;
  if (!s) return null;
  if (!s.follow) return s;
  const first = scene.groups.find((g) => g.category === "periph")?.effect.colors[0];
  if (!first) return s;
  const color = nearestStripColor(first);
  return { ...s, bottom: { ...s.bottom, color }, top: { ...s.top, color } };
}

export const readStrips = () => invoke<KeyboardStrips>("teclado_tiras_leer");

// Para guardar un perfil: si la escena todavía no dice nada de las tiras,
// se anota cómo están ahora en el teclado (si está conectado), así el
// perfil también las pone.
export async function withStripsSnapshot(scene: Scene): Promise<Scene> {
  if (scene.keyboardStrips) return scene;
  const strips = await readStrips().catch(() => null);
  return strips ? { ...scene, keyboardStrips: strips } : scene;
}

export function describeStrips(s: KeyboardStrips): string {
  const one = (mode: number, color: number) => (stripUsesColor(mode) ? `${STRIP_MODES[mode]} ${STRIP_COLORS[color]?.name.toLowerCase() ?? ""}` : STRIP_MODES[mode]);
  const bottom = one(s.bottom.mode, s.bottom.color);
  const top = one(s.top.mode, s.top.color);
  return bottom === top ? bottom : `${bottom} · arriba ${top.toLowerCase()}`;
}

let lastStrips = "";
let lastScene: Scene | null = null;
let lightsOn = true;
// Escribe las tiras solo si cambiaron desde la última vez (y el teclado
// mismo no escribe si ya estaba así). Con las luces apagadas desde el
// interruptor general, se apagan también.
async function syncStrips(scene: Scene) {
  lastScene = scene;
  const strips = resolveStrips(scene);
  if (!strips) return;
  const payload = lightsOn
    ? { bottom: strips.bottom, top: strips.top }
    : { bottom: { ...strips.bottom, mode: 0 }, top: { ...strips.top, mode: 0 } };
  const key = JSON.stringify(payload);
  if (key === lastStrips) return;
  lastStrips = key;
  try {
    await invoke("teclado_tiras_poner", { tiras: payload });
  } catch (err) {
    lastStrips = "";
    console.warn("[Luces] No se pudieron cambiar las tiras del teclado:", err);
  }
}

export const zoneOptions = (scene: Scene | null, key: string): ZoneOptions => ({ ...DEFAULT_ZONE_OPTIONS, ...scene?.zones?.[key] });
// exitMode: qué quedan las luces al cerrar Miku (ver on_exit en
// lights_engine.rs): el color fijo de la escena, o apagadas.
export type LightsGlobal = { on: boolean; brightness: number; paused: boolean; fps: number; exitMode?: "static" | "off" };

// La corrección de color de una zona, tal como se guardó con «Guardar» en
// el panel (Dispositivos): «Volver a lo guardado» la trae de vuelta.
export type ZoneCorrection = { gain: [number, number, number]; ledLevels?: number[] };

type LightsState = {
  sizes: Record<string, number>;
  scene: Scene | null;
  global: LightsGlobal;
  savedCorrection?: Record<string, ZoneCorrection>;
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
    return { sizes: saved?.sizes ?? {}, scene, global: { ...DEFAULT_GLOBAL, ...saved?.global }, savedCorrection: saved?.savedCorrection };
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
    groups: scene.groups.map((g) => ({
      zones: g.zones,
      effect: { ...g.effect, colors: g.effect.colors.map(hexToRgb) },
      layers: (g.layers ?? []).map((l) => ({ ...l, effect: { ...l.effect, colors: l.effect.colors.map(hexToRgb) } })),
    })),
    positions: scene.positions,
    zones: scene.zones ?? {},
    excluded: scene.excluded ?? [],
  };
}

export async function sendScene(scene: Scene) {
  await invoke("luces_escena", { escena: toEngine(scene) });
  void syncStrips(scene);
}
export async function sendGlobal(global: LightsGlobal) {
  await invoke("luces_global", { global });
  if (global.on !== lightsOn) {
    lightsOn = global.on;
    if (lastScene) void syncStrips(lastScene);
  }
}
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

// Un perfil (o la escena de antes de «Que Miku lo decida») trae su aspecto:
// efectos, capas, tiras. Lo que es del equipo -- corrección de color,
// ventiladores, el mapa, qué dispositivos maneja Miku -- queda como está
// ahora; si no, poner un perfil devolvía la corrección vieja que tenía
// guardada adentro.
export function withSetupOf(look: Scene, current: Scene | null): Scene {
  if (!current) return look;
  return {
    ...look,
    positions: current.positions,
    layout: current.layout,
    zones: current.zones,
    excluded: current.excluded,
    hardwareModes: current.hardwareModes,
  };
}

// La zona pasa a tener su propio efecto: sale del grupo donde estaba.
export function withZoneEffect(scene: Scene | null, zoneKey: string, effect: Effect): Scene {
  // Los grupos del panel la siguen nombrando (el efecto propio se dibuja
  // encima); de los demás sale.
  const groups = (scene?.groups ?? [])
    .map((g) => (g.category ? g : { ...g, zones: g.zones.filter((z) => z !== zoneKey) }))
    .filter((g) => g.category || g.zones.length > 0);
  return { ...scene, groups: [...groups, { zones: [zoneKey], effect }], positions: scene?.positions ?? {} };
}

// Varias zonas juntas con un mismo efecto (las demás quedan como estaban).
export function withZonesEffect(scene: Scene | null, zoneKeys: string[], effect: Effect): Scene {
  const set = new Set(zoneKeys);
  const groups = (scene?.groups ?? [])
    .map((g) => (g.category ? g : { ...g, zones: g.zones.filter((z) => !set.has(z)) }))
    .filter((g) => g.category || g.zones.length > 0);
  return { ...scene, groups: [...groups, { zones: zoneKeys, effect }], positions: scene?.positions ?? {} };
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
  return { ...scene, groups: [...groups, ...own], positions: scene?.positions ?? {} };
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

export function categoryLayers(scene: Scene, category: CategoryId | "all"): Layer[] {
  const id = category === "all" ? "fans" : category;
  return scene.groups.find((g) => g.category === id)?.layers ?? [];
}

export function withCategoryLayers(scene: Scene, category: CategoryId | "all", layers: Layer[]): Scene {
  const ids = category === "all" ? CATEGORIES.map((c) => c.id) : [category];
  return { ...scene, groups: scene.groups.map((g) => (g.category && ids.includes(g.category) ? { ...g, layers } : g)) };
}

// --- Señales para los efectos reactivos (ver lights_engine.rs) ---

// El color de cada ánimo para el efecto "Su ánimo", si ella no eligió
// otro.
export const MOOD_COLORS: Record<string, string> = {
  happy: "#FFD166",
  angry: "#FF3B3B",
  sad: "#2F6BFF",
  relaxed: "#3DDC84",
  neutral: "#39C5BB",
};
const MOOD_STRENGTH: Record<string, number> = { neutral: 0, un_poco: 0.35, normal: 0.7, muy: 1 };
// Los que eligió ella (fase 6, ver mikuLights.ts) mandan sobre los de arriba.
let moodOverrides: Record<string, string> = {};
let lastMood: { mood: string; level: string } | null = null;
export const moodColor = (mood: string) => moodOverrides[mood] ?? MOOD_COLORS[mood] ?? MOOD_COLORS.neutral;
export function setMoodColorOverrides(colors: Record<string, string>) {
  moodOverrides = colors;
  if (lastMood) void sendMood(lastMood.mood, lastMood.level);
}

const quiet = (p: Promise<unknown>) => p.catch(() => {});
export const sendVoiceLevel = (level: number) => quiet(invoke("luces_voz", { nivel: level }));
export const sendMikuState = (state: string) => quiet(invoke("luces_estado_miku", { estado: state }));
export function sendMood(mood: string, level: string) {
  lastMood = { mood, level };
  return quiet(invoke("luces_animo", { color: hexToRgb(moodColor(mood)), fuerza: MOOD_STRENGTH[level] ?? 0 }));
}
// Destello en las capas "Avisos" (correo, recordatorio, evento).
export const flashLights = (hex?: string) => quiet(invoke("luces_destello", { color: hex ? hexToRgb(hex) : null }));

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

// Fuego y Arcoíris tenían los colores fijos en el motor y los que traían
// guardados (casi siempre el turquesa y rosa por defecto) no se veían. Ahora
// los usan: una sola vez, a todo fuego y arcoíris guardado (escena, capas,
// perfiles, los efectos de Miku) se le ponen los de su paleta, para que se
// vean igual que antes.
const PALETTES_MIGRATED_KEY = "lightsFireRainbowColors";

function withPaletteColors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withPaletteColors);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = withPaletteColors(v);
  const kind = out.kind as EffectKind;
  if ((kind === "fire" || kind === "rainbow") && Array.isArray(out.colors)) out.colors = DEFAULT_EFFECT_COLORS[kind];
  return out;
}

async function migrateFireRainbowColors() {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    if (await store.get<boolean>(PALETTES_MIGRATED_KEY)) return;
    for (const key of [STORE_KEY, "lightProfiles", "lightsMiku"]) {
      const saved = await store.get(key);
      if (saved !== undefined) await store.set(key, withPaletteColors(saved));
    }
    await store.set(PALETTES_MIGRATED_KEY, true);
    await store.save();
  } catch (err) {
    console.error("[Luces] No se pudieron pasar los colores de fuego y arcoíris:", err);
  }
}

// Al arrancar: vuelve a poner los tamaños de los conectores y le manda al
// motor la escena guardada. El servicio de OpenRGB puede estar todavía
// detectando si la PC recién prendió, así que se reintenta un par de veces
// (el motor solo, por su lado, se reconecta cuando OpenRGB vuelve).
export async function restoreLights() {
  await migrateFireRainbowColors();
  const state = await loadLightsState();
  if (state.scene) {
    await sendGlobal(state.global);
    await sendScene(state.scene);
  }
  // Los modos de hardware elegidos (la RAM, por ejemplo, vuelve a su efecto
  // de fábrica al reiniciar la PC).
  const modes = Object.entries(state.scene?.hardwareModes ?? {});
  if (modes.length > 0) {
    listDevices()
      .then((devices) => {
        const keys = deviceKeys(devices);
        for (const device of devices) {
          const mode = state.scene?.hardwareModes?.[keys.get(device.index) ?? ""];
          if (mode) setHardwareMode(device, mode).catch((err) => console.warn("[Luces] Modo de hardware:", err));
        }
      })
      .catch((err) => console.warn("[Luces] Modos de hardware:", err));
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
