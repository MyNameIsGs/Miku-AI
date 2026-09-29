import { matchesQuery } from "./textSearch";

// D5 (2026-09-28): leer su propio diario desde la charla (tool
// leer_mi_diario). Por fecha y por texto, no por significado: con el modelo
// de embeddings actual todo puntúa parecido (medido con su conocimiento,
// ver textSearch.ts).

export type DiaryEntry = { date: string; text: string };

// El diario se escribe como "## YYYY-MM-DD" seguido de la entrada (ver
// diary.ts). El encabezado del archivo no es una entrada.
export function parseDiary(content: string): DiaryEntry[] {
  return content
    .split(/\n(?=## \d{4}-\d{2}-\d{2})/)
    .map((section) => {
      const match = section.match(/^## (\d{4}-\d{2}-\d{2})\s*\n?([\s\S]*)$/);
      return match ? { date: match[1], text: match[2].trim() } : null;
    })
    .filter((e): e is DiaryEntry => e !== null && e.text.length > 0);
}

// Sin fecha ni búsqueda: las últimas `max`. Con fecha: esa noche. Con
// búsqueda: las que tienen esas palabras (sin importar tildes). De la más
// reciente a la más vieja.
export function findDiaryEntries(entries: DiaryEntry[], opts: { date?: string; query?: string }, max = 3): DiaryEntry[] {
  return entries
    .filter((e) => !opts.date || e.date === opts.date)
    .filter((e) => !opts.query || matchesQuery(e.text, opts.query))
    .reverse()
    .slice(0, max);
}
