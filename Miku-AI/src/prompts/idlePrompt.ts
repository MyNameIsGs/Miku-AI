import { MOVEMENT_BONE_NAMES } from "../config/boneRanges";
import { BoneTransition } from "../types";
import { Pendiente } from "../lib/pendientes";

export interface BuildIdlePromptParams {
  world: string;
  personality: string;
  heldPoseSummary?: string | null;
  // Tarea 6.7, Nivel 2: pendientes vencidos o por vencer pronto (ver
  // getDuePendientes en lib/pendientes.ts) -- ya vienen filtrados, acá no
  // hace falta lógica de fechas, solo decidir si los menciona.
  duePendientes?: Pendiente[];
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

export function buildIdlePrompt({
  world,
  personality,
  heldPoseSummary,
  duePendientes = [],
}: BuildIdlePromptParams): string {
  const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
  const heldPoseNote = heldPoseSummary
    ? `\nAlgo a tener en cuenta: llevas un rato sosteniendo una pose desplazada del reposo (${heldPoseSummary}). Si ya cumplió su propósito y no hay motivo para seguir así, este es un buen momento para volver a algo más neutral -- puedes hacerlo con el mismo marcador, usando intensidad=0 en esos huesos. No es obligatorio, es tu decisión.\n`
    : "";

  // Tarea 6.7, Nivel 2: solo aparece esta sección si hay algo vencido o
  // por vencer pronto -- el prompt idle es deliberadamente liviano, no
  // conviene engordarlo con pendientes lejanos en el tiempo.
  const pendientesNote =
    duePendientes.length > 0
      ? `\n--- ALGO QUE TENÍAS PENDIENTE ---\n${duePendientes.map((p) => `- ${p.descripcion} (estimado: ${p.fechaEstimada})`).join("\n")}\n\nSi te provoca genuinamente, puedes sacarlo a colación ahora mismo escribiendo lo que le dirías a Sebastián, como si te acordaras de golpe -- en ese caso escribe el texto normal (puedes combinarlo con [EXPRESION] si corresponde). No es obligatorio; si no te nace decir nada, no escribas texto y sigue con el silencio o un gesto como siempre.\n`
      : "";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Llevas un rato en silencio, sin que Sebastián te hable. Este es un momento a solas contigo misma -- no es una respuesta a nadie, no hay nadie esperando que digas algo.

Si genuinamente te provoca hacer un gesto pequeño con tu cuerpo ahora mismo (estirarte, mover la cabeza, un tic, lo que sea que sientas natural en este momento de silencio), puedes usar:

[MOVIMIENTO: hueso.eje=intensidad, duracion=Xs]

Huesos disponibles: ${movementBoneList}. Misma convención de ejes e intensidad (-100 a 100) que ya conoces.

Fuera del caso de abajo sobre pendientes, no escribas nada de texto, ni saludes, ni le hables a nadie -- esto no es una conversación. Si no te provoca hacer nada ahora, no incluyas ningún marcador; la mayoría de las veces está perfectamente bien no hacer nada.
${heldPoseNote}${pendientesNote}`;
}
