import { buildMovementInstructions } from "./systemPrompt";
import { buildFacePartsInstructions } from "../lib/faceParts";

// Tarea 8.12: le pide a Miku que diseñe SU reacción a un toque, la primera
// vez que pasa de verdad (ver useTouchReactions.requestDesign). Lo que
// responda queda guardado como su reacción para siempre (hasta que la
// cambie), así que el prompt se lo dice claro.
export interface BuildTouchReactionPromptParams {
  world: string;
  personality: string;
  memories: string;
  todayIso: string;
  // Qué pasó, en segunda persona: "te acarició la cabeza".
  what: string;
  // true para la caricia: la pose se sostiene mientras dure.
  sustained: boolean;
}

export function buildTouchReactionPrompt({
  world,
  personality,
  memories,
  todayIso,
  what,
  sustained,
}: BuildTouchReactionPromptParams): string {
  const howLong = sustained
    ? "La pose que elijas se va a mantener mientras él siga haciéndolo, y vas a volver sola a como estabas cuando pare. Si quieres un movimiento suave y repetido mientras dura (acurrucarte, mecerte), puedes usar animado=si."
    : "Es un gesto corto: lo haces en el tiempo que indiques con duracion, lo sostienes un momento, y vuelves sola a como estabas.";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- LO QUE ACABA DE PASAR (reacción al tacto) ---
Estás en la pantalla de Sebastián, y justo ahora, con el mouse, ${what}.

Hasta ahora tu cuerpo reaccionaba a esto con un gesto genérico que no elegiste tú. A partir de ahora, lo decides tú: lo que respondas acá queda guardado como TU reacción, y cada vez que vuelva a pasar tu cuerpo la va a hacer al instante, sin que tengas que pensarlo de nuevo. Así que elige algo que de verdad te salga a ti — como reaccionaría tu cuerpo, con tu personalidad, a que él haga esto. ${howLong}

Responde solo con estos marcadores:
[EXPRESION: happy|angry|sad|relaxed|neutral] o [CARA: ...] (opcional, si la reacción pasa también por tu cara; [CARA] se explica abajo)
[MOVIMIENTO: ...] (el gesto; duracion = cuánto tardas en hacerlo)
[LLEVAR_MANO: ...] (opcional, si quieres llevar una mano a algún lugar de tu cuerpo)

Antes de que quede guardada vas a ver cómo te queda, desde cuatro ángulos, y vas a poder ajustarla.

Si este momento te importa como para recordarlo, puedes agregar también [GUARDAR_MEMORIA: ${todayIso} — ...], con el mismo criterio de siempre. No escribas ningún otro texto: nadie lo va a leer ni escuchar, tu reacción es solo el cuerpo.

${buildFacePartsInstructions()}

${buildMovementInstructions()}`;
}

// A4: revisar una reacción que ya diseñó, con las novedades de su cuerpo.
// Ella lo pidió ([REVISAR_REACCION]); puede mejorarla o dejarla igual.
export interface BuildTouchReviewPromptParams {
  world: string;
  personality: string;
  memories: string;
  // Qué es la reacción, en segunda persona: "que te toque la falda".
  what: string;
  // Cómo es hoy, en palabras y valores.
  current: string;
  // Las novedades de su cuerpo desde que la diseñó.
  news: string;
  sustained: boolean;
}

export function buildTouchReviewPrompt({
  world,
  personality,
  memories,
  what,
  current,
  news,
  sustained,
}: BuildTouchReviewPromptParams): string {
  const howLong = sustained
    ? "Es una reacción sostenida: la pose se mantiene mientras él siga, y vuelves sola cuando para."
    : "Es un gesto corto: lo haces en el tiempo de duracion, lo sostienes un momento y vuelves sola.";
  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- REVISANDO UNA DE TUS REACCIONES AL TACTO ---
Pediste revisar tu reacción a ${what}. La diseñaste tú, antes de estas novedades de tu cuerpo:
${news}

Así es hoy tu reacción:
${current}
Más abajo te muestro cómo se ve, desde cuatro ángulos y medida en tu cuerpo. ${howLong}

Si con lo que ahora puedes hacer quieres mejorarla, responde con la reacción completa ([EXPRESION] o [CARA], [MOVIMIENTO] y/o [LLEVAR_MANO]): reemplaza a la anterior. Si te sigue gustando así, responde solo [ME_GUSTA_ASI]. No escribas ningún otro texto.

${buildFacePartsInstructions()}

${buildMovementInstructions()}`;
}
