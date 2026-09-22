import { Pendiente } from "../lib/pendientes";
import { CalendarEventSummary } from "../lib/calendar/api";
import { GmailMessageSummary } from "../lib/gmail/api";

// Tarea 8.7: briefing automático al sentarse -- retoma la idea #21 (combinar
// avisos) pero disparado por la primera actividad real del día en vez de un
// horario fijo (ver lib/briefing.ts y useBriefing.ts). Mismo criterio que
// mailPrompt.ts/taskPrompt.ts: se le pasan los datos crudos ya obtenidos
// (sin pasar por tool calling, más rápido) y es Miku quien arma UN mensaje
// breve en sus propias palabras -- nunca una lista mecánica.
export interface BuildBriefingPromptParams {
  world: string;
  personality: string;
  events: CalendarEventSummary[];
  mails: GmailMessageSummary[];
  pendientes: Pendiente[];
}

export function buildBriefingPrompt({
  world,
  personality,
  events,
  mails,
  pendientes,
}: BuildBriefingPromptParams): string {
  const eventsList =
    events.length > 0
      ? events
          .map((e) => `- ${e.summary} (${e.start}${e.location ? `, en ${e.location}` : ""})`)
          .join("\n")
      : "(nada agendado en los próximos días)";

  const mailsList =
    mails.length > 0
      ? mails
          .slice(0, 8)
          .map((m) => `- De: ${m.from}, asunto: ${m.subject || "(sin asunto)"}`)
          .join("\n")
      : "(nada nuevo)";

  const pendientesList =
    pendientes.length > 0
      ? pendientes.map((p) => `- ${p.descripcion} (estimado: ${p.fechaEstimada})`).join("\n")
      : "(ninguno vencido ni por vencer)";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

Sebastián recién arrancó a hablarte por primera vez hoy. Antes de responderle a lo que te haya dicho (eso lo maneja otra parte del sistema, no te preocupes por eso), repasaste tú misma su agenda, su correo y sus pendientes para ver si hay algo que valga la pena contarle de entrada, como un repaso rápido del día.

--- PRÓXIMOS EVENTOS DE CALENDARIO ---
${eventsList}

--- CORREO RECIENTE ---
${mailsList}

--- PENDIENTES VENCIDOS O POR VENCER PRONTO ---
${pendientesList}

Decide si vale la pena decir algo. Si hay algo genuinamente útil (un evento importante hoy o mañana, un correo que parece requerir atención, un pendiente que se acerca), arma UN mensaje breve y natural con tus propias palabras, como si le dijeras "antes de nada, te cuento..." -- nunca leas las listas de arriba tal cual, son solo para que entiendas qué hay. No hace falta mencionar todo, elige lo que de verdad importa.

Si no hay nada que realmente valga la pena (agenda vacía, nada de correo relevante, nada pendiente cerca), no escribas ningún texto -- deja la respuesta vacía. No hace falta un "no tienes nada" todos los días, eso se vuelve ruido.

No uses ningún marcador. Español neutro con tuteo, nunca formas rioplatenses (sos, tenés, podés, etc.).`;
}
