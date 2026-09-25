import { useRef } from "react";
import { TASK_WATCH_INTERVAL_MS, OPENROUTER_MODEL } from "../config/constants";
import {
  loadPendientes,
  getTareasSeguimiento,
  markCondicionRevisada,
  closePendienteById,
} from "../lib/pendientes";
import { buscarEnWeb } from "../lib/tools/buscarEnWeb";
import { buildTaskEvalPrompt } from "../prompts/taskPrompt";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";

type UseTaskWatcherParams = {
  // No urgente -- se junta con el resto del resumen agrupado, igual que
  // correo y calendario.
  queueAnnouncement: (text: string) => void;
};

// Idea #9: pendientes con "condición" (ver lib/pendientes.ts) son tareas
// de seguimiento -- cosas verificables buscando en la web que Miku revisa
// sola cada tanto, en vez de que buscar_en_web responda una vez y se
// olvide. A diferencia de correo/calendario, cada revisión cuesta dinero
// de verdad (una búsqueda real + una llamada chica al LLM), por eso el
// intervalo es de horas, no minutos, y se revisa UNA tarea por ciclo nada
// más -- aunque haya varias pendientes, no dispara varias búsquedas de golpe.
export function useTaskWatcher({ queueAnnouncement }: UseTaskWatcherParams) {
  const lastCheckRef = useRef(performance.now());
  const isCheckingRef = useRef(false);

  async function runCheck() {
    const pendientes = await loadPendientes();
    const tareas = getTareasSeguimiento(pendientes);
    if (tareas.length === 0) return;

    const tarea = tareas[0];
    const consulta = `${tarea.descripcion}. ${tarea.condicion}`;
    const searchResult = String(await buscarEnWeb.execute({ consulta }));

    const prompt = buildTaskEvalPrompt({
      descripcion: tarea.descripcion,
      condicion: tarea.condicion!,
      searchResult,
    });
    const response = await fetchOpenRouterWithRetry({
      model: OPENROUTER_MODEL,
      messages: [{ role: "system", content: prompt }],
    }, { kind: "seguimiento" });
    const data = await response.json();
    const reply: string = (data.choices?.[0]?.message?.content ?? "").trim();

    await markCondicionRevisada([tarea.id]);

    if (reply.toUpperCase().startsWith("CUMPLIDA")) {
      const message = reply.split("\n").slice(1).join(" ").trim();
      queueAnnouncement(
        message || `Se cumplió lo que estabas esperando: "${tarea.descripcion}".`,
      );
      await closePendienteById(tarea.id);
    }
  }

  function checkTasks(now: number) {
    if (isCheckingRef.current || now - lastCheckRef.current < TASK_WATCH_INTERVAL_MS) {
      return;
    }
    lastCheckRef.current = now;
    isCheckingRef.current = true;

    runCheck()
      .catch((err) => console.error("Error revisando tareas de seguimiento:", err))
      .finally(() => {
        isCheckingRef.current = false;
      });
  }

  return { checkTasks };
}
