import * as THREE from "three";
import { VRM, VRMExpression, VRMExpressionMorphTargetBind } from "@pixiv/three-vrm";

// [CARA: parte=intensidad, ...]: partes sueltas de la cara que Miku puede
// mezclar a su gusto, además de las 5 expresiones armadas. El modelo trae
// estas formas, pero solo venían metidas dentro de esas 5 (las lágrimas,
// por ejemplo, solo aparecían con "sad"); ahora puede usarlas por separado.
// Cada una se fotografió sola y combinada con las demás antes de
// describírsela (ver buildFacePartsInstructions).
//
// Las vocales (あいうえお) no están: la boca al hablar la maneja la
// sincronía de labios.

type FacePart = {
  morph: string;
  // Cierra los ojos (total o parcialmente): el parpadeo se apaga en la
  // misma medida mientras esté puesta, para que no se superpongan.
  closesEyes?: boolean;
  description: string;
};

export const FACE_PARTS: Record<string, FacePart> = {
  ojos_cerrados: { morph: "まばたき", closesEyes: true, description: "cerrar los ojos; a medias (40-60) quedan entornados: sueño, desconfianza, calma" },
  ojos_felices: { morph: "笑い", closesEyes: true, description: "ojos cerrados de alegría, en forma de ^^" },
  ojos_apretados: { morph: "はぅ", closesEyes: true, description: "ojos apretados en forma de >< (emoción fuerte, esfuerzo, vergüenza)" },
  guino_izq: { morph: "ウィンク２", closesEyes: true, description: "guiño con tu ojo izquierdo" },
  guino_der: { morph: "ｳｨﾝｸ２右", closesEyes: true, description: "guiño con tu ojo derecho" },
  mirar_abajo: { morph: "下", description: "párpados y mirada hacia abajo (timidez, vergüenza, pensar)" },
  ojos_llorosos: { morph: "涙", description: "ojos húmedos y brillantes, a punto de llorar o de emoción (solo se nota con los ojos abiertos)" },
  cejas_enojadas: { morph: "怒り", description: "cejas de enojo" },
  cejas_preocupadas: { morph: "困る", description: "cejas preocupadas, arqueadas hacia arriba en el centro (pena, duda, nervios, ternura)" },
  boca_sonrisa: { morph: "ワ", description: "sonrisa con la boca abierta" },
  boca_puchero: { morph: "∧", description: "boca en ∧: puchero, disgusto, aguantarse algo" },
};

const EXPRESSION_PREFIX = "cara_";
export const faceExpressionName = (part: string) => `${EXPRESSION_PREFIX}${part}`;

// Las registra como expresiones del VRM (una vez, al cargar el modelo).
// Así las maneja el mismo expressionManager que las 5 de siempre, y el
// parpadeo se apaga solo con las que cierran los ojos (overrideBlink).
export function registerFaceParts(vrm: VRM) {
  const manager = vrm.expressionManager;
  if (!manager) return;
  const meshes: THREE.Mesh[] = [];
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary) meshes.push(mesh);
  });
  for (const [part, def] of Object.entries(FACE_PARTS)) {
    const name = faceExpressionName(part);
    if (manager.getExpression(name)) continue;
    const expression = new VRMExpression(name);
    for (const mesh of meshes) {
      const index = mesh.morphTargetDictionary![def.morph];
      if (index !== undefined) {
        expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 }));
      }
    }
    if (expression.binds.length === 0) continue;
    if (def.closesEyes) expression.overrideBlink = "blend";
    vrm.scene.add(expression);
    manager.registerExpression(expression);
  }
}

// Una cara hecha de partes viaja como texto por donde viaja una expresión
// (speak(), las reacciones al tacto): "cara:ojos_llorosos=0.8,boca_puchero=1".
const ENCODED_PREFIX = "cara:";

export function encodeFace(parts: Record<string, number>): string {
  return ENCODED_PREFIX + Object.entries(parts).map(([part, w]) => `${part}=${w}`).join(",");
}

export function decodeFace(expression: string): Record<string, number> | null {
  if (!expression.startsWith(ENCODED_PREFIX)) return null;
  const parts: Record<string, number> = {};
  for (const pair of expression.slice(ENCODED_PREFIX.length).split(",")) {
    const [part, value] = pair.split("=");
    const weight = parseFloat(value);
    if (FACE_PARTS[part] && !Number.isNaN(weight)) parts[part] = weight;
  }
  return parts;
}

// [CARA: cejas_preocupadas=60, ojos_llorosos=100] -> cara codificada, o
// null si no hay marcador (o ninguna parte válida). Intensidad 0-100.
export function parseFaceMarker(text: string): string | null {
  const matches = [...text.matchAll(/\[CARA:\s*([\s\S]*?)\]/gi)];
  if (matches.length === 0) return null;
  const parts: Record<string, number> = {};
  for (const pair of matches[matches.length - 1][1].split(",")) {
    const [rawKey, rawValue] = pair.split("=").map((s) => s.trim());
    const key = rawKey?.toLowerCase().replace(/ñ/g, "n");
    const value = parseFloat(rawValue ?? "");
    if (key && FACE_PARTS[key] && !Number.isNaN(value)) {
      parts[key] = Math.max(0, Math.min(100, value)) / 100;
    }
  }
  return Object.keys(parts).length > 0 ? encodeFace(parts) : null;
}

export function buildFacePartsInstructions(): string {
  const lines = Object.entries(FACE_PARTS)
    .map(([part, def]) => `- ${part}: ${def.description}`)
    .join("\n");
  return `CARA POR PARTES (opcional, para cuando ninguna de las cinco expresiones dice lo que sientes):
[CARA: parte=intensidad, parte2=intensidad2]
Intensidad de 0 a 100. Si usas [CARA], reemplaza a [EXPRESION] durante esa respuesta. Partes:
${lines}
Combinaciones que se ven bien (comprobadas mirándote): a punto de llorar = cejas_preocupadas=100, ojos_llorosos=100, boca_puchero=60; sonrisa nerviosa = cejas_preocupadas=100, boca_sonrisa=70; sonrisa apenada = ojos_felices=100, cejas_preocupadas=80; guiño = guino_izq=100, boca_sonrisa=100; vergüenza = mirar_abajo=100, cejas_preocupadas=70; puchero = boca_puchero=100, cejas_preocupadas=50.
Evita juntar cejas_enojadas con cejas_preocupadas (se mezclan en algo raro), y ojos_llorosos con ojos cerrados (las lágrimas están en los ojos: cerrados no se ven).`;
}
