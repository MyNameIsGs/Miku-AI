import { OPENROUTER_MODEL } from "../config/constants";
import { bodyNewsSince } from "../config/bodyChangelog";
import { loadMemoryContext } from "./memory";
import { fetchOpenRouterWithRetry } from "./openrouter";
import { getSelfViewCapturer } from "./selfViewStore";
import {
  TOUCH_REACTION_LABELS,
  TouchReactionKey,
  describeReaction,
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

export async function reviewTouchReaction(key: TouchReactionKey): Promise<ReviewOutcome> {
  const reaction = getDesignedReaction(key);
  if (!reaction) return "no existe";
  const current = describeReaction(reaction);

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
      // Si no dijo nada del ánimo al revisarla, se conserva lo que tenía.
      moodEffect: design.moodEffect ?? reaction.moodEffect ?? null,
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
