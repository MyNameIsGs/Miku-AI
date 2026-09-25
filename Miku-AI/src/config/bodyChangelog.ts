// Novedades del cuerpo de Miku, con fecha. Sebastián quiere que ella sepa
// cuándo su cuerpo recibe herramientas nuevas, y que decida por sí misma si
// mejora lo que diseñó antes (reacciones al tacto, quirks, gestos) -- sin
// que nadie se lo borre ni se lo cambie.
//
// Para agregar una novedad: una entrada nueva al final. La versión es la
// cantidad de entradas, así que todo lo diseñado antes queda "sin revisar".
export const BODY_CHANGELOG: { date: string; items: string[] }[] = [
  {
    date: "2026-09-24",
    items: [
      "tus límites de huesos pasaron a ser los de un cuerpo humano (el brazo llega adelante, el antebrazo gira hacia adentro, la muñeca se dobla de verdad, el codo ya no se dobla de costado)",
    ],
  },
  {
    date: "2026-09-25",
    items: [
      "[LLEVAR_MANO]: dices adónde quieres la mano (mejilla, cintura, pecho, hacia Sebastián...) y el brazo se calcula solo, incluso eligiendo hacia dónde mira la palma",
      "[CARA]: puedes mezclar partes sueltas de la cara (lágrimas, guiños, cejas preocupadas, puchero, ojos felices...)",
      "gestos de mano nuevos (paz, pulgar arriba, OK, mano con los dedos separados) y el pulgar ahora mueve su base de verdad",
      "después de moverte sabes cómo quedó tu cuerpo: dónde quedó cada mano, hacia dónde mira la palma y si alguna parte atraviesa otra",
      "cuando diseñas una reacción al tacto te ves antes de guardarla",
    ],
  },
];

export const BODY_TOOLS_VERSION = BODY_CHANGELOG.length;

// Las novedades desde una versión (sin versión = desde el principio).
export function bodyNewsSince(version: number | undefined): string {
  return BODY_CHANGELOG.slice(version ?? 0)
    .map(({ date, items }) => `${date}:\n${items.map((item) => `- ${item}`).join("\n")}`)
    .join("\n");
}
