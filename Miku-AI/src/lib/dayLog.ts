import { load } from "@tauri-apps/plugin-store";
import { DayTurn } from "./diaryDay";

// Registro de la charla de la PC con su hora, para el diario (ver
// diaryDay.ts). chatHistory.ts guarda solo los últimos turnos y sin hora;
// esto guarda los de los últimos días, solo texto. Local, en .settings.dat.

const STORE_KEY = "dayLog";
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

export async function appendDayTurn(user: string, assistant: string) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const now = Date.now();
    const log = ((await store.get<DayTurn[]>(STORE_KEY)) ?? []).filter((t) => now - t.at <= KEEP_MS);
    log.push({ at: now, user, assistant });
    await store.set(STORE_KEY, log);
    await store.save();
  } catch (err) {
    console.error("Error guardando la charla del día:", err);
  }
}

export async function readDayTurns(): Promise<DayTurn[]> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    return (await store.get<DayTurn[]>(STORE_KEY)) ?? [];
  } catch {
    return [];
  }
}
