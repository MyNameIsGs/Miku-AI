import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { load } from "@tauri-apps/plugin-store";

// Arrancar con Windows (2026-09-29, pedido de Sebastián). Solo desde la app
// instalada: si lo prendiera `pnpm tauri dev`, Windows arrancaría el
// ejecutable de desarrollo. La primera vez que se abre la instalada se
// prende sola (lo pidió él); si después lo apaga en Configuración, queda
// apagado (se recuerda que ya se decidió).

const DECIDED_KEY = "autostartDecided";

export const autostartAvailable = import.meta.env.PROD;

async function markDecided() {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(DECIDED_KEY, true);
  await store.save();
}

export async function ensureAutostartOnFirstRun() {
  if (!autostartAvailable) return;
  try {
    const store = await load(".settings.dat", { autoSave: false });
    if (await store.get<boolean>(DECIDED_KEY)) return;
    await enable();
    await markDecided();
    console.log("[Inicio] Miku va a arrancar con Windows.");
  } catch (err) {
    console.warn("[Inicio] No se pudo prender el arranque con Windows:", err);
  }
}

export async function isAutostartOn(): Promise<boolean> {
  if (!autostartAvailable) return false;
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setAutostart(on: boolean) {
  if (!autostartAvailable) return;
  if (on) await enable();
  else await disable();
  await markDecided();
}
