import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { OPENROUTER_MODEL, REPO_ROOT } from "../config/constants";
import { appendDiaryEntry, getLastDiaryDate, markDiaryDone } from "../lib/diary";
import { pendingDiaryDate, summarizeDay } from "../lib/diaryDay";
import { readDayTurns } from "../lib/dayLog";
import { localIsoDate, spanishDateLabel } from "../lib/dates";
import { loadMemoryContext } from "../lib/memory";
import { readMoodLog } from "../lib/mood";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { readPhoneVoiceHistory } from "../lib/phoneVoiceHistory";
import { buildDiaryPrompt } from "../prompts/diaryPrompt";

// Tarea 8.9, a hora fija desde 2026-09-29 (ver lib/diaryDay.ts): cada
// minuto se mira si le toca escribir; a las 23:00 escribe el de hoy, y si
// anoche la PC estaba apagada, al abrirse escribe el de ayer. Un día sin
// nada (ni charla, ni voz en el celular, ni cambios de ánimo) no genera
// una entrada vacía. Se marca como hecho recién cuando salió bien: si
// falla (sin internet), lo reintenta más tarde.

const CHECK_MS = 60 * 1000;
// Al abrir, un rato antes del primer intento (que termine de arrancar).
const FIRST_CHECK_MS = 90 * 1000;
const RETRY_AFTER_FAIL_MS = 30 * 60 * 1000;

let inFlight = false;
let retryAt = 0;

async function maybeWriteDiary() {
  if (inFlight || Date.now() < retryAt) return;
  const now = new Date();
  const date = pendingDiaryDate(now, await getLastDiaryDate());
  if (!date) return;

  inFlight = true;
  try {
    const [turns, phone, moods] = await Promise.all([readDayTurns(), readPhoneVoiceHistory(), readMoodLog()]);
    const day = summarizeDay(date, turns, phone, moods);
    if (!day.hasActivity) {
      console.log(`[Diario] ${date}: no pasó nada, no hay entrada.`);
      await markDiaryDone(date);
      return;
    }

    const [y, m, d] = date.split("-").map(Number);
    const { personality, world, memories } = await loadMemoryContext();
    const prompt = buildDiaryPrompt({
      world,
      personality,
      memories,
      dateLabel: spanishDateLabel(new Date(y, m - 1, d)),
      late: date !== localIsoDate(now),
      day,
    });
    const response = await fetchOpenRouterWithRetry(
      { model: OPENROUTER_MODEL, messages: [{ role: "system", content: prompt }] },
      { kind: "diario" },
    );
    const data = await response.json();
    const text: string = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("respuesta vacía");

    await appendDiaryEntry(text, date);
    await markDiaryDone(date);
    console.log(`[Diario] Escribió la entrada del ${date}.`);
    // Que llegue a GitHub ya, no recién al cerrar la app.
    invoke("sync_memory_to_github", { repoRoot: REPO_ROOT }).catch((err) =>
      console.error("[SYNC] Error al sincronizar el diario:", err),
    );
  } catch (err) {
    console.error("[Diario] No se pudo escribir, se reintenta en 30 min:", err);
    retryAt = Date.now() + RETRY_AFTER_FAIL_MS;
  } finally {
    inFlight = false;
  }
}

export function useDiary() {
  useEffect(() => {
    const first = window.setTimeout(maybeWriteDiary, FIRST_CHECK_MS);
    const timer = window.setInterval(maybeWriteDiary, CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
}
