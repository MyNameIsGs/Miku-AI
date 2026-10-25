import { load } from "@tauri-apps/plugin-store";
import {
  CATEGORIES,
  CategoryId,
  EFFECT_KINDS,
  Effect,
  EffectKind,
  KeyboardStrips,
  STRIP_COLORS,
  STRIP_MODES,
  Scene,
  listDevices,
  loadLightsState,
  makeEffect,
  normalizeScene,
  readStrips,
  setMoodColorOverrides,
  setScene,
  withCategoryEffect,
} from "./lights";

// Lo de Miku en las luces (fase 6 de docs/luces-argb/PLAN.md):
// - sus efectos: los diseña ella (tool controlar_luces, 'crear_efecto') a
//   partir de los efectos base, con nombre, y quedan en la galería del
//   panel con su autoría;
// - los colores de su ánimo para el efecto "Su ánimo" (si no eligió, los
//   de MOOD_COLORS);
// - "Que Miku lo decida": con el interruptor prendido, ella elige las luces
//   cuando cambia el momento (ver decideLights).
// Nada de esto se le inventa: lo decide ella cuando le nace (ver
// feedback "Miku crece con Sebastián").

export type MikuEffect = { id: string; name: string; description: string; effect: Effect; created: string };

export type MikuDecides = {
  on: boolean;
  // La escena que había al prenderlo: vuelve al apagarlo.
  savedScene: Scene | null;
  // Lo último que eligió y por qué (lo muestra el panel).
  lastNote: string | null;
  lastAt: number | null;
};

export type MikuLightsState = { effects: MikuEffect[]; moodColors: Record<string, string>; decides: MikuDecides };

const STORE_KEY = "lightsMiku";
const EMPTY: MikuLightsState = { effects: [], moodColors: {}, decides: { on: false, savedScene: null, lastNote: null, lastAt: null } };
const MAX_EFFECTS = 24;

export async function loadMikuLights(): Promise<MikuLightsState> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const saved = await store.get<Partial<MikuLightsState>>(STORE_KEY);
    return { ...EMPTY, ...saved, decides: { ...EMPTY.decides, ...saved?.decides } };
  } catch (err) {
    console.error("[Luces] No se pudo cargar lo de Miku:", err);
    return EMPTY;
  }
}

export async function saveMikuLights(state: MikuLightsState) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, state);
    await store.save();
  } catch (err) {
    console.error("[Luces] No se pudo guardar lo de Miku:", err);
  }
  setMoodColorOverrides(state.moodColors);
  listeners.forEach((fn) => fn(state));
}

