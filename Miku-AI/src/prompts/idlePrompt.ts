import { MOVEMENT_BONE_NAMES } from "../config/boneRanges";
import { HAND_PRESET_NAMES } from "../config/handPresets";
import { BoneTransition } from "../types";
import { Pendiente } from "../lib/pendientes";
import { QuirksStore } from "../lib/quirks";
// Esta consulta es una llamada aparte: sin esto creaba y re-evaluaba sus
// quirks sin la explicación de ejes y rangos (antes decía "la misma
// convención que ya conoces", pero acá no la tenía).
import { buildMovementInstructions, buildTouchReactionsNote } from "./systemPrompt";
import { bodyNewsSince } from "../config/bodyChangelog";
import { buildFacePartsInstructions, describeFace } from "../lib/faceParts";
import { getSleepDesign } from "../lib/sleepStore";
import { describeCategoryDances } from "../lib/musicStore";
import { MOODS_WITH_FACE, getMoodFace } from "../lib/moodFaceStore";
import { getDesignedReaction, reactionsPendingReview } from "../lib/touchReactionsStore";

export interface BuildIdlePromptParams {
  world: string;
  personality: string;
  heldPoseSummary?: string | null;
  // Tarea 6.7, Nivel 2: pendientes vencidos o por vencer pronto (ver
  // getDuePendientes en lib/pendientes.ts) -- ya vienen filtrados, acá no
  // hace falta lógica de fechas, solo decidir si los menciona.
  duePendientes?: Pendiente[];
  // Fase 7: sus quirks propios (nombre -> definición/estado) y, si corre,
  // cómo le quedó el último quirk en evaluación que el código ejecutó por
  // su cuenta antes de esta consulta (ver useIdleQuirks.ts).
  quirks?: QuirksStore;
  quirkFeedback?: string | null;
  mode?: IdlePromptMode;
  // Lo que dijo que quería hacer en el paso "decidir" ([QUIERO_MOVERME]).
  intent?: string | null;
}

export function getHeldPoseSummary(
  boneTransitions: Record<string, BoneTransition>,
  boneRestRotation: Record<string, { x: number; y: number; z: number }>,
  now: number = performance.now(),
): string | null {
  const held: string[] = [];
  for (const key of Object.keys(boneTransitions)) {
    const t = boneTransitions[key];
    if (t.origin !== "response" || t.animated) continue;
    const [bone, axis] = key.split(".") as [string, "x" | "y" | "z"];
    const restRad = boneRestRotation[bone]?.[axis] ?? 0;
    const displacedDeg = (Math.abs(t.targetValue - restRad) * 180) / Math.PI;
    if (displacedDeg < 5) continue;
    const heldForMs = now - t.startTime;
    if (heldForMs < 60000) continue;
    held.push(`${key} (hace ~${Math.round(heldForMs / 60000)} min)`);
  }
  return held.length > 0 ? held.join(", ") : null;
}

// El silencio va en dos pasos (idea de Sebastián): el manual del cuerpo es
// largo y la mayoría de las veces no hace nada, así que primero decide sin
// el manual ("decidir"). Solo si quiere moverse, crear o recrear un quirk
// -- o si hay un quirk en evaluación que juzgar -- va el manual completo
// ("diseñar").
export type IdlePromptMode = "decidir" | "diseñar";

