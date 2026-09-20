import { ToolDefinition } from "./types";
import { addReminder } from "../reminders/store";

// Timer de corto plazo (minutos/horas), no un pendiente (Tarea 6.7, que es
// para fechas de días/semanas y persiste por GitHub). Deliberadamente
// separada de anotar_pendiente en vez de ser una extensión: son dos
// escalas de tiempo distintas con semántica distinta (un timer que no
// sobrevive a cerrar la app tiene sentido, un pendiente que no sobrevive
// no lo tiene).
export const ponerRecordatorio: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "poner_recordatorio",
      description:
        "Programa un aviso de corto plazo, en minutos desde ahora -- un timer real, para cosas como 'avísame en 20 minutos' o 'recuérdame en una hora que...'. No la uses para fechas futuras (mañana, la próxima semana, un plazo de días) -- para eso está anotar_pendiente. El recordatorio se pierde si la aplicación se cierra antes de que llegue la hora, así que no la ofrezcas como algo permanente.",
      parameters: {
        type: "object",
        properties: {
          minutos: {
            type: "number",
            description:
              "En cuántos minutos, desde ahora, avisar. Ejemplo: 20 para 'en 20 minutos', 60 para 'en una hora'. Máximo 1440 (24 horas) -- para algo más lejano, usa anotar_pendiente en su lugar.",
          },
          mensaje: {
            type: "string",
            description:
              "Qué decir cuando se cumpla el tiempo -- una frase corta y natural, como si la dijeras en ese momento (ejemplo: 'ya se enfrió tu café').",
          },
        },
        required: ["minutos", "mensaje"],
      },
    },
  },
  execute: (args) => {
    const minutos = Number(args.minutos);
    const mensaje = String(args.mensaje ?? "").trim();

    if (!Number.isFinite(minutos) || minutos <= 0) {
      return "Error: los minutos tienen que ser un número mayor a 0.";
    }
    if (minutos > 24 * 60) {
      return "Error: no uses recordatorios de más de 24 horas -- para algo tan lejano, usa anotar_pendiente con una fecha.";
    }
    if (!mensaje) {
      return "Error: falta el mensaje del recordatorio.";
    }

    addReminder(minutos, mensaje);
    return `Recordatorio puesto para dentro de ${minutos} minuto${minutos === 1 ? "" : "s"}.`;
  },
};
