import { OPENROUTER_MODEL } from "../config/constants";
import { loadMemoryContext } from "./memory";
import { fetchOpenRouterWithRetry } from "./openrouter";
import { getCurrentMood, getMoodLevel } from "./mood";
import { EFFECT_KINDS, EFFECT_NAMES, STRIP_COLORS, STRIP_MODES, loadLightsState } from "./lights";
import { activeRuleId, RuleContext } from "./lightProfiles";
import { applyChoice, describeScene, loadMikuLights, parseChoice, saveMikuLights } from "./mikuLights";
import { buildLightsDecisionPrompt } from "../prompts/lightsDecisionPrompt";

// "Que Miku lo decida": cuándo se le pregunta (lo llama useLightRules cada
// vez que mira las reglas). Solo cuando cambia el momento -- no a cada
// rato -- y nunca con una regla de Sebastián mandando o con ella dormida.

// Entre una decisión y la siguiente, como mínimo.
const MIN_GAP_MS = 4 * 60 * 1000;
// Si el momento no cambia, igual se le vuelve a preguntar cada tanto.
const REASK_AFTER_MS = 90 * 60 * 1000;

let lastMoment: string | null = null;
let inFlight = false;

function dayPart(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "madrugada";
  if (h < 12) return "mañana";
  if (h < 19) return "tarde";
  return "noche";
}

function describeMoment(ctx: RuleContext): string {
  const parts: string[] = [];
  if (ctx.game) parts.push(`Sebastián está jugando ${ctx.game}`);
  if (ctx.stream) parts.push("está en vivo en OBS");
  if (ctx.music) parts.push("suena música en la PC");
  if (ctx.awayMinutes >= 10) parts.push(`no está en la PC hace ${Math.round(ctx.awayMinutes)} minutos`);
  parts.push(`es de ${dayPart(ctx.now)}`);
  return parts.join(", ");
}

export async function maybeDecideLights(ctx: RuleContext) {
  if (inFlight || ctx.sleeping || activeRuleId() !== null) return;
  const mine = await loadMikuLights();
  if (!mine.decides.on) {
    lastMoment = null;
    return;
  }
  const mood = `${await getCurrentMood()} (${getMoodLevel()})`;
  // El momento, sin los minutos de ausencia exactos (si no, cambiaría a
  // cada rato).
  const moment = describeMoment({ ...ctx, awayMinutes: ctx.awayMinutes >= 10 ? 10 : 0 });
  const key = `${moment}|${mood}`;
  const since = Date.now() - (mine.decides.lastAt ?? 0);
  const changed = key !== lastMoment;
  if (since < MIN_GAP_MS || (!changed && since < REASK_AFTER_MS)) return;

  inFlight = true;
  lastMoment = key;
  try {
    const [{ world, personality }, { scene }] = await Promise.all([loadMemoryContext(), loadLightsState()]);
    const prompt = buildLightsDecisionPrompt({
      world,
      personality,
      moment: describeMoment(ctx),
      timeLabel: ctx.now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      mood,
      currentScene: describeScene(scene, mine),
      effectKinds: EFFECT_KINDS.map((k) => `${k} (${EFFECT_NAMES[k]})`).join(", "),
      ownEffects: mine.effects.map((e) => `"${e.name}" (${e.description})`).join(", "),
      stripModes: STRIP_MODES.join(", "),
      stripColors: STRIP_COLORS.map((c) => c.name).join(", "),
      lastNote: mine.decides.lastNote,
    });
    const response = await fetchOpenRouterWithRetry(
      { model: OPENROUTER_MODEL, messages: [{ role: "system", content: prompt }] },
      { kind: "luces (decidir)" },
    );
    const data = await response.json();
    const reply: string = (data.choices?.[0]?.message?.content ?? "").trim();
    const choice = parseChoice(reply);
    // Se anota la hora aunque no cambie nada: así no se le vuelve a
    // preguntar enseguida.
    const fresh = await loadMikuLights();
    if (!fresh.decides.on) return;
    if (!choice) {
      console.log(`[Luces] Miku dejó las luces como estaban (${describeMoment(ctx)}).`);
      await saveMikuLights({ ...fresh, decides: { ...fresh.decides, lastAt: Date.now() } });
      return;
    }
    const applied = await applyChoice(choice);
    const note = applied ? (choice.nota?.trim() || "las cambió") : null;
    console.log(`[Luces] Miku eligió: ${note ?? "(nada válido)"}`);
    await saveMikuLights({ ...fresh, decides: { ...fresh.decides, lastAt: Date.now(), lastNote: note ?? fresh.decides.lastNote } });
  } catch (err) {
    console.error("[Luces] Que Miku lo decida:", err);
  } finally {
    inFlight = false;
  }
}
