import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

// B4 del plan: dónde se va el tiempo de cada respuesta, antes de optimizar
// nada. Tramos: preparar (memoria, conocimiento, prompt), modelo (con las
// vueltas de herramientas), procesar (marcadores, poses, gestos) y voz
// (desde que se pide el audio hasta que suena; incluye esperar si había
// otro audio en la cola, como el briefing). Consola, terminal y un registro
// local (latencyLog en .settings.dat, últimas 200).

const LOG_KEY = "latencyLog";
const LOG_MAX = 200;

export type LatencyMarks = { start: number; llmStart: number; llmEnd: number; speakStart: number; audioStart: number };

export async function recordLatency(marks: LatencyMarks, muted: boolean) {
  const s = (a: number, b: number) => +((b - a) / 1000).toFixed(2);
  const entry = {
    at: new Date().toISOString(),
    preparar: s(marks.start, marks.llmStart),
    modelo: s(marks.llmStart, marks.llmEnd),
    procesar: s(marks.llmEnd, marks.speakStart),
    voz: s(marks.speakStart, marks.audioStart),
    total: s(marks.start, marks.audioStart),
    silenciada: muted,
  };
  const msg = `[Demora] ${entry.total} s hasta que habla: preparar ${entry.preparar}, modelo ${entry.modelo}, procesar ${entry.procesar}, voz ${entry.voz}${muted ? " (silenciada)" : ""}`;
  console.log(msg);
  invoke("log_to_terminal", { msg }).catch(() => {});
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const log = (await store.get<(typeof entry)[]>(LOG_KEY)) ?? [];
    log.push(entry);
    await store.set(LOG_KEY, log.slice(-LOG_MAX));
    await store.save();
  } catch (err) {
    console.error("Error guardando el registro de demora:", err);
  }
}