// El panel se entera cuando ella crea un efecto o decide algo.
const listeners = new Set<(state: MikuLightsState) => void>();
export function onMikuLightsChange(fn: (state: MikuLightsState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Al abrir la app: sus colores de ánimo al motor.
export async function restoreMikuLights() {
  setMoodColorOverrides((await loadMikuLights()).moodColors);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Guarda (o reemplaza, si ya tenía uno con ese nombre) un efecto suyo.
export async function saveMikuEffect(name: string, description: string, effect: Effect): Promise<MikuEffect> {
  const state = await loadMikuLights();
  const existing = state.effects.find((e) => sameName(e.name, name));
  const item: MikuEffect = {
    id: existing?.id ?? Math.random().toString(36).slice(2, 10),
    name: name.trim(),
    description: description.trim(),
    effect,
    created: new Date().toISOString().slice(0, 10),
  };
  const effects = [...state.effects.filter((e) => e.id !== item.id), item].slice(-MAX_EFFECTS);
  await saveMikuLights({ ...state, effects });
  return item;
}

export async function deleteMikuEffect(id: string) {
  const state = await loadMikuLights();
  await saveMikuLights({ ...state, effects: state.effects.filter((e) => e.id !== id) });
}

export const findMikuEffect = (state: MikuLightsState, name: string) => state.effects.find((e) => sameName(e.name, name)) ?? null;

export async function setMikuMoodColor(mood: string, hex: string) {
  const state = await loadMikuLights();
  await saveMikuLights({ ...state, moodColors: { ...state.moodColors, [mood]: hex } });
}

// --- "Que Miku lo decida" ---

export async function setMikuDecides(on: boolean) {
  const state = await loadMikuLights();
  if (on === state.decides.on) return;
  if (on) {
    const { scene } = await loadLightsState();
    await saveMikuLights({ ...state, decides: { on: true, savedScene: scene, lastNote: null, lastAt: null } });
  } else {
    // Vuelve lo que había antes de dejarla decidir.
    if (state.decides.savedScene) await setScene(state.decides.savedScene);
    await saveMikuLights({ ...state, decides: { on: false, savedScene: null, lastNote: null, lastAt: null } });
  }
}

// Lo que ella contesta (ver prompts/lightsDecisionPrompt.ts).
export type LightsChoice = {
  nota?: string;
  grupos?: Partial<Record<"todo" | "ventiladores" | "ram" | "placa" | "perifericos", ChoiceEffect>>;
  tiras?: { modo?: string; color?: string };
};
type ChoiceEffect = { efecto?: string; suyo?: string; colores?: string[]; velocidad?: number; brillo?: number };

const GROUP_IDS: Record<string, CategoryId | "all"> = { todo: "all", ventiladores: "fans", ram: "ram", placa: "board", perifericos: "periph" };
const HEX = /^#?([0-9a-f]{6})$/i;

// Saca el JSON de la respuesta (puede venir con texto o ``` alrededor).
// null = no quiere cambiar nada.
export function parseChoice(reply: string): LightsChoice | null {
  if (/^\s*SILENCIO\b/i.test(reply)) return null;
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(reply.slice(start, end + 1));
    if (!data || typeof data !== "object" || data.cambiar === false) return null;
    return data as LightsChoice;
  } catch {
    return null;
  }
}

function choiceToEffect(choice: ChoiceEffect, base: Effect, mine: MikuLightsState): Effect | null {
  if (choice.suyo) {
    const own = findMikuEffect(mine, choice.suyo);
    if (own) return own.effect;
  }
  const kind = (choice.efecto ?? base.kind) as EffectKind;
  if (!EFFECT_KINDS.includes(kind)) return null;
  const colors = (choice.colores ?? []).map((c) => String(c).match(HEX)).filter(Boolean).map((m) => `#${m![1].toUpperCase()}`);
  const clamp = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
  return makeEffect(kind, colors.length > 0 ? colors.slice(0, 6) : base.colors, {
    speed: clamp(choice.velocidad, 1, 100, 50),
    brightness: clamp(choice.brillo, 0, 100, 100),
  });
}

// Lo que eligió, sobre la escena actual. Devuelve la escena nueva (o null
// si no había nada válido que cambiar).
export async function applyChoice(choice: LightsChoice): Promise<Scene | null> {
  const [devices, state, mine] = await Promise.all([listDevices(), loadLightsState(), loadMikuLights()]);
  let scene = normalizeScene(state.scene, devices);
  let changed = false;
  // "todo" primero, para que un grupo puntual quede encima.
  const entries = Object.entries(choice.grupos ?? {}).sort(([a], [b]) => (a === "todo" ? -1 : b === "todo" ? 1 : 0));
  for (const [name, fx] of entries) {
    const id = GROUP_IDS[name];
    if (!id || !fx) continue;
    const current = scene.groups.find((g) => g.category === (id === "all" ? "fans" : id))?.effect ?? makeEffect("static", ["#39C5BB"]);
    const effect = choiceToEffect(fx, current, mine);
    if (!effect) continue;
    scene = withCategoryEffect(scene, id, effect);
    changed = true;
  }
  if (choice.tiras && devices.some((d) => /aula/i.test(d.name))) {
    const mode = STRIP_MODES.findIndex((m) => sameName(m, choice.tiras!.modo ?? ""));
    const color = STRIP_COLORS.findIndex((c) => sameName(c.name, choice.tiras!.color ?? ""));
    if (mode >= 0 || color >= 0) {
      const current: KeyboardStrips = scene.keyboardStrips ?? (await readStrips());
      scene = {
        ...scene,
        keyboardStrips: {
          ...current,
          follow: color >= 0 ? false : current.follow,
          bottom: { ...current.bottom, mode: mode >= 0 ? mode : current.bottom.mode, color: color >= 0 ? color : current.bottom.color },
          top: { mode: mode >= 0 ? mode : current.top.mode, color: color >= 0 ? color : current.top.color },
        },
      };
      changed = true;
    }
  }
  if (!changed) return null;
  await setScene(scene);
  return scene;
}

// La escena de ahora, en palabras, para que ella sepa de dónde parte.
export function describeScene(scene: Scene | null, mine: MikuLightsState): string {
  if (!scene) return "(sin escena todavía)";
  const lines = CATEGORIES.map((c) => {
    const fx = scene.groups.find((g) => g.category === c.id)?.effect;
    if (!fx) return null;
    const own = mine.effects.find((e) => JSON.stringify(e.effect) === JSON.stringify(fx));
    return `- ${c.name}: ${own ? `tu efecto "${own.name}"` : `${fx.kind} ${fx.colors.join(" ")} (velocidad ${fx.speed})`}`;
  }).filter(Boolean);
  const s = scene.keyboardStrips;
  if (s) lines.push(`- Tiras del teclado: ${STRIP_MODES[s.bottom.mode]} ${STRIP_COLORS[s.bottom.color]?.name ?? ""}`);
  return lines.join("\n");
}
