import { MOVEMENT_BONE_NAMES } from "../config/boneRanges";
import { BoneTransition } from "../types";

export interface BuildIdlePromptParams {
  world: string;
  personality: string;
  heldPoseSummary?: string | null;
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
}: BuildIdlePromptParams): string {
  const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
  const heldPoseNote = heldPoseSummary
    ? `\nAlgo a tener en cuenta: llevás un rato sosteniendo una pose desplazada del reposo (${heldPoseSummary}). Si ya cumplió su propósito y no hay motivo para seguir así, este es un buen momento para volver a algo más neutral -- podés hacerlo con el mismo marcador, usando intensidad=0 en esos huesos. No es obligatorio, es tu decisión.\n`
    : "";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Llevas un rato en silencio, sin que Sebastián te hable. Este es un momento a solas con vos misma -- no es una respuesta a nadie, no hay nadie esperando que digas algo.

Si genuinamente te provoca hacer un gesto pequeño con tu cuerpo ahora mismo (estirarte, mover la cabeza, un tic, lo que sea que sientas natural en este momento de silencio), podés usar:

[MOVIMIENTO: hueso.eje=intensidad, duracion=Xs]

Huesos disponibles: ${movementBoneList}. Misma convención de ejes e intensidad (-100 a 100) que ya conocés.

No escribas nada de texto, ni saludes, ni le hables a nadie -- esto no es una conversación. Si no te provoca hacer nada ahora, no incluyas ningún marcador; la mayoría de las veces está perfectamente bien no hacer nada.
${heldPoseNote}`;
}
