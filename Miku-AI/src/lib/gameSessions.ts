import { load } from "@tauri-apps/plugin-store";

// Sesiones de juego: a qué juega Sebastián y cuánto, a partir de lo que ya
// detecta el modo juego (game_mode.rs -> useGameMode). Dos usos:
// - Contexto para Miku (describeGameContext): qué está jugando ahora y un
//   resumen de la semana, para que pueda comentarlo si le nace.
// - Pausas en sesiones largas (useGameBreaks).
//
// Solo local (.settings.dat), no se sincroniza por GitHub: es un registro
// de actividad de esta PC, no memoria de Miku.

type GameSession = { game: string; start: number; end: number };

const STORE_KEY = "gameSessions";
// Salir del juego un rato (alt-tab, reiniciar la app) y volver al MISMO
// juego antes de esto cuenta como la misma sesión.
const MERGE_GAP_MS = 10 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const SUMMARY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let saved: GameSession[] = [];
let current: GameSession | null = null;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const store = await load(".settings.dat", { autoSave: false });
    saved = (await store.get<GameSession[]>(STORE_KEY)) ?? [];
  } catch (err) {
    console.error("[Sesiones de juego] No se pudieron cargar:", err);
  }
}

async function persist() {
  const cutoff = Date.now() - KEEP_MS;
  const all = [...saved, ...(current ? [current] : [])].filter((s) => s.end >= cutoff);
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, all);
    await store.save();
  } catch (err) {
    console.error("[Sesiones de juego] No se pudieron guardar:", err);
  }
}

// "League of Legends.exe" -> "League of Legends".
export function gameNameFrom(processName: string, title: string): string {
  return processName.replace(/\.exe$/i, "").trim() || title.trim() || "un juego";
}

// Lo llama useGameMode con cada cambio del modo juego.
export async function recordGameState(active: boolean, game: string | null) {
  await ensureLoaded();
  const now = Date.now();

  if (current && (!active || current.game !== game)) {
    current.end = now;
    saved.push(current);
    current = null;
  }
  if (active && game && !current) {
    // Volvió al mismo juego enseguida: se retoma la sesión anterior.
    const last = saved[saved.length - 1];
    if (last && last.game === game && now - last.end < MERGE_GAP_MS) {
      saved.pop();
      current = { ...last, end: now };
    } else {
      current = { game, start: now, end: now };
    }
  }
  await persist();
}

// Latido mientras dura la sesión: mantiene el "hasta cuándo" al día (por
// si la app se cierra en plena partida) y se guarda cada tanto.
let lastPersistAt = 0;
export async function touchCurrentSession() {
  if (!current) return;
  current.end = Date.now();
  if (Date.now() - lastPersistAt > 60 * 1000) {
    lastPersistAt = Date.now();
    await persist();
  }
}

export function getCurrentSession(): { game: string; durationMs: number; start: number } | null {
  if (!current) return null;
  return { game: current.game, durationMs: Date.now() - current.start, start: current.start };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// Texto para el prompt de Miku, o null si no hay nada que contar.
export async function describeGameContext(): Promise<string | null> {
  await ensureLoaded();
  const now = Date.now();
  const lines: string[] = [];

  const cur = getCurrentSession();
  if (cur) {
    lines.push(`Ahora mismo está jugando ${cur.game} (lleva ${formatDuration(cur.durationMs)}).`);
  }

  const totals = new Map<string, { ms: number; sessions: number }>();
  for (const s of [...saved, ...(current ? [current] : [])]) {
    if (s.end < now - SUMMARY_WINDOW_MS) continue;
    const t = totals.get(s.game) ?? { ms: 0, sessions: 0 };
    t.ms += s.end - s.start;
    t.sessions += 1;
    totals.set(s.game, t);
  }
  const week = [...totals.entries()]
    .filter(([, t]) => t.ms >= 5 * 60 * 1000)
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 5)
    .map(([game, t]) => `${game}: ${formatDuration(t.ms)} en ${t.sessions} ${t.sessions === 1 ? "sesión" : "sesiones"}`);
  if (week.length > 0) {
    lines.push(`En los últimos 7 días jugó: ${week.join("; ")}.`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

