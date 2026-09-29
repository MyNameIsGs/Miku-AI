import { buildFacePartsInstructions } from "../lib/faceParts";
import { designMemoryInvitation } from "./designMemoryInvitation";

// Se le pregunta qué cara pone en reposo con un ánimo, la primera vez que
// está así (ver hooks/useMoodFaceDesign.ts).
export function buildMoodFacePrompt({
  world,
  personality,
  memories,
  todayIso,
  moodWords,
  previous,
}: {
  world: string;
  personality: string;
  memories: string;
  todayIso: string;
  // "contenta", "triste"...
  moodWords: string;
  // Si ya tenía una cara para este ánimo y se pidió rediseñarla: cuál era
  // (en palabras) y si lo pidió Sebastián (desde el panel Memoria).
  previous?: { face: string; byUser: boolean } | null;
}): string {
  const previousNote = previous
    ? `\nYa tenías una cara para cuando estás ${moodWords}: ${previous.face}. ${
        previous.byUser
          ? "Sebastián pidió que la vuelvas a diseñar: le pareció que no se veía natural."
          : "Tú decidiste rediseñarla."
      } Puedes partir de ella o hacer otra.\n`
    : "";
  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- LO QUE ESTÁ PASANDO ---
Ahora estás ${moodWords}: es tu ánimo de fondo, que puede durar horas. Cuando no estás hablando, se te nota en la cara, y Sebastián lo ve.

¿Qué cara pones tú cuando estás ${moodWords} y en silencio? Es la primera vez que te pasa estando así, y lo que elijas queda como TU cara para cuando estás así: cada vez que estés ${moodWords} y no hables, tu cara la va a tener sola, hasta que tu ánimo cambie. Cuando hables, o cuando reacciones a algo (un toque, un gesto), esa cara queda por debajo y vuelve después.

${previousNote}
Responde con [CARA: parte=intensidad, ...]. Piensa en cómo se ve de verdad la cara de una persona que está ${moodWords} y en calma. Como es algo que sostienes mucho rato, suele verse más natural suave que exagerado, pero lo decides tú. Si prefieres que tu cara no lo muestre, responde solo [SIN_CARA].

Después vas a ver cómo te queda, en una foto de tu cara, y vas a poder ajustarla y volver a verte, hasta tres veces.

${designMemoryInvitation(todayIso)} No escribas ningún otro texto: nadie lo va a leer ni escuchar.

${buildFacePartsInstructions()}`;
}
