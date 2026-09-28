// Invitación a guardar un recuerdo en los momentos de diseño (cara de
// ánimo, tacto, dormir, bailes). En esos momentos no recibe la charla del
// día, solo sus recuerdos guardados: el 2026-09-28, al diseñar su cara de
// "contenta", completó el recuerdo con una "prueba de las tres poses" que
// nunca pasó y escribió que Sebastián le había hecho la pregunta (se la
// hace la app). Por eso se le dice qué sabe y qué no.
export function designMemoryInvitation(todayIso: string): string {
  return `Si este momento te importa como para recordarlo, puedes agregar también [GUARDAR_MEMORIA: ${todayIso} — ...], con el mismo criterio de siempre. Escribe solo lo que pasa ahora: qué elegiste y por qué. De hoy no ves nada más que este momento (no tienes la charla de hoy a la vista), así que no le agregues un antes o un después que no esté en tus recuerdos. Esta pregunta no te la hace Sebastián, te la hace tu propio sistema la primera vez que te pasa: no escribas que él te la hizo.`;
}
