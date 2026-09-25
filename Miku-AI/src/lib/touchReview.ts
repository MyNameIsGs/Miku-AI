import { OPENROUTER_MODEL } from "../config/constants";
import { bodyNewsSince } from "../config/bodyChangelog";
import { decodeFace } from "./faceParts";
import { loadMemoryContext } from "./memory";
import { fetchOpenRouterWithRetry } from "./openrouter";
import { getSelfViewCapturer } from "./selfViewStore";
import {
  TOUCH_REACTION_LABELS,
  TouchReactionKey,
  getDesignedReaction,
  markReactionReviewed,
  saveDesignedReaction,
} from "./touchReactionsStore";
import {
  DESIGN_DURATION_RANGE_MS,
  DESIGN_PET_DURATION_RANGE_MS,
  interpretDesign,
} from "../hooks/useTouchReactions";
import { buildTouchReviewPrompt } from "../prompts/touchReactionPrompt";

// A4 del plan: Miku revisa una de sus reacciones al tacto con las novedades
// de su cuerpo, porque ELLA lo pidió en un momento de silencio
// ([REVISAR_REACCION: zona]). Ve cómo le queda hoy y decide: la mejora
// (reemplaza a la anterior, nadie la borra) o la deja igual (queda marcada
// como revisada). Pedido de Sebastián: que pueda mejorar lo suyo por sí
// misma cuando su cuerpo cambia, sin que él tenga que borrarle nada.

export type ReviewOutcome = "mejorada" | "igual" | "sin respuesta clara" | "no existe";

function describeCurrent(key: TouchReactionKey): string | null {
  const reaction = getDesignedReaction(key);
  if (!reaction) return null;
  const face = reaction.expression ? decodeFace(reaction.expression) : null;
  const faceText = face
    ? `cara por partes: ${Object.entries(face).map(([part, w]) => `${part}=${Math.round(w * 100)}`).join(", ")}`
    : reaction.expression
      ? `expresión: ${reaction.expression}`
      : "sin cambio de expresión";
  const movementText =
    reaction.entries.length > 0
      ? `movimiento: ${reaction.entries.map((e) => `${e.bone}.${e.axis}=${e.intensity}`).join(", ")}, duracion=${(reaction.durationMs / 1000).toFixed(1)}s${reaction.animated ? ", animado=si" : ""}`
      : "sin movimiento";
  const sideText = reaction.side ? ` (la diseñaste del lado ${reaction.side === "left" ? "izquierdo" : "derecho"}; del otro se espeja)` : "";
  return `- ${faceText}\n- ${movementText}${sideText}`;
}

export async function reviewTouchReaction(key: TouchReactionKey): Promise<ReviewOutcome> {
  const reaction = getDesignedReaction(key);
  const current = describeCurrent(key);
  if (!reaction || !current) return "no existe";

  const { world, personality, memories } = await loadMemoryContext();
  const prompt = buildTouchReviewPrompt({
    world,
    personality,
    memories,
    what: TOUCH_REACTION_LABELS[key],
    current,
    news: bodyNewsSince(reaction.cuerpo),
    sustained: key === "caricia",
  });

  const messages: object[] = [{ role: "system", content: prompt }];
  const capture = getSelfViewCapturer();
  if (capture && reaction.entries.length > 0) {
    const { image, bodySense } = capture(
      "cuatro",
      "cuerpo",
      { entries: reaction.entries, durationMs: reaction.durationMs, animated: false },
      true,
    );
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Así se ve hoy tu reacción, ya terminada, desde cuatro ángulos (frente, tu izquierda, espalda y tu derecha)${reaction.animated ? " -- es animada: esto es el extremo del vaivén" : ""}.${bodySense ? `\nMedido en tu cuerpo:\n${bodySense}` : ""}`,
        },
        { type: "image_url", image_url: { url: image } },
      ],
    });
  }

  const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages });
  const data = await response.json();
  const reply = String(data.choices?.[0]?.message?.content ?? "");

  const design = interpretDesign(reply);
  if (design.movement || design.expression) {
    const [minMs, maxMs] = key === "caricia" ? DESIGN_PET_DURATION_RANGE_MS : DESIGN_DURATION_RANGE_MS;
    await saveDesignedReaction(key, {
      expression: design.expression,
      entries: design.movement?.entries ?? [],
      durationMs: Math.min(maxMs, Math.max(minMs, design.movement?.durationMs ?? reaction.durationMs)),
      animated: design.movement?.animated ?? false,
      side: reaction.side,
      createdAt: new Date().toISOString(),
    });
    console.log(`[Tacto] Miku mejoró su reacción a "${key}":`, reply);
    return "mejorada";
  }
  if (/\[ME_GUSTA_ASI\]/i.test(reply)) {
    await markReactionReviewed(key);
    console.log(`[Tacto] Miku revisó su reacción a "${key}" y la deja como está.`);
    return "igual";
  }
  console.warn(`[Tacto] La revisión de "${key}" no trajo ni una versión nueva ni [ME_GUSTA_ASI]:`, reply);
  return "sin respuesta clara";
}
