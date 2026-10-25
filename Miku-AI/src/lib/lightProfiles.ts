import { load } from "@tauri-apps/plugin-store";
import { LightsGlobal, Scene, loadLightsState, saveLightsState, sendGlobal, sendScene } from "./lights";

// Perfiles y reglas automáticas de las luces (fase 5 de
// docs/luces-argb/PLAN.md). Un perfil es una escena guardada con nombre;
// una regla dice "cuando pasa esto, pon aquello" (un perfil, un brillo
// máximo, o apagar). Las reglas van en orden: la primera que se cumple
// manda.
//
// Lo automático no pisa lo tuyo: la escena que armas en el panel es la
// "base" (se guarda como siempre), y una regla solo cambia lo que hace el
// motor mientras se cumple. Se aplica al entrar y al salir de una regla,
// no a cada rato: si mientras tanto tocas algo en el panel, eso manda
// hasta que cambie la situación.

export type Profile = {
  id: string;
  name: string;
  scene: Scene;
  favorite: boolean;
  // "miku": lo armó ella (fase 6).
  by?: "miku";
};

export type RuleWhen =
  | { kind: "game"; match: string } // match vacío = cualquier juego
  | { kind: "stream" }
  | { kind: "sleeping" }
  | { kind: "music" }
  | { kind: "schedule"; from: string; to: string } // "HH:MM"
  | { kind: "away"; minutes: number };

export type RuleThen = { kind: "profile"; profileId: string } | { kind: "brightness"; value: number } | { kind: "off" };

export type Rule = { id: string; when: RuleWhen; then: RuleThen; enabled: boolean };

type ProfilesState = { profiles: Profile[]; rules: Rule[]; activeProfileId: string | null };

const STORE_KEY = "lightProfiles";
const EMPTY: ProfilesState = { profiles: [], rules: [], activeProfileId: null };

export const newId = () => Math.random().toString(36).slice(2, 10);

export async function loadProfiles(): Promise<ProfilesState> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    return { ...EMPTY, ...(await store.get<Partial<ProfilesState>>(STORE_KEY)) };
  } catch (err) {
    console.error("[Luces] No se pudieron cargar los perfiles:", err);
    return EMPTY;
  }
}

export async function saveProfiles(state: ProfilesState) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, state);
    await store.save();
  } catch (err) {
    console.error("[Luces] No se pudieron guardar los perfiles:", err);
  }
}

// Los favoritos, en orden, son los de Ctrl+Alt+1…9.
export const favoriteSlots = (profiles: Profile[]) => profiles.filter((p) => p.favorite).slice(0, 9);

// Aplicar un perfil a mano: pasa a ser la escena de base.
export async function applyProfile(profile: Profile) {
  const state = await loadLightsState();
  await sendScene(profile.scene);
  await saveLightsState({ ...state, scene: profile.scene });
  const profiles = await loadProfiles();
  await saveProfiles({ ...profiles, activeProfileId: profile.id });
  // Lo automático vuelve a mirar desde cero.
  lastRule = undefined;
}

// --- Reglas ---

export type RuleContext = {
  game: string | null; // nombre del juego en primer plano (modo juego), o null
  stream: boolean;
  sleeping: boolean;
  music: boolean;
  awayMinutes: number;
  now: Date;
};

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function ruleMatches(rule: Rule, ctx: RuleContext): boolean {
  const w = rule.when;
  switch (w.kind) {
    case "game":
      return ctx.game !== null && (w.match.trim() === "" || ctx.game.toLowerCase().includes(w.match.trim().toLowerCase()));
    case "stream":
      return ctx.stream;
    case "sleeping":
      return ctx.sleeping;
    case "music":
      return ctx.music;
    case "schedule": {
      const now = ctx.now.getHours() * 60 + ctx.now.getMinutes();
      const from = minutesOf(w.from);
      const to = minutesOf(w.to);
      // De 0:00 a 7:00, o cruzando la medianoche (de 23:00 a 7:00).
      return from <= to ? now >= from && now < to : now >= from || now < to;
    }
    case "away":
      return ctx.awayMinutes >= w.minutes;
  }
}

