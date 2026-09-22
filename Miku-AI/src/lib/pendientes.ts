import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

// Tarea 6.7, Nivel 1 y 2: pendientes con iniciativa. Van en su propio
// archivo estructurado (no en memories.md, que es prosa sin estado ni
// vencimiento -- un pendiente necesita ambos o se acumula basura vieja que
// ella sigue mencionando). Vive junto al resto de la memoria en
// %APPDATA%\...\memory\, así se sincroniza a GitHub con el mismo mecanismo
// que personality.md/memories.md/world.md (ver sync_memory_to_github /
// pull_memory_from_github en lib.rs) -- eso es lo que además permite que,
// más adelante, la app de Android pueda usar la misma información sin
// construir nada nuevo (no se tocó el lado Android en esta tarea).
export type Pendiente = {
  id: string;
  descripcion: string;
  // YYYY-MM-DD. Miku la calcula ella misma a partir de la fecha de hoy
  // (ver systemPrompt.ts) y lo que haya dicho Sebastián.
  fechaEstimada: string;
  creadoEn: string;
  estado: "activo" | "cerrado";
  // Última vez que lo mencionó por su cuenta en un quirk idle -- evita que
  // repita el mismo recordatorio cada 2.5 minutos.
  ultimoRecordatorio: string | null;
  // Idea #9: cuando el pendiente es algo verificable buscando en la web
  // (ej. "el pasaje a Japón baja de $800"), esto lo vuelve una tarea de
  // seguimiento -- ver useTaskWatcher.ts, que la revisa sola cada tanto en
  // vez de esperar a que se acerque fechaEstimada. null para un pendiente
  // normal (la mayoría).
  condicion: string | null;
  // Última vez que se revisó la condición con una búsqueda real -- separado
  // de ultimoRecordatorio porque este cooldown es mucho más largo (cuesta
  // dinero cada revisión, no tiene sentido chequear cada 2.5 minutos).
  ultimaRevisionCondicion: string | null;
};

async function pendientesPath(): Promise<string> {
  const dataDir = await appDataDir();
  const memoryDir = await join(dataDir, "memory");
  return join(memoryDir, "pendientes.json");
}

export async function loadPendientes(): Promise<Pendiente[]> {
  const path = await pendientesPath();
  if (!(await exists(path))) return [];
  try {
    const raw = await readTextFile(path);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Pendiente[]) : [];
  } catch (err) {
    console.error("Error leyendo pendientes.json:", err);
    return [];
  }
}

async function savePendientes(pendientes: Pendiente[]) {
  const path = await pendientesPath();
  await writeTextFile(path, JSON.stringify(pendientes, null, 2));
}

export async function addPendiente(
  descripcion: string,
  fechaEstimada: string,
  condicion: string | null = null,
): Promise<Pendiente> {
  const pendientes = await loadPendientes();
  const nuevo: Pendiente = {
    id: crypto.randomUUID(),
    descripcion,
    fechaEstimada,
    creadoEn: new Date().toISOString(),
    estado: "activo",
    ultimoRecordatorio: null,
    condicion,
    ultimaRevisionCondicion: null,
  };
  pendientes.push(nuevo);
  await savePendientes(pendientes);
  return nuevo;
}

// Busca por coincidencia parcial de texto en vez de por id -- Miku no ve
// ids opacos en ningún lado, solo descripciones (mismo criterio que
// abrir_aplicacion: que el propio LLM haga el emparejamiento, no un id
// exacto que tendría que inventarse).
export async function closePendienteByDescripcion(
  query: string,
): Promise<Pendiente | null> {
  const pendientes = await loadPendientes();
  const normalized = query.trim().toLowerCase();
  const match = pendientes.find(
    (p) => p.estado === "activo" && p.descripcion.toLowerCase().includes(normalized),
  );
  if (!match) return null;
  match.estado = "cerrado";
  await savePendientes(pendientes);
  return match;
}

export function getActivePendientes(pendientes: Pendiente[]): Pendiente[] {
  return pendientes.filter((p) => p.estado === "activo");
}

const REMINDER_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 horas
const DUE_SOON_DAYS = 3;

// Pendientes activos, vencidos o por vencer dentro de DUE_SOON_DAYS, que no
// se hayan mencionado en las últimas REMINDER_COOLDOWN_MS -- son los
// candidatos a que el loop idle los saque a colación hablando (Nivel 2).
// El resto de los pendientes activos igual están disponibles para
// conversación normal (ver systemPrompt.ts), solo no se empujan solos.
export function getDuePendientes(
  pendientes: Pendiente[],
  now: Date = new Date(),
): Pendiente[] {
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + DUE_SOON_DAYS);

  return pendientes.filter((p) => {
    if (p.estado !== "activo") return false;
    const fecha = new Date(p.fechaEstimada);
    if (Number.isNaN(fecha.getTime()) || fecha > threshold) return false;
    if (p.ultimoRecordatorio) {
      const sinceLast = now.getTime() - new Date(p.ultimoRecordatorio).getTime();
      if (sinceLast < REMINDER_COOLDOWN_MS) return false;
    }
    return true;
  });
}

export async function markPendientesReminded(ids: string[]) {
  if (ids.length === 0) return;
  const pendientes = await loadPendientes();
  const now = new Date().toISOString();
  for (const p of pendientes) {
    if (ids.includes(p.id)) p.ultimoRecordatorio = now;
  }
  await savePendientes(pendientes);
}

// Idea #9: cada revisión de una condición hace una búsqueda web real (le
// cuesta dinero, ver buscarEnWeb.ts) -- cooldown mucho más largo que el de
// los recordatorios de fecha, que solo leen un archivo local.
const CONDITION_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 horas

// Pendientes activos con una condición (tareas de seguimiento, ver
// useTaskWatcher.ts) que no se hayan revisado en las últimas
// CONDITION_CHECK_COOLDOWN_MS -- son los candidatos a una búsqueda real.
export function getTareasSeguimiento(
  pendientes: Pendiente[],
  now: Date = new Date(),
): Pendiente[] {
  return pendientes.filter((p) => {
    if (p.estado !== "activo" || !p.condicion) return false;
    if (p.ultimaRevisionCondicion) {
      const sinceLast = now.getTime() - new Date(p.ultimaRevisionCondicion).getTime();
      if (sinceLast < CONDITION_CHECK_COOLDOWN_MS) return false;
    }
    return true;
  });
}

export async function markCondicionRevisada(ids: string[]) {
  if (ids.length === 0) return;
  const pendientes = await loadPendientes();
  const now = new Date().toISOString();
  for (const p of pendientes) {
    if (ids.includes(p.id)) p.ultimaRevisionCondicion = now;
  }
  await savePendientes(pendientes);
}

export async function closePendienteById(id: string) {
  const pendientes = await loadPendientes();
  const match = pendientes.find((p) => p.id === id);
  if (!match) return;
  match.estado = "cerrado";
  await savePendientes(pendientes);
}
