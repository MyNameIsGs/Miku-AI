export const WIDTH = 750;
export const HEIGHT = 680;

// Tarea 6.0b: cambiado de deepseek-v4-flash-vision-exp (experimental) a
// v4.1-flash (2026-09-10) -- arquitectura multimodal nativa desde el
// pre-entrenamiento (mejor para propiocepción visual), probado antes de
// cambiar con scripts/tarea-6.0-test-tools.mjs (TEST_MODEL=...): sigue
// emitiendo marcadores con tools presente, habla antes de ejecutar una
// tool, registro neutro sin rioplatense -- sin señales de degradación.
export const OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";

export const MAX_HISTORY_TURNS = 20;

// Cada cuántas escrituras (memorias o personalidad) se sube la memoria a
// GitHub y se revisa si la personalidad creció tanto como para consolidarla.
// memories.md nunca se consolida (ver useMemoryFiles.ts).
export const MEMORY_CONSOLIDATION_THRESHOLD = 5;

export const VOICE_PITCH_MIN = -24;
export const VOICE_PITCH_MAX = 48;
export const VOICE_RATE_MIN = -60;
export const VOICE_RATE_MAX = 100;

export const IDLE_QUIRK_INTERVAL_MS = 150000; // 2.5 minutos

// Cada cuánto revisar si llegó correo nuevo (ver lib/gmail/watcher.ts) --
// mismo valor que usa la variante de Android, balance entre "se entera
// pronto" y no ametrallar la API de Gmail en cada rato de silencio.
export const GMAIL_CHECK_INTERVAL_MS = 300000; // 5 minutos

// Idea #7: cada cuánto revisar el calendario (mismo balance que Gmail) y
// con cuánta anticipación avisar de un evento que está por empezar.
export const CALENDAR_CHECK_INTERVAL_MS = 300000; // 5 minutos
export const CALENDAR_REMINDER_LEAD_MINUTES = 20;

// Resumen agrupado (idea nueva): correo nuevo y avisos de anticipación
// larga de Calendar no son urgentes -- en vez de interrumpir apenas se
// detectan, se acumulan y se leen juntos cada tanto. El aviso de "está
// por empezar" (arriba) sigue siendo inmediato a propósito -- retrasarlo
// le quitaría el sentido.
export const NOTIFICATION_DIGEST_INTERVAL_MS = 900000; // 15 minutos

// Idea #20: horario de no molestar -- ningún aviso automático (ni el
// urgente de "está por empezar", ni el resumen agrupado) habla solo
// durante esta franja. Se acumulan igual (ver isQuietHours en
// lib/quietHours.ts) y se leen apenas termina. NO afecta a
// poner_recordatorio: ese lo pide Sebastián a propósito para un momento
// puntual, no es un aviso pasivo del sistema.
export const QUIET_HOURS_START_HOUR: number = 0; // 00:00
export const QUIET_HOURS_END_HOUR: number = 7; // 07:00

// Pedido de Sebastián: además del aviso de "está por empezar" (arriba),
// avisos de anticipación larga -- una semana, 3 días y el día anterior.
// Descendente a propósito (ver checkMilestoneEvents en watcher.ts, que
// recorre esta lista de mayor a menor).
export const CALENDAR_MILESTONE_DAYS = [7, 3, 1];

// Idea #9: cada cuánto revisar si alguna tarea de seguimiento (pendiente
// con "condición", ver lib/pendientes.ts) ya se cumplió -- cada revisión
// hace una búsqueda web real ($0.02, ver buscarEnWeb.ts) más una llamada
// chica al LLM para evaluar el resultado, así que el intervalo es mucho
// más largo que el resto de los chequeos automáticos. Una tarea por ciclo
// nada más (ver useTaskWatcher.ts), no todas de golpe.
export const TASK_WATCH_INTERVAL_MS = 21600000; // 6 horas

// Cuántos ciclos de vaivén corre un quirk ANIMADO antes de asentarse solo,
// si Miku no eligió un valor propio con "ciclos=N" al crearlo (ver
// markers.ts/systemPrompt.ts) -- pedido de Sebastián: 2 (el valor viejo,
// implícito) se sentía corto para algo como tararear.
export const DEFAULT_QUIRK_REVERT_CYCLES = 3;

// Fase 7: en cada tick idle, si ya tiene al menos un quirk propio guardado,
// esta es la probabilidad de correrlo directamente (sin llamar al LLM) en
// vez de preguntarle qué quiere hacer. Sin calibrar contra uso real todavía.
export const DIRECT_QUIRK_RUN_CHANCE = 0.5;

export const DEFAULT_MOVEMENT_DURATION_MS = 1000;
export const DEFAULT_HAND_GESTURE_DURATION_MS = 400;

export const EXPRESSION_SMOOTHING = 0.08;
export const GAZE_SMOOTHING = 0.03;
export const DOUBLE_BLINK_CHANCE = 0.05;

export const VOICE_SERVER_URL = "http://127.0.0.1:8899";
export const REPO_ROOT = import.meta.env.VITE_REPO_ROOT ?? "";
