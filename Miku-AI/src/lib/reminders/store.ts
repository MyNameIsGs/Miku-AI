import { load } from "@tauri-apps/plugin-store";

// Recordatorios de corto plazo (minutos/horas), distintos de los
// pendientes de la Tarea 6.7 (que son de días/semanas y sincronizan por
// GitHub). Un recordatorio es como un timer de cocina.
//
// D6 (2026-09-28): sobreviven al cierre de la app. Se guardan en
// .settings.dat (local); al abrir se recuperan. Los que vencieron con la
// app cerrada se avisan al abrir, diciendo para qué hora eran, si no pasó
// demasiado (LATE_LIMIT_MS): "recuérdame en 20 minutos" no significa nada
// un día después, así que los más viejos se descartan.
//
// Mismo patrón que appLauncherStore.ts: un módulo plano (no un hook), para
// que la tool poner_recordatorio pueda escribir acá sin depender de React.
// El hook useReminders.ts es el único lector -- revisa cada frame si algo
// venció y dispara speak() cuando corresponde.

export type Reminder = {
  id: string;
  message: string;
  dueAt: number; // epoch ms
  // Venció con la app cerrada: se avisa tarde, aclarándolo.
  late?: boolean;
};

const STORE_KEY = "reminders";
const LATE_LIMIT_MS = 12 * 60 * 60 * 1000;

let reminders: Reminder[] = [];
let onFire: ((reminder: Reminder) => void) | null = null;
let loaded = false;

async function persist() {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, reminders);
    await store.save();
  } catch (err) {
    console.error("[Recordatorios] No se pudieron guardar:", err);
  }
}

// Al abrir la app: recupera los guardados. Los vencidos con la app cerrada
// se marcan como tarde (y se avisan en el próximo cuadro); los de hace más
// de LATE_LIMIT_MS se descartan.
export async function loadReminders() {
  if (loaded) return;
  loaded = true;
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const saved = (await store.get<Reminder[]>(STORE_KEY)) ?? [];
    const now = Date.now();
    const kept = saved
      .filter((r) => now - r.dueAt <= LATE_LIMIT_MS)
      .map((r) => (r.dueAt <= now ? { ...r, late: true } : r));
    const dropped = saved.length - kept.length;
    if (dropped > 0) console.log(`[Recordatorios] ${dropped} vencieron hace demasiado con la app cerrada: se descartan.`);
    reminders = [...kept, ...reminders];
    if (dropped > 0) await persist();
  } catch (err) {
    console.error("[Recordatorios] No se pudieron cargar:", err);
  }
}

export function addReminder(minutes: number, message: string): Reminder {
  const reminder: Reminder = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message,
    dueAt: Date.now() + minutes * 60_000,
  };
  reminders = [...reminders, reminder];
  persist();
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
  persist();
  due.forEach((r) => onFire!(r));
}

// Lo que se dice: el mensaje tal cual, o con la aclaración si llega tarde.
export function reminderSpeech(reminder: Reminder): string {
  if (!reminder.late) return reminder.message;
  const time = new Date(reminder.dueAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return `Te lo digo tarde, era para las ${time} y la app estaba cerrada: ${reminder.message}`;
}
