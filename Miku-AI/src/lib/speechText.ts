// Formato de texto que no tiene que verse ni oírse (2026-09-29, pedido de
// Sebastián). El chat muestra texto plano, así que las negritas de markdown
// (**así**) quedaban con los asteriscos a la vista, y a veces la voz los
// leía en voz alta. Los emojis se ven, pero no se dicen.
// Mismo criterio en Android: data/TextCleanup.kt.

// Negritas/cursivas/tachado/código/títulos de markdown -> solo el texto.
// Los asteriscos sueltos también se van (acciones tipo *se ríe*, o uno que
// quedó sin pareja). Solo se respeta el de una cuenta (2 * 3, 2*3).
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/(?<!\d)\*+(?=\S)|(?<=\S)\*+(?!\d)/g, "")
    .replace(/(^|[^\w])__([^_\n]+?)__(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, "$1$2")
    .replace(/~~([^~\n]+?)~~/g, "$1")
    .replace(/`+([^`\n]+?)`+/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}

// Emojis y sus piezas (tono de piel, unión de emojis compuestos, selector de
// variación, banderas, tecla "1️⃣" -> queda el número).
const EMOJI =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;

// Lo que se manda a la voz: sin formato, sin emojis, sin viñetas de lista ni
// direcciones web (una URL leída letra por letra no le sirve a nadie).
export function textForSpeech(text: string): string {
  return stripMarkdown(text)
    .replace(EMOJI, "")
    .replace(/\((https?:\/\/[^)\s]+)\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[ \t]*[-•][ \t]+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trim();
}
