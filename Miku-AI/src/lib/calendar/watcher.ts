import { load } from "@tauri-apps/plugin-store";
import { listEventsStartingWithin, listUpcomingEventsAllAccounts } from "./api";
import {
  CALENDAR_REMINDER_LEAD_MINUTES,
  CALENDAR_MILESTONE_DAYS,
} from "../../config/constants";

// Aviso de evento próximo (idea #7) -- mismo espíritu que el aviso de
// correo nuevo (lib/gmail/watcher.ts), pero el disparador es distinto:
// Gmail avisa de algo NUEVO (id de mensaje distinto al último visto);
// Calendar avisa de algo que ya estaba agendado pero está por EMPEZAR
// (dentro de CALENDAR_REMINDER_LEAD_MINUTES). Por eso el almacén no es
// "el último id visto por cuenta" sino "qué eventos ya se anunciaron",
// con su hora de inicio para poder podar los viejos.
const STORE_KEY = "calendarAnnouncedEvents";
// Un evento anunciado se olvida una vez que ya pasó hace rato -- no tiene
// sentido que el registro crezca para siempre con eventos que ya
// terminaron.
const FORGET_AFTER_MS = 60 * 60 * 1000; // 1 hora

async function loadAnnounced(): Promise<Record<string, number>> {
  const store = await load(".settings.dat", { autoSave: false });
  return (await store.get<Record<string, number>>(STORE_KEY)) ?? {};
}

async function saveAnnounced(announced: Record<string, number>) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, announced);
  await store.save();
}

function formatEventTime(event: { start: string }): string {
  // Eventos de todo el día vienen como "YYYY-MM-DD" (sin hora) -- para
  // esos no tiene sentido calcular "en cuántos minutos", ya se sabe que
  // es hoy si entró en la ventana de la consulta.
  if (!event.start.includes("T")) return "hoy";
  const minutesUntil = Math.round(
    (new Date(event.start).getTime() - Date.now()) / 60000,
  );
  return minutesUntil <= 1 ? "ahora mismo" : `en ${minutesUntil} minutos`;
}

// Devuelve el texto a anunciar del primer evento próximo real encontrado,
// o null si no hay ninguno nuevo que avisar.
export async function checkUpcomingEvents(): Promise<string | null> {
  const events = await listEventsStartingWithin(CALENDAR_REMINDER_LEAD_MINUTES);
  if (events.length === 0) return null;

  const announced = await loadAnnounced();
  const now = Date.now();

  // Poda primero -- eventos ya anunciados hace más de FORGET_AFTER_MS ya
  // cumplieron su función, no hace falta seguir cargándolos.
  for (const id of Object.keys(announced)) {
    if (now - announced[id] > FORGET_AFTER_MS) delete announced[id];
  }

  let announcement: string | null = null;
  for (const event of events) {
    if (announced[event.id]) continue;
    announced[event.id] = now;
    if (!announcement) {
      announcement = `Tienes "${event.summary}" ${formatEventTime(event)}${
        event.location ? ` en ${event.location}` : ""
      }.`;
    }
  }

  await saveAnnounced(announced);
  return announcement;
}

// Avisos de anticipación larga (idea de Sebastián: 1 semana / 3 días / el
// día anterior, ver CALENDAR_MILESTONE_DAYS) -- a diferencia de
// checkUpcomingEvents (que avisa cuando un evento está por EMPEZAR,
// ventana de minutos), esto avisa cuando un evento CRUZA uno de esos
// umbrales de anticipación, sin importar la hora exacta. Se guarda qué
// umbrales ya se anunciaron POR EVENTO (uno mismo puede pasar por los
// tres, uno a la vez, a medida que se acerca la fecha).
const MILESTONE_STORE_KEY = "calendarMilestonesAnnounced";

async function loadMilestonesAnnounced(): Promise<Record<string, number[]>> {
  const store = await load(".settings.dat", { autoSave: false });
  return (await store.get<Record<string, number[]>>(MILESTONE_STORE_KEY)) ?? {};
}

async function saveMilestonesAnnounced(announced: Record<string, number[]>) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(MILESTONE_STORE_KEY, announced);
  await store.save();
}

function describeMilestone(days: number): string {
  if (days === 1) return "mañana";
  if (days === 7) return "en una semana";
  return `en ${days} días`;
}

export async function checkMilestoneEvents(): Promise<string | null> {
  const maxDays = Math.max(...CALENDAR_MILESTONE_DAYS);
  const events = await listUpcomingEventsAllAccounts(maxDays, 20);
  const announced = await loadMilestonesAnnounced();

  // Poda -- un evento que ya no aparece en la ventana (pasó, o se borró)
  // no necesita seguir en el registro.
  const seenIds = new Set(events.map((e) => e.id));
  for (const id of Object.keys(announced)) {
    if (!seenIds.has(id)) delete announced[id];
  }

  const now = Date.now();
  let announcement: string | null = null;

  for (const event of events) {
    if (!event.start) continue;
    const daysUntil = (new Date(event.start).getTime() - now) / (24 * 60 * 60 * 1000);
    const alreadyAnnounced = announced[event.id] ?? [];

    // CALENDAR_MILESTONE_DAYS va de mayor a menor (7, 3, 1) -- se avisa
    // el primer umbral ya cruzado que todavía no se anunció. Un solo
    // umbral por evento por chequeo, aunque se hayan saltado varios
    // (ej. la app estuvo cerrada) -- no tiene sentido leer tres avisos
    // seguidos del mismo evento de una sola vez.
    for (const milestone of CALENDAR_MILESTONE_DAYS) {
      if (daysUntil > milestone) continue;
      if (alreadyAnnounced.includes(milestone)) continue;
      alreadyAnnounced.push(milestone);
      if (!announcement) {
        announcement = `Tienes "${event.summary}" ${describeMilestone(milestone)}${
          event.location ? ` en ${event.location}` : ""
        }.`;
      }
      break;
    }
    announced[event.id] = alreadyAnnounced;
  }

  await saveMilestonesAnnounced(announced);
  return announcement;
}
