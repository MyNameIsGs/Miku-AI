// Tarea 8.3: modo stream automático -- activo mientras OBS transmite o
// graba (lo escribe useStreamMode, que le pregunta a OBS cada pocos
// segundos; ver obs_status.rs). Módulo plano, mismo patrón que
// appLauncherStore.ts: lo leen tools y watchers, que no son componentes.
//
// Mientras está activo:
// - Los avisos automáticos (correo, Calendar, pendientes, quirks) no se
//   leen en voz alta: se acumulan y se leen cuando termina, igual que en el
//   horario de no molestar (ver shouldHoldAnnouncements en quietHours.ts).
// - El briefing del día se posterga (no se marca como dado).
// - Las acciones de escritorio quedan frenadas como con el interruptor
//   global (ver areDesktopActionsDisabled en appLauncherStore.ts).
// - Miku sabe que está en directo (ver systemPrompt.ts) para no mencionar
//   datos privados.
// NO afecta a poner_recordatorio: ese lo pidió Sebastián a propósito para
// un momento puntual, mismo criterio que el horario de no molestar.
let streamModeActive = false;

export function setStreamModeActive(active: boolean) {
  streamModeActive = active;
}

export function isStreamModeActive(): boolean {
  return streamModeActive;
}
