// Google Maps, paso 3 (2026-09-28): búsqueda de lugares con Places API
// (New), Text Search. Pedir valoración y horario hace que cada búsqueda se
// cobre como "Enterprise" (1.000 gratis por mes, verificado 2026-09-28):
// de sobra para uso personal. Misma lógica que BuscarLugares.kt de Android.

export const PLACES_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours.openNow",
  "places.currentOpeningHours.weekdayDescriptions",
  "places.nationalPhoneNumber",
].join(",");

export const PLACES_MAX_RESULTS = 5;
// Radio de "cerca de mí": sesga los resultados, no los limita.
export const NEARBY_RADIUS_M = 5000;

type Place = {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
};

// Texto para Miku. weekdayDescriptions viene de lunes a domingo; `today`
// decide qué línea es la de hoy.
export function formatPlaces(places: Place[] | undefined, query: string, today: Date): string {
  if (!places || places.length === 0) return `No encontré lugares para "${query}".`;
  const todayIndex = (today.getDay() + 6) % 7;
  return places
    .map((p, i) => {
      const lines = [`${i + 1}. ${p.displayName?.text ?? "(sin nombre)"}`];
      if (p.formattedAddress) lines.push(`   Dirección: ${p.formattedAddress}`);
      if (p.rating !== undefined) {
        lines.push(`   Valoración: ${p.rating}${p.userRatingCount ? ` (${p.userRatingCount} opiniones)` : ""}`);
      }
      const hours = p.currentOpeningHours;
      if (hours) {
        const now = hours.openNow === undefined ? "" : hours.openNow ? "abierto ahora" : "cerrado ahora";
        const todayLine = hours.weekdayDescriptions?.[todayIndex];
        lines.push(`   Horario: ${[now, todayLine ? `hoy ${todayLine}` : ""].filter(Boolean).join("; ")}`);
      }
      if (p.nationalPhoneNumber) lines.push(`   Teléfono: ${p.nationalPhoneNumber}`);
      return lines.join("\n");
    })
    .join("\n");
}
