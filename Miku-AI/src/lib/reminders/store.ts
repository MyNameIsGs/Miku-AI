// Recordatorios de corto plazo (minutos/horas), distintos de los
// pendientes de la Tarea 6.7 (que son de días/semanas y sincronizan por
// GitHub). Un recordatorio es más parecido a un timer de cocina: vive
// solo en memoria mientras la app está abierta, se pierde si se cierra
// antes de que llegue la hora, y no tiene sentido que sobreviva a un
// reinicio -- "recuérdame en 20 minutos" no significa nada horas después.
//
// Mismo patrón que appLauncherStore.ts: un módulo plano (no un hook), para
// que la tool poner_recordatorio pueda escribir acá sin depender de React.
// El hook useReminders.ts es el único lector -- revisa cada frame si algo
// venció y dispara speak() cuando corresponde.

export type Reminder = {
  id: string;
  message: string;
  dueAt: number; // epoch ms
};

let reminders: Reminder[] = [];
let onFire: ((reminder: Reminder) => void) | null = null;

export function addReminder(minutes: number, message: string): Reminder {
  const reminder: Reminder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    dueAt: Date.now() + minutes * 60_000,
  };
  reminders = [...reminders, reminder];
  return reminder;
}

export function getActiveReminders(): Reminder[] {
  return reminders;
}

// useReminders.ts registra acá qué hacer cuando vence uno -- el store no
// sabe nada de React ni de cómo se habla, solo de cuándo.
export function registerReminderFireHandler(handler: (r: Reminder) => void) {
  onFire = handler;
}

// Llamado cada frame desde onBeforeRender (ver App.tsx). Si hay más de uno
// vencido a la vez, se disparan todos -- se van a encolar solos en
// useSpeech (ver la cola de speak()), no hace falta lógica extra acá.
export function checkDueReminders(now: number) {
  if (!onFire || reminders.length === 0) return;
  const due = reminders.filter((r) => r.dueAt <= now);
  if (due.length === 0) return;
  reminders = reminders.filter((r) => r.dueAt > now);
  due.forEach((r) => onFire!(r));
}
