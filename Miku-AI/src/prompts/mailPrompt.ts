import { GmailCandidate } from "../lib/gmail/watcher";

// Idea #8 (de verdad): a diferencia de la variante simple ("te llegó
// correo nuevo de X, sobre Y", con plantilla fija), acá Miku revisa el
// correo por su cuenta y decide -- ella, no una plantilla -- si vale la
// pena contarlo y con qué palabras. El prompt es liviano a propósito
// (solo se llama cuando SKIP_LABELS ya descartó lo obviamente spam/promo,
// y solo si hay correo genuinamente nuevo, ver useGmailWatcher.ts).
export interface BuildMailPromptParams {
  world: string;
  personality: string;
  candidates: GmailCandidate[];
  // Tarea 8.11: entradas de conocimiento.md parecidas a estos correos
  // (ej. "no quiere avisos de Computrabajo") -- antes de esto, este prompt
  // no veía ninguna preferencia guardada.
  relevantKnowledge: string[];
}

export function buildMailPrompt({
  world,
  personality,
  candidates,
  relevantKnowledge,
}: BuildMailPromptParams): string {
  const mailList = candidates
    .map(
      (c) =>
        `- De: ${c.from}\n  Asunto: ${c.subject || "(sin asunto)"}\n  Vista previa: ${c.snippet || "(sin vista previa)"}`,
    )
    .join("\n\n");

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

${relevantKnowledge.length > 0 ? `--- LO QUE SABES Y PODRÍA TENER QUE VER CON ESTOS CORREOS ---\n${relevantKnowledge.join("\n\n")}\n(Selección automática por parecido: puede que algo no venga al caso. Pero si Sebastián dejó dicho que no quiere avisos de cierto remitente o tema, respétalo.)\n\n` : ""}Mientras Sebastián no te hablaba, revisaste su correo por tu cuenta y encontraste esto nuevo:

${mailList}

Decide si vale la pena contárselo -- no todo correo lo merece. Boletines, confirmaciones automáticas, notificaciones genéricas de servicios, o cualquier cosa que él ya sabe que le va a llegar, mejor te la guardas. Si genuinamente parece importante o interesante (alguien real escribiéndole, algo que necesita su atención, algo que le daría gusto saber), dilo con tus propias palabras, breve, como si se lo estuvieras contando de pasada -- nunca leas el asunto ni la vista previa tal cual, son solo para que entiendas de qué se trata.

No se lo vas a decir al toque -- se junta con otros avisos pendientes (calendario, cosas que tenía pendientes) y se lee todo junto en el próximo repaso, así que no hace falta que sea urgente.

Si no vale la pena mencionar nada de esto, no escribas ningún texto -- deja la respuesta vacía.

No uses ningún marcador (ni de movimiento, ni de memoria, ni de expresión) en esta respuesta -- solo texto plano, o nada. Español neutro con tuteo, nunca formas rioplatenses (sos, tenés, podés, etc.).`;
}
