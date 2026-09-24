import { RefObject, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { OPENROUTER_MODEL } from "../config/constants";
import { loadMemoryContext } from "../lib/memory";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { isStreamModeActive } from "../lib/streamMode";
import { formatDuration, getCurrentSession, touchCurrentSession } from "../lib/gameSessions";
import { buildGameBreakPrompt } from "../prompts/gameBreakPrompt";

// Después de esto seguido en el mismo juego, Miku puede sugerir una pausa.
const GAME_BREAK_AFTER_MS = 2 * 60 * 60 * 1000;
// Guardado para no repetir la sugerencia si la app se reinicia a mitad de
// la misma sesión (la sesión se retoma con el mismo inicio, ver
// gameSessions.ts).
const REMINDED_KEY = "gameBreakRemindedForSessionStart";

type UseGameBreaksParams = {
  speak: (text: string, pitch: number, rate: number, expression: string) => Promise<void>;
  voicePitchRef: RefObject<number>;
  voiceRateRef: RefObject<number>;
};

// Pausas en sesiones largas de juego: una sola vez por sesión, a su manera
// (ver gameBreakPrompt.ts). Se llama seguido (cada minuto con la ventana
// visible, y con el latido de Rust cuando está oculta -- ahí los
// temporizadores de la página están frenados, ver game_mode.rs); casi
// siempre no hace nada.
//
// Habla aunque esté en modo juego (que retiene los otros avisos): es
// justamente para decirlo mientras juega -- al hablar, Miku aparece, lo
// dice y se vuelve a esconder. En modo stream, no: sería un aviso personal
// en pleno directo.
export function useGameBreaks({ speak, voicePitchRef, voiceRateRef }: UseGameBreaksParams) {
  const inFlightRef = useRef(false);
  const remindedForRef = useRef<number | null | undefined>(undefined);

  async function remindedFor(): Promise<number | null> {
    if (remindedForRef.current === undefined) {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        remindedForRef.current = (await store.get<number>(REMINDED_KEY)) ?? null;
      } catch {
        remindedForRef.current = null;
      }
    }
    return remindedForRef.current;
  }

  async function markReminded(sessionStart: number) {
    remindedForRef.current = sessionStart;
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set(REMINDED_KEY, sessionStart);
      await store.save();
    } catch (err) {
      console.error("[Pausas] No se pudo guardar:", err);
    }
  }

  async function check() {
    await touchCurrentSession();
    const session = getCurrentSession();
    if (!session || session.durationMs < GAME_BREAK_AFTER_MS) return;
    if (inFlightRef.current || isStreamModeActive()) return;
    if ((await remindedFor()) === session.start) return;

    inFlightRef.current = true;
    // Se marca ANTES de pedirle nada: si algo falla, mejor quedarse sin la
    // sugerencia que repetirla (mismo criterio que el briefing).
    await markReminded(session.start);
    try {
      const { world, personality } = await loadMemoryContext();
      const prompt = buildGameBreakPrompt({
        world,
        personality,
        game: session.game,
        duration: formatDuration(session.durationMs),
        timeLabel: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
      });
      const response = await fetchOpenRouterWithRetry({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: prompt }],
      });
      const data = await response.json();
      const reply: string = (data.choices?.[0]?.message?.content ?? "").trim();
      if (!reply || reply.toUpperCase().includes("SILENCIO")) {
        console.log(`[Pausas] Miku decidió no decir nada tras ${formatDuration(session.durationMs)} de ${session.game}.`);
        return;
      }
      await speak(reply, voicePitchRef.current, voiceRateRef.current, "neutral");
    } catch (err) {
      console.error("[Pausas] Error pidiendo la sugerencia de pausa:", err);
    } finally {
      inFlightRef.current = false;
    }
  }

  return { check };
}
