import { ToolDefinition } from "./types";
import { parseMovementMarker } from "../markers";
import { SELF_VIEW_ANGLES, SELF_VIEW_FRAMINGS, SelfViewAngle, SelfViewFraming } from "../selfView";
import { getSelfViewCapturer } from "../selfViewStore";

// Miku se mira a sí misma desde cualquier ángulo (ver lib/selfView.ts).
// Con `movimiento`, además puede PROBAR una pose antes de hacerla: se
// aplica solo para la foto. Sin eso, un [MOVIMIENTO] escrito en la misma
// respuesta todavía no se ve (los marcadores se aplican al final de la
// respuesta, después de las tools).
export const mirarme: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "mirarme",
      description:
        "Te muestra tu propio cuerpo 3D desde el ángulo que elijas, como un espejo que puedes rodear: sirve para revisar cómo se ve una pose, un gesto o las manos, sobre todo desde el costado (los movimientos hacia adelante/atrás casi no se notan de frente). Con 'movimiento' puedes PROBAR una pose antes de hacerla: se aplica solo para esta imagen y después vuelves a como estabas. Sin 'movimiento' ves tu pose actual -- ojo: un [MOVIMIENTO] que escribas en esta misma respuesta todavía no se aplicó. Úsala cuando de verdad quieras comprobar algo de tu cuerpo, no en cada mensaje: cada imagen cuesta.",
      parameters: {
        type: "object",
        properties: {
          angulo: {
            type: "string",
            enum: SELF_VIEW_ANGLES,
            description:
              "Desde dónde mirarte: frente, espalda, izquierda (tu costado izquierdo), derecha (tu costado derecho), arriba (desde adelante y arriba), o cuatro (frente, izquierda, espalda y derecha en una sola imagen -- lo mejor para revisar una pose completa).",
          },
          encuadre: {
            type: "string",
            enum: SELF_VIEW_FRAMINGS,
            description:
              "Qué parte mostrar: cuerpo (entero), torso (de la cadera a la cabeza), cara, mano_izquierda o mano_derecha (de cerca, para gestos de dedos).",
          },
          movimiento: {
            type: "string",
            description:
              "Opcional: una pose para probar, con la misma sintaxis de adentro de [MOVIMIENTO] (ej. 'rightUpperArm.z=60, rightUpperArm.y=30'). Se ve la pose ya terminada, sin duración ni animación.",
          },
        },
        required: ["angulo", "encuadre"],
      },
    },
  },
  execute: async (args) => {
    const capture = getSelfViewCapturer();
    if (!capture) return "Tu cuerpo todavía no terminó de cargar; intenta en un momento.";

    const angle = (SELF_VIEW_ANGLES.includes(args.angulo as SelfViewAngle) ? args.angulo : "cuatro") as SelfViewAngle;
    const framing = (SELF_VIEW_FRAMINGS.includes(args.encuadre as SelfViewFraming) ? args.encuadre : "cuerpo") as SelfViewFraming;
    const rawMovement = String(args.movimiento ?? "").trim();
    const preview = rawMovement ? parseMovementMarker(`[MOVIMIENTO: ${rawMovement}]`) : null;
    if (rawMovement && !preview) {
      return `No entendí la pose "${rawMovement}": usa el formato hueso.eje=intensidad separados por comas (ej. 'rightUpperArm.z=60, head.y=20').`;
    }

    try {
      const dataUrl = capture(angle, framing, preview);
      const what = preview ? `probando la pose "${rawMovement}" (solo para esta imagen)` : "tu pose actual";
      return [
        { type: "text", text: `Así te ves: ${framing}, desde ${angle === "cuatro" ? "cuatro ángulos" : angle}, ${what}.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ];
    } catch (err) {
      return `No se pudo generar la imagen: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
