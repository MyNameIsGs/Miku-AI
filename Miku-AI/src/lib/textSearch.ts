// Búsqueda por texto del panel Memoria. Se probó por significado
// (embeddings e5, 2026-09-28) y con el conocimiento real de Miku no
// separaba nada: todas las entradas puntuaban 0,76-0,86 contra cualquier
// búsqueda, tuviera o no relación ("fútbol" puntuaba más alto que "la
// falda" contra sus notas de la falda). Por texto, "helado" encuentra la
// promesa del helado y nada más.

// Minúsculas y sin tildes: "Canción" y "cancion" se encuentran igual.
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Todas las palabras de la búsqueda tienen que aparecer, en cualquier orden.
// Una búsqueda vacía no filtra nada.
export function matchesQuery(text: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldText(text);
  return words.every((word) => haystack.includes(word));
}