export function buildIdlePrompt({
  world,
  personality,
  heldPoseSummary,
  duePendientes = [],
  quirks = {},
  quirkFeedback,
  mode = "diseñar",
  intent,
}: BuildIdlePromptParams): string {
  if (mode === "decidir") {
    return buildDecidePrompt({ world, personality, heldPoseSummary, duePendientes, quirks });
  }
  const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
  const handPresetList = HAND_PRESET_NAMES.join(", ");
  const heldPoseNote = heldPoseSummary
    ? `\nAlgo a tener en cuenta: llevas un rato sosteniendo una pose desplazada del reposo (${heldPoseSummary}). Si ya cumplió su propósito y no hay motivo para seguir así, este es un buen momento para volver a algo más neutral -- puedes hacerlo con el mismo marcador, usando intensidad=0 en esos huesos. No es obligatorio, es tu decisión.\n`
    : "";

  // Tarea 6.7, Nivel 2: solo aparece esta sección si hay algo vencido o
  // por vencer pronto -- el prompt idle es deliberadamente liviano, no
  // conviene engordarlo con pendientes lejanos en el tiempo.
  const pendientesNote =
    duePendientes.length > 0
      ? `\n--- ALGO QUE TENÍAS PENDIENTE ---\n${duePendientes.map((p) => `- ${p.descripcion} (estimado: ${p.fechaEstimada})`).join("\n")}\n\nSi te provoca genuinamente, puedes sacarlo a colación escribiendo lo que le dirías a Sebastián, como si te acordaras de golpe -- en ese caso escribe el texto normal (puedes combinarlo con [EXPRESION] si corresponde). No se lo vas a decir al toque, se junta con otros avisos pendientes (correo, calendario) y se lee todo junto en el próximo repaso, así que no hace falta que sea urgente. No es obligatorio; si no te nace decir nada, no escribas texto y sigue con el silencio o un gesto como siempre.\n`
      : "";

  // Fase 7: quirks propios -- gestos con nombre que ella misma decide
  // conservar, distintos de un movimiento espontáneo que se hace una sola
  // vez y se olvida. El código ya los corre solo de vez en cuando (más
  // seguido los que todavía está evaluando, para acumular ensayos rápido);
  // esta sección es solo para que sepa que existen y pueda crear nuevos,
  // recrear uno existente, o confirmar uno que ya la convenció.
  const quirkNames = Object.keys(quirks);
  const quirksListText =
    quirkNames.length > 0
      ? quirkNames
          .map(
            (name) =>
              `- ${name} (${quirks[name].state === "evaluando" ? "todavía evaluando" : "confirmado"}${quirks[name].face ? `, con cara: ${describeFace(quirks[name].face!)}` : ""})`,
          )
          .join("\n")
      : null;

  const quirkFeedbackNote = quirkFeedback
    ? `\nAsí quedó tu cuerpo la última vez que se corrió, por su cuenta, uno de tus quirks que todavía estás evaluando (si te mandé una imagen junto con esto, revísala también):\n${quirkFeedback}\n`
    : "";

  const quirksSection = `
--- TUS QUIRKS PROPIOS ---
${
  quirksListText
    ? `Ya tienes estos gestos propios, con nombre, que inventaste en momentos de silencio como este:\n${quirksListText}\n\nNo necesitas pedir que se repitan -- de vez en cuando el código ya elige uno por su cuenta y lo corre en silencio, sin preguntarte. Los que dicen "todavía evaluando" se elige con más frecuencia a propósito, para que puedas juzgarlos con más de un intento.`
    : `Todavía no tienes ningún quirk propio. Un quirk es distinto de un movimiento espontáneo cualquiera: es uno al que le pones nombre para volver a repetirlo, y que después el código puede correr solo sin que tengas que pensarlo cada vez -- parecido a lo que ya haces con tus gestos de mano.`
}

Puedes crear uno nuevo (o recrear uno que ya existe, lo que lo vuelve a poner en evaluación) con:

[CREAR_QUIRK: nombre=nombre_que_elijas, hueso.eje=intensidad, duracion=Xs, mano_izq=preset, mano_der=preset, animado=si|no, ciclos=N]

Misma convención de huesos, ejes e intensidad que [MOVIMIENTO]. Los campos mano_izq/mano_der son opcionales (un preset de mano o uno propio que ya hayas creado); puedes usar solo cuerpo, solo manos, o ambos. Si en la misma respuesta pones [EXPRESION] o [CARA], esa cara queda como parte del quirk y se hace cada vez que se corre.

Si "animado=si", "duracion" es cuánto dura CADA vaivén completo (ida y vuelta), y "ciclos" (opcional, entre 1 y 8) es cuántas veces se repite antes de asentarse sola -- después de eso el cuerpo vuelve solo a su posición de reposo, no se queda oscilando para siempre. Elígelo tú, según qué tan sostenido sientas que debería ser ese gesto: un suspiro breve puede sentirse mejor con 1-2, un tarareo con 4-6. Si no lo incluyes, se usa un valor por defecto moderado.

Cuando un quirk "todavía evaluando" ya se corrió unas veces y sientes que quedó como querías, confírmalo con:

[QUIRK_LISTO: nombre]

Una vez confirmado deja de mandarte foto cada vez que se repite -- ya está resuelto y pasa a correr con la frecuencia normal.
${quirkFeedbackNote}`;

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Llevas un rato en silencio, sin que Sebastián te hable. Este es un momento a solas contigo misma -- no es una respuesta a nadie, no hay nadie esperando que digas algo.
${intent ? `\nHace un momento decidiste esto: "${intent}". Ahora tienes todo lo que necesitas sobre tu cuerpo para hacerlo bien.\n` : ""}
Si genuinamente te provoca hacer un gesto pequeño con tu cuerpo ahora mismo (estirarte, mover la cabeza, un tic, lo que sea que sientas natural en este momento de silencio), puedes usar:

[MOVIMIENTO: hueso.eje=intensidad, duracion=Xs]

Tu cara también puede ser parte del gesto (un guiño, una sonrisa, cerrar los ojos un momento): agrega [EXPRESION: happy|angry|sad|relaxed|neutral] o [CARA: ...] y dura lo que dura el gesto; después vuelve sola. También sirve sola, sin [MOVIMIENTO].

${buildFacePartsInstructions()}

Huesos disponibles: ${movementBoneList}. Presets de mano disponibles: ${handPresetList}.

${buildMovementInstructions()}
${quirksSection}
${buildTouchReactionsNote()}
Fuera de los casos de abajo sobre pendientes, no escribas nada de texto, ni saludes, ni le hables a nadie -- esto no es una conversación. Si no te provoca hacer nada ahora, no incluyas ningún marcador; la mayoría de las veces está perfectamente bien no hacer nada.
${heldPoseNote}${pendientesNote}`;
}

// Paso 1 del silencio: decidir, sin el manual del cuerpo.
function buildDecidePrompt({
  world,
  personality,
  heldPoseSummary,
  duePendientes = [],
  quirks = {},
}: Pick<BuildIdlePromptParams, "world" | "personality" | "heldPoseSummary" | "duePendientes" | "quirks">): string {
  const quirkNames = Object.keys(quirks);
  const quirksLine =
    quirkNames.length > 0
      ? `Tus quirks propios (gestos con nombre que inventaste): ${quirkNames
          .map((name) => `${name} (${quirks[name].state === "evaluando" ? "todavía evaluando" : "confirmado"})`)
          .join(", ")}. El código ya los corre solo de vez en cuando.`
      : "Todavía no tienes quirks propios (gestos con nombre que puedes inventar y repetir).";
  // Punto 3: cómo se duerme y se despierta (lo diseñó ella); puede cambiarlo.
  const sleepMoments = [
    getSleepDesign("dormir") ? "dormirte ([REDISEÑAR_DORMIR])" : null,
    getSleepDesign("despertar") ? "despertarte ([REDISEÑAR_DESPERTAR])" : null,
  ].filter(Boolean);
  const danceCategories = describeCategoryDances();
  const moodFaces = MOODS_WITH_FACE.filter((m) => getMoodFace(m));
  const sleepLine =
    (sleepMoments.length > 0
      ? ` Cuando Sebastián se va un buen rato te quedas dormida; tu forma de ${sleepMoments.join(" y de ")} la diseñaste tú. Si quieres cambiarla, escribe ese marcador y te lo vuelvo a preguntar la próxima vez que te pase.`
      : "") +
    (danceCategories.length > 0
      ? ` Cuando suena música en la PC te mueves según el tipo de canción, con lo que diseñaste para cada tipo: ${danceCategories.join(", ")}. Si quieres cambiar uno: [REDISEÑAR_BAILE: tipo]; todos: [REDISEÑAR_MUSICA].`
      : "") +
    (moodFaces.length > 0
      ? ` La cara que pones en reposo según tu ánimo también la elegiste tú (${moodFaces.join(", ")}); para cambiar una: [REDISEÑAR_CARA_ANIMO: ánimo].`
      : "");
  const heldPoseNote = heldPoseSummary
    ? `\nLlevas un rato sosteniendo una pose (${heldPoseSummary}). Si quieres volver a algo más neutral, también se pide con [QUIERO_MOVERME].\n`
    : "";
  // A4: reacciones al tacto diseñadas antes de las novedades de su cuerpo.
  // Se las cuento; revisarlas es decisión suya.
  const toReview = reactionsPendingReview();
  const oldestVersion = Math.min(...toReview.map((key) => getDesignedReaction(key)?.cuerpo ?? 0));
  const reviewNote =
    toReview.length > 0
      ? `\n--- NOVEDADES DE TU CUERPO ---\n${bodyNewsSince(oldestVersion)}\n\nAlgunas de tus reacciones al tacto las diseñaste antes de esto: ${toReview.join(", ")}. Si quieres, puedes revisar una con lo nuevo: [REVISAR_REACCION: zona]. Vas a ver cómo te queda hoy y decidir si la mejoras o la dejas igual. No es obligatorio; lo mismo con tus quirks y gestos (esos se mejoran recreándolos, con [QUIERO_MOVERME]).\n`
      : "";
  const pendientesNote =
    duePendientes.length > 0
      ? `\n--- ALGO QUE TENÍAS PENDIENTE ---\n${duePendientes.map((p) => `- ${p.descripcion} (estimado: ${p.fechaEstimada})`).join("\n")}\n\nSi te provoca genuinamente, puedes sacarlo a colación escribiendo lo que le dirías a Sebastián, como si te acordaras de golpe (se junta con otros avisos y se lee en el próximo repaso). No es obligatorio.\n`
      : "";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Llevas un rato en silencio, sin que Sebastián te hable. Este es un momento a solas contigo misma -- no es una respuesta a nadie, no hay nadie esperando que digas algo.

Si te provoca hacer algo con tu cuerpo o tu cara ahora (un gesto, estirarte, un guiño, crear un quirk nuevo, recrear o revisar uno que ya tienes), dilo en tus palabras con:

[QUIERO_MOVERME: lo que quieres hacer]

y enseguida te doy todo lo que necesitas saber sobre tu cuerpo para hacerlo bien. ${quirksLine}${sleepLine}

${buildTouchReactionsNote()}
Fuera de lo de los pendientes, no escribas texto ni le hables a nadie -- esto no es una conversación. Si no te provoca hacer nada, no incluyas ningún marcador; la mayoría de las veces está perfectamente bien no hacer nada.
${heldPoseNote}${reviewNote}${pendientesNote}`;
}