export function describeWhen(w: RuleWhen): string {
  switch (w.kind) {
    case "game":
      return w.match.trim() ? `Jugando a ${w.match.trim()}` : "Jugando cualquier juego";
    case "stream":
      return "En vivo en OBS";
    case "sleeping":
      return "Miku durmiendo";
    case "music":
      return "Suena música";
    case "schedule":
      return `De ${w.from} a ${w.to}`;
    case "away":
      return `Ausente ${w.minutes} min`;
  }
}

export function describeThen(t: RuleThen, profiles: Profile[]): string {
  switch (t.kind) {
    case "profile":
      return profiles.find((p) => p.id === t.profileId)?.name ?? "Perfil borrado";
    case "brightness":
      return `Brillo al ${t.value}%`;
    case "off":
      return "Apagar";
  }
}

// La regla que se aplicó la última vez (undefined = todavía no se evaluó;
// null = ninguna).
let lastRule: string | null | undefined;

export function activeRuleId(): string | null {
  return lastRule ?? null;
}

// Mira la situación y, si cambió qué regla manda, se lo dice al motor.
export async function evaluateRules(ctx: RuleContext) {
  const { rules, profiles } = await loadProfiles();
  const rule = rules.find((r) => r.enabled && ruleMatches(r, ctx)) ?? null;
  const id = rule?.id ?? null;
  if (id === lastRule) return;
  lastRule = id;
  const base = await loadLightsState();
  if (!base.scene) return;
  let scene: Scene = base.scene;
  let global: LightsGlobal = base.global;
  if (rule?.then.kind === "profile") {
    const ruleProfile = rule.then.profileId;
    scene = profiles.find((p) => p.id === ruleProfile)?.scene ?? scene;
  } else if (rule?.then.kind === "brightness") {
    global = { ...global, brightness: Math.min(global.brightness, rule.then.value) };
  } else if (rule?.then.kind === "off") {
    global = { ...global, on: false };
  }
  console.log(`[Luces] ${rule ? `Regla: ${describeWhen(rule.when)} → ${describeThen(rule.then, profiles)}` : "Sin reglas: la escena de base"}`);
  await sendGlobal(global);
  await sendScene(scene);
}

// --- Importar / exportar ---

export function exportJson(state: ProfilesState): string {
  return JSON.stringify({ app: "Miku-AI", kind: "luces", version: 1, profiles: state.profiles, rules: state.rules }, null, 2);
}

// Suma los perfiles y reglas del archivo a los que ya hay (con ids nuevos
// si chocan). Devuelve cuántos de cada uno.
export async function importJson(text: string): Promise<{ profiles: number; rules: number }> {
  const data = JSON.parse(text);
  if (data?.kind !== "luces" || !Array.isArray(data.profiles)) throw new Error("Ese archivo no es un respaldo de luces de Miku.");
  const state = await loadProfiles();
  const taken = new Set(state.profiles.map((p) => p.id));
  const remap = new Map<string, string>();
  const profiles: Profile[] = data.profiles.map((p: Profile) => {
    const id = taken.has(p.id) ? newId() : p.id;
    remap.set(p.id, id);
    return { ...p, id };
  });
  const rules: Rule[] = (Array.isArray(data.rules) ? data.rules : []).map((r: Rule) => ({
    ...r,
    id: newId(),
    then: r.then.kind === "profile" ? { ...r.then, profileId: remap.get(r.then.profileId) ?? r.then.profileId } : r.then,
  }));
  await saveProfiles({ ...state, profiles: [...state.profiles, ...profiles], rules: [...state.rules, ...rules] });
  return { profiles: profiles.length, rules: rules.length };
}
