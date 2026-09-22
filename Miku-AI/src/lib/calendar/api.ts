import { loadCalendarAccounts, getValidAccessTokenForCalendar } from "./auth";

export type CalendarEventSummary = {
  account: string;
  id: string;
  summary: string;
  // ISO string si el evento tiene hora, o "YYYY-MM-DD" si es de todo el
  // día (Google Calendar distingue dateTime de date para ese caso).
  start: string;
  location: string;
};

async function calendarFetch(accessToken: string, path: string): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/primary${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// timeMin/timeMax en ISO -- reusada tanto por la tool de lectura a pedido
// (ventana de varios días) como por el watcher de avisos (ventana corta,
// los próximos N minutos). singleEvents=true expande eventos recurrentes
// en instancias concretas; sin esto, un evento repetido semanal vendría
// como una sola entrada con una regla de repetición en vez de próximas
// ocurrencias reales.
async function listEventsForAccount(
  accessToken: string,
  accountEmail: string,
  timeMinIso: string,
  timeMaxIso: string,
  maxResults: number,
): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  });
  const response = await calendarFetch(accessToken, `/events?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Error listando eventos de ${accountEmail}: ${await response.text()}`);
  }
  const data = await response.json();
  const items: any[] = data.items ?? [];
  return items.map((item) => ({
    account: accountEmail,
    id: item.id,
    summary: item.summary || "(sin título)",
    start: item.start?.dateTime ?? item.start?.date ?? "",
    location: item.location ?? "",
  }));
}

// Revisa TODAS las cuentas de Calendar conectadas -- mismo criterio que
// listRecentMessagesAllAccounts en Gmail: una cuenta que falla (token
// vencido, error de red) no debe tapar los resultados de las demás.
export async function listUpcomingEventsAllAccounts(
  withinDays = 7,
  maxResultsPerAccount = 15,
): Promise<CalendarEventSummary[]> {
  const accounts = await loadCalendarAccounts();
  if (accounts.length === 0) {
    throw new Error(
      "Calendar no está conectado -- Sebastián tiene que conectar al menos una cuenta desde el panel de Config.",
    );
  }

  const now = new Date();
  const timeMinIso = now.toISOString();
  const timeMaxIso = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const results: CalendarEventSummary[] = [];
  for (const account of accounts) {
    const token = await getValidAccessTokenForCalendar(account.email);
    if (!token) continue;
    try {
      const events = await listEventsForAccount(
        token,
        account.email,
        timeMinIso,
        timeMaxIso,
        maxResultsPerAccount,
      );
      results.push(...events);
    } catch (err) {
      console.error(`Error revisando el calendario de ${account.email}:`, err);
    }
  }
  return results;
}

// Ventana corta (minutos, no días) para el watcher de avisos -- ver
// lib/calendar/watcher.ts.
export async function listEventsStartingWithin(
  withinMinutes: number,
): Promise<CalendarEventSummary[]> {
  const accounts = await loadCalendarAccounts();
  if (accounts.length === 0) return [];

  const now = new Date();
  const timeMinIso = now.toISOString();
  const timeMaxIso = new Date(now.getTime() + withinMinutes * 60 * 1000).toISOString();

  const results: CalendarEventSummary[] = [];
  for (const account of accounts) {
    const token = await getValidAccessTokenForCalendar(account.email);
    if (!token) continue;
    try {
      const events = await listEventsForAccount(token, account.email, timeMinIso, timeMaxIso, 10);
      results.push(...events);
    } catch (err) {
      console.error(`Error revisando eventos próximos de ${account.email}:`, err);
    }
  }
  return results;
}
