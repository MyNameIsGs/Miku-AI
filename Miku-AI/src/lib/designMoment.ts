import { OPENROUTER_MODEL } from "../config/constants";
import { fetchOpenRouterWithRetry } from "./openrouter";
import { getSelfViewCapturer } from "./selfViewStore";
import { CallKind } from "./tokenUsage";
import { interpretDesign } from "../hooks/useTouchReactions";

// Miku diseña algo de su cuerpo en un momento real (cómo se duerme, cómo se
// despierta, cómo se mueve con la música): se le pregunta, ve cómo le queda
// desde cuatro ángulos y puede ajustarlo una vez antes de que se guarde.
// Mismo camino que el diseño de las reacciones al tacto
// (useTouchReactions.requestDesign), en un solo lugar para lo nuevo.

export type Design = ReturnType<typeof interpretDesign>;

export async function designWithSelfView(
  prompt: string,
  kind: CallKind,
): Promise<{ design: Design; replies: string[] } | null> {
  const ask = async (messages: object[]) => {
    const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind });
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  };

  const firstReply = await ask([{ role: "system", content: prompt }]);
  let design = interpretDesign(firstReply);
  const replies = [firstReply];
  if (!design.movement && !design.expression) return { design, replies };

  const capture = getSelfViewCapturer();
  if (capture && design.movement) {
    try {
      const { image, bodySense } = capture("cuatro", "cuerpo", { ...design.movement, animated: false }, true);
      const sense = bodySense ? `\nMedido en tu cuerpo:\n${bodySense}\n` : "";
      const reviewText = `Así se vería tu cuerpo, ya en esa posición, desde cuatro ángulos: frente, tu izquierda, espalda y tu derecha${design.movement.animated ? " (es animado: esto es el extremo del vaivén)" : ""}.${sense} Si te convence tal cual, responde solo [LISTO]. Si quieres ajustarlo, responde otra vez con todo completo ([EXPRESION] o [CARA], [MOVIMIENTO] y/o [LLEVAR_MANO]): reemplaza a lo anterior. No repitas [GUARDAR_MEMORIA].`;
      const secondReply = await ask([
        { role: "system", content: prompt },
        { role: "assistant", content: firstReply },
        { role: "user", content: [{ type: "text", text: reviewText }, { type: "image_url", image_url: { url: image } }] },
      ]);
      const revised = interpretDesign(secondReply);
      if (revised.movement || revised.expression) {
        design = {
          movement: revised.movement,
          expression: revised.expression ?? design.expression,
          moodEffect: revised.moodEffect ?? design.moodEffect,
        };
        replies.push(secondReply);
      }
    } catch (err) {
      console.warn("[Diseño] No se pudo mostrarle cómo le queda; queda la primera versión:", err);
    }
  }
  return { design, replies };
}
