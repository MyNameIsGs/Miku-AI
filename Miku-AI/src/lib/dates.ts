// Fechas de hoy en los dos formatos que usan los prompts (antes la misma
// cuenta estaba copiada en cinco archivos).

// YYYY-MM-DD en hora LOCAL (no toISOString(), que pasa a UTC y cerca de
// medianoche da el día de ayer o de mañana). Mismo formato que Android
// (LocalDate.now()), para que [GUARDAR_MEMORIA] se vea igual desde los dos.
export function localIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// "lunes, 28 de septiembre de 2026": para que calcule fechas relativas.
export function spanishDateLabel(now: Date = new Date()): string {
  return now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
