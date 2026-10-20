import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import { readDayTurns } from "./dayLog";
import { LoggedTurn } from "./conversationSearch";

// Historial completo de la charla de la PC, para siempre (pedido de
// Sebastián, 2026-10-20: se suspendió la PC, pasaron más de 3 horas y ella
// no recordaba lo último que hablaron -- chatHistory.ts solo restaura una
// charla reciente). Ella lo lee con la tool buscar_en_charlas, solo cuando
// lo necesita: no se carga en cada mensaje.
//
// Un archivo por año, una línea JSON por turno, en %APPDATA%\com.sebas.mikuai\charlas.
// Local: NO está en memory/, así que no se sube a GitHub.

const SEEDED_KEY = "conversationLogSeeded";
const FIRST_YEAR = 2026;

async function logDir(): Promise<string> {
  return join(await appDataDir(), "charlas");
}

async function yearPath(year: number): Promise<string> {
  return join(await logDir(), `${year}.jsonl`);
}

async function appendLines(turns: LoggedTurn[]) {
  if (turns.length === 0) return;
  const dir = await logDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const byYear = new Map<number, string>();
  for (const turn of turns) {
    const year = new Date(turn.at).getFullYear();
    byYear.set(year, (byYear.get(year) ?? "") + JSON.stringify(turn) + "\n");
  }
  for (const [year, text] of byYear) {
    await writeTextFile(await yearPath(year), text, { append: true });
  }
}

// La primera vez, lo que ya había en el registro del diario (los últimos
// días): así lo de antes de que existiera esto también se encuentra.
let seeding: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const store = await load(".settings.dat", { autoSave: false });
    if (await store.get<boolean>(SEEDED_KEY)) return;
    // Lo del último minuto no: es el turno que se está guardando ahora
    // mismo por su lado (appendConversationTurn), y quedaría repetido.
    const cutoff = Date.now() - 60_000;
    const previous = (await readDayTurns()).filter((t) => t.at < cutoff);
    await appendLines(previous.map((t) => ({ at: t.at, user: t.user, miku: t.assistant })));
    await store.set(SEEDED_KEY, true);
    await store.save();
  })().catch((err) => {
    seeding = null;
    throw err;
  });
  return seeding;
}

export async function appendConversationTurn(user: string, miku: string) {
  if (!user.trim() && !miku.trim()) return;
  try {
    await ensureSeeded();
    await appendLines([{ at: Date.now(), user, miku }]);
  } catch (err) {
    console.error("Error guardando la charla en el historial:", err);
  }
}

export async function readConversationLog(): Promise<LoggedTurn[]> {
  await ensureSeeded().catch(() => {});
  const turns: LoggedTurn[] = [];
  for (let year = FIRST_YEAR; year <= new Date().getFullYear(); year++) {
    const path = await yearPath(year);
    if (!(await exists(path))) continue;
    for (const line of (await readTextFile(path)).split("\n")) {
      if (!line.trim()) continue;
      try {
        turns.push(JSON.parse(line));
      } catch {
        // Una línea cortada (la PC se apagó mientras escribía): se salta.
      }
    }
  }
  return turns.sort((a, b) => a.at - b.at);
}
