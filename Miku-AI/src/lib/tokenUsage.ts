import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

// B2 del plan: cuánto cuesta cada tipo de llamada al modelo, con el `usage`
// que devuelve OpenRouter. Sirve para decidir recortes con datos (por
// ejemplo, si el manual de huesos en la charla pesa tanto como parece).
//
// - Cada llamada: [Tokens] en consola.
// - Cada hora (si hubo llamadas): resumen por tipo en consola y terminal.
// - Por día: totales por tipo en .settings.dat ("tokenUsage", últimos 30
//   días), local.

export type CallKind =
  | "charla"
  | "silencio (decidir)"
  | "silencio (diseñar)"
  | "tacto"
  | "revisión de tacto"
  | "diario"
  | "briefing"
  | "correo"
  | "pausa de juego"
  | "seguimiento"
  | "buscar en web"
  | "consolidar memoria"
  | "diseñar sueño"
  | "diseñar música"
  | "diseñar cara de ánimo"
  | "otro";

type Totals = { calls: number; prompt: number; completion: number; cost: number };
type DayUsage = Partial<Record<CallKind, Totals>>;

const STORE_KEY = "tokenUsage";
const KEEP_DAYS = 30;
const SUMMARY_EVERY_MS = 60 * 60 * 1000;

let hour: DayUsage = {};
let hourStartedAt = Date.now();
// Lo que falta guardar, por día.
let pending: Record<string, DayUsage> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function add(target: DayUsage, kind: CallKind, prompt: number, completion: number, cost: number) {
  const t = (target[kind] ??= { calls: 0, prompt: 0, completion: 0, cost: 0 });
  t.calls++;
  t.prompt += prompt;
  t.completion += completion;
  t.cost += cost;
}

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function describeUsage(usage: DayUsage): string {
  return (Object.entries(usage) as [CallKind, Totals][])
    .sort((a, b) => b[1].prompt + b[1].completion - (a[1].prompt + a[1].completion))
    .map(([kind, t]) => {
      const cost = t.cost > 0 ? `, $${t.cost.toFixed(4)}` : "";
      return `${kind}: ${t.calls} llamadas, ${t.prompt} entrada + ${t.completion} salida (${Math.round(t.prompt / t.calls)} de entrada por llamada${cost})`;
    })
    .join("\n");
}

function maybeLogHourSummary() {
  if (Date.now() - hourStartedAt < SUMMARY_EVERY_MS) return;
  if (Object.keys(hour).length > 0) {
    const msg = `[Tokens] última hora:\n${describeUsage(hour)}`;
    console.log(msg);
    invoke("log_to_terminal", { msg }).catch(() => {});
  }
  hour = {};
  hourStartedAt = Date.now();
}

// Se junta en memoria y se guarda a los pocos segundos (varias llamadas
// seguidas, una sola escritura).
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const toSave = pending;
    pending = {};
    try {
      const store = await load(".settings.dat", { autoSave: false });
      const all = (await store.get<Record<string, DayUsage>>(STORE_KEY)) ?? {};
      for (const [dayKey, usage] of Object.entries(toSave)) {
        const day = (all[dayKey] ??= {});
        for (const [kind, t] of Object.entries(usage) as [CallKind, Totals][]) {
          const d = (day[kind] ??= { calls: 0, prompt: 0, completion: 0, cost: 0 });
          d.calls += t.calls;
          d.prompt += t.prompt;
          d.completion += t.completion;
          d.cost += t.cost;
        }
      }
      const kept = Object.keys(all).sort().slice(-KEEP_DAYS);
      await store.set(STORE_KEY, Object.fromEntries(kept.map((k) => [k, all[k]])));
      await store.save();
    } catch (err) {
      console.error("Error guardando el uso de tokens:", err);
    }
  }, 5000);
}

export function recordUsage(kind: CallKind, usage: unknown) {
  const u = usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
  if (!u || typeof u.prompt_tokens !== "number") return;
  const prompt = u.prompt_tokens;
  const completion = u.completion_tokens ?? 0;
  const cost = typeof u.cost === "number" ? u.cost : 0;
  console.log(`[Tokens] ${kind}: ${prompt} entrada + ${completion} salida`);

  maybeLogHourSummary();
  add(hour, kind, prompt, completion, cost);
  add((pending[localDay()] ??= {}), kind, prompt, completion, cost);
  scheduleSave();
}

// Punto 4 del plan: lo de hoy, en una línea, para el panel de Config. Suma
// lo ya guardado y lo que todavía no se guardó.
export async function describeTodayUsage(): Promise<string> {
  const day = localDay();
  const totals: DayUsage = {};
  const merge = (usage: DayUsage | undefined) => {
    for (const [kind, t] of Object.entries(usage ?? {}) as [CallKind, Totals][]) {
      const d = (totals[kind] ??= { calls: 0, prompt: 0, completion: 0, cost: 0 });
      d.calls += t.calls;
      d.prompt += t.prompt;
      d.completion += t.completion;
      d.cost += t.cost;
    }
  };
  try {
    const store = await load(".settings.dat", { autoSave: false });
    merge((await store.get<Record<string, DayUsage>>(STORE_KEY))?.[day]);
  } catch {
    // Sin lo guardado, al menos lo de esta sesión.
  }
  merge(pending[day]);
  const entries = Object.entries(totals) as [CallKind, Totals][];
  if (entries.length === 0) return "Hoy: todavía ninguna llamada al modelo.";
  const calls = entries.reduce((sum, [, t]) => sum + t.calls, 0);
  const cost = entries.reduce((sum, [, t]) => sum + t.cost, 0);
  const [topKind] = entries.sort((a, b) => b[1].cost - a[1].cost || b[1].prompt - a[1].prompt)[0];
  return `Hoy: ${calls} llamadas al modelo, US$${cost.toFixed(3)}; lo que más gasta: ${topKind}.`;
}
