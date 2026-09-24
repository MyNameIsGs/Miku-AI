// Modo juego: activo mientras hay un juego (o cualquier app) a pantalla
// completa en primer plano -- lo detecta game_mode.rs y lo escribe
// useGameMode. Módulo plano, mismo patrón que streamMode.ts: lo leen los
// watchers (no son componentes).
//
// Mientras está activo, los avisos automáticos se guardan para después,
// igual que en el modo stream y el horario de no molestar (ver
// shouldHoldAnnouncements en quietHours.ts): nada de interrumpir en plena
// partida. Los recordatorios que pidió Sebastián sí suenan.
let gameModeActive = false;

export function setGameModeActive(active: boolean) {
  gameModeActive = active;
}

export function isGameModeActive(): boolean {
  return gameModeActive;
}
