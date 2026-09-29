import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import { DiaryEntry, parseDiary } from "./diaryEntries";

// Tarea 8.9: diario nocturno propio de Miku -- reflexión suya sobre la
// jornada (qué pensó, cómo se sintió), NO una lista de eventos (eso ya es
// memories.md). Archivo aparte, sincronizado por GitHub con el mismo
// mecanismo que el resto de la memoria (ver sync_memory_to_github/
// pull_memory_from_github en lib.rs) -- ella lo escribe, Sebastián puede
// leerlo si quiere pero no hay ningún panel en la app para editarlo, mismo
// criterio de privacidad que personality.md.
const SEED_DIARY = `# Diario de Miku

(Reflexiones propias sobre cada jornada -- esto no es una lista de eventos, es lo que ella piensa y siente al respecto.)
`;

const STORE_KEY = "lastDiaryDate";

async function diaryPath(): Promise<string> {
  const dataDir = await appDataDir();
  const memoryDir = await join(dataDir, "memory");
  return join(memoryDir, "diario.md");
}

// D5: sus entradas, para la tool leer_mi_diario.
export async function readDiaryEntries(): Promise<DiaryEntry[]> {
  const path = await diaryPath();
  return (await exists(path)) ? parseDiary(await readTextFile(path)) : [];
}

// El último día que ya escribió (o que se saltó por no haber pasado nada).
export async function getLastDiaryDate(): Promise<string | null> {
  const store = await load(".settings.dat", { autoSave: false });
  return (await store.get<string>(STORE_KEY)) ?? null;
}

export async function markDiaryDone(date: string) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, date);
  await store.save();
}

export async function appendDiaryEntry(text: string, date: string) {
  const path = await diaryPath();
  if (!(await exists(path))) {
    await writeTextFile(path, SEED_DIARY);
  }
  const current = await readTextFile(path);
  const dateHeader = `## ${date}`;
  const updated = `${current.trim()}\n\n${dateHeader}\n\n${text.trim()}\n`;
  await writeTextFile(path, updated);
}
