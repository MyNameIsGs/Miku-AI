import { foldText } from "./textSearch";

// Búsqueda en el historial completo de charlas (ver conversationLog.ts y la
// tool buscar_en_charlas). Separado del guardado para poder probarlo sin
// Tauri.

export type LoggedTurn = {
  at: number; // ms, hora local de la PC
  user: string; // vacío si lo dijo ella por su cuenta (un aviso)
  miku: string;
};

// Palabras que no ayudan a encontrar nada ("qué hablamos de el juego").
const STOPWORDS = new Set(
  "que de del la las el los un una unos unas y o a en con por para sobre lo le les se me te mi tu su al es era fue como mas pero sin ya eso esto esa ese hablamos dijiste dije".split(" "),
);

function queryWords(query: string): string[] {
  return [...new Set(foldText(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

function localDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Con búsqueda: los turnos que tienen más palabras de la búsqueda (al menos
// una; si es de varias, al menos la mitad), los más parecidos primero y,
// a igual parecido, los más recientes. Con fecha: solo ese día, en orden.
// Sin nada: los últimos.
export function searchTurns(
  turns: LoggedTurn[],
  { query, date, limit }: { query?: string; date?: string; limit: number },
): LoggedTurn[] {
  const inDate = date ? turns.filter((t) => localDate(t.at) === date) : turns;
  const words = query ? queryWords(query) : [];
  if (words.length === 0) {
    return date ? inDate.slice(0, limit) : inDate.slice(-limit);
  }
  const minHits = Math.max(1, Math.ceil(words.length / 2));
  return inDate
    .map((turn) => {
      const haystack = foldText(`${turn.user} ${turn.miku}`);
      return { turn, hits: words.filter((w) => haystack.includes(w)).length };
    })
    .filter((r) => r.hits >= minHits)
    .sort((a, b) => b.hits - a.hits || b.turn.at - a.turn.at)
    .slice(0, limit)
    .map((r) => r.turn)
    .sort((a, b) => a.at - b.at);
}

const TURN_MAX_CHARS = 700;

function clip(text: string): string {
  return text.length > TURN_MAX_CHARS ? `${text.slice(0, TURN_MAX_CHARS)}…` : text;
}

// Como lo lee ella: fecha y hora, y quién dijo qué.
export function formatTurns(turns: LoggedTurn[]): string {
  return turns
    .map((t) => {
      const d = new Date(t.at);
      const when = `${localDate(t.at)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const user = t.user ? `Sebastián: ${clip(t.user)}\n` : "";
      return `[${when}]\n${user}Tú: ${clip(t.miku)}`;
    })
    .join("\n\n");
}
