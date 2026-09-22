import { QUIET_HOURS_END_HOUR, QUIET_HOURS_START_HOUR } from "../config/constants";

// Idea #20: franja horaria en la que ningún aviso automático (correo,
// Calendar, pendientes) habla solo -- se acumulan y se leen cuando termina.
// Soporta que la franja cruce la medianoche (ej. 23 a 8) además del caso
// simple (0 a 7) que se usa por defecto.
export function isQuietHours(now: Date = new Date()): boolean {
  const hour = now.getHours();
  if (QUIET_HOURS_START_HOUR === QUIET_HOURS_END_HOUR) return false;
  if (QUIET_HOURS_START_HOUR < QUIET_HOURS_END_HOUR) {
    return hour >= QUIET_HOURS_START_HOUR && hour < QUIET_HOURS_END_HOUR;
  }
  return hour >= QUIET_HOURS_START_HOUR || hour < QUIET_HOURS_END_HOUR;
}
