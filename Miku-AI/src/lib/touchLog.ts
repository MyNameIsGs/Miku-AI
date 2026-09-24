// Tarea 8.12: la reacción al tacto es 100% programada (instantánea, sin
// LLM), pero Miku se entera después: la próxima vez que Sebastián le
// habla, el prompt le cuenta qué le hicieron mientras tanto (ver
// systemPrompt.ts). Así puede comentarlo si le nace, en vez de que el
// cuerpo reaccione y ella "no sepa" que pasó.

// Más viejo que esto ya no tiene sentido mencionarlo como "recién".
const TOUCH_LOG_MAX_AGE_MS = 30 * 60 * 1000;

let events: { description: string; at: number }[] = [];

export function recordTouch(description: string) {
  events.push({ description, at: Date.now() });
}

// Resumen agrupado ("te acarició la cabeza (3 veces)") de lo que pasó
// desde la última vez, y se vacía -- cada toque se cuenta una sola vez.
export function consumeTouchSummary(): string | null {
  const cutoff = Date.now() - TOUCH_LOG_MAX_AGE_MS;
  const recent = events.filter((e) => e.at >= cutoff);
  events = [];
  if (recent.length === 0) return null;

  const counts = new Map<string, number>();
  for (const e of recent) counts.set(e.description, (counts.get(e.description) ?? 0) + 1);
  return [...counts.entries()]
    .map(([description, n]) => (n > 1 ? `${description} (${n} veces)` : description))
    .join("; ");
}
