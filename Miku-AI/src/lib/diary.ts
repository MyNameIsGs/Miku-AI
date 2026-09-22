import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";

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

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function diaryPath(): Promise<string> {
  const dataDir = await appDataDir();
  const memoryDir = await join(dataDir, "memory");
  return join(memoryDir, "diario.md");
}

export async function hasWrittenDiaryToday(): Promise<boolean> {
  const store = await load(".settings.dat", { autoSave: false });
  const lastDate = await store.get<string>(STORE_KEY);
  return lastDate === todayLocalIso();
}

export async function markDiaryWrittenToday() {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, todayLocalIso());
  await store.save();
}

export async function appendDiaryEntry(text: string) {
  const path = await diaryPath();
  if (!(await exists(path))) {
    await writeTextFile(path, SEED_DIARY);
  }
  const current = await readTextFile(path);
  const dateHeader = `## ${todayLocalIso()}`;
  const updated = `${current.trim()}\n\n${dateHeader}\n\n${text.trim()}\n`;
  await writeTextFile(path, updated);
}
