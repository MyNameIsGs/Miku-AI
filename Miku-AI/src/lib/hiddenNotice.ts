import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

// §15 #17 (2026-09-28): si Miku está escondida (Minimizar o modo juego) y
// dice algo sola -- un recordatorio, un evento por empezar, el resumen de
// avisos --, antes solo se escuchaba. Ahora también sale un aviso de
// Windows con lo que dijo. Durante un juego en pantalla completa, Windows
// mismo los silencia (asistente de concentración), así que no interrumpe.
const MAX_CHARS = 200;

export async function notifyIfHidden(text: string) {
  const body = text.trim();
  if (!body) return;
  try {
    if (!(await invoke<boolean>("game_mode_is_hidden"))) return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    sendNotification({ title: "Miku", body: body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS - 1)}…` : body });
  } catch (err) {
    console.warn("[Aviso] No se pudo mostrar la notificación:", err);
  }
}
