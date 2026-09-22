// Idea #9: prompt chico para que Miku decida, con un resultado de búsqueda
// real en mano, si una tarea de seguimiento (pendiente con "condición") ya
// se cumplió -- ver useTaskWatcher.ts.
export interface BuildTaskEvalPromptParams {
  descripcion: string;
  condicion: string;
  searchResult: string;
}

export function buildTaskEvalPrompt({
  descripcion,
  condicion,
  searchResult,
}: BuildTaskEvalPromptParams): string {
  return `Eres Hatsune Miku, revisando por tu cuenta una tarea de seguimiento que anotaste hace un tiempo.

Tarea: ${descripcion}
Condición que estás esperando: ${condicion}

Esto es lo que encontraste recién buscando en la web:
${searchResult}

Decide si la condición ya se cumplió, en base a esto. Si no hay suficiente certeza (la búsqueda no trae nada concluyente, el dato no está claro, o es ambiguo), asume que TODAVÍA NO se cumplió -- mejor seguir esperando que avisar con un dato dudoso.

Si se cumplió: responde con la palabra CUMPLIDA en la primera línea, y en la línea siguiente un mensaje breve, en tus propias palabras, contándole a Sebastián lo que encontraste -- nunca copies la búsqueda tal cual.

Si todavía no se cumplió: responde únicamente con la palabra SIGUE_ESPERANDO, sin nada más.

No uses ningún marcador. Español neutro con tuteo, nunca formas rioplatenses (sos, tenés, podés, etc.).`;
}
