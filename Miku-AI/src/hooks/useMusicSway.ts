import { RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BoneTransition, ParsedMovement } from "../types";
import { loadMemoryContext } from "../lib/memory";
import { isGameModeActive } from "../lib/gameMode";
import { designWithSelfView } from "../lib/designMoment";
import { getMusicDesign, loadMusicDesign, saveMusicDesign } from "../lib/musicStore";
import { buildMusicDesignPrompt } from "../prompts/musicPrompt";

// Punto 5b del plan: Miku se mueve con la música que suena en la PC, al
// compás, si ella quiere y como ella lo diseñó. El ritmo lo detecta Rust
// escuchando la salida de audio (ver src-tauri/src/music_beat.rs), que manda
// "musica" ~4 veces por segundo con { bpm, confidence, level, lastBeatMsAgo }.

type MusicBeat = { bpm: number; confidence: number; level: number; lastBeatMsAgo: number };

// Pulso claro: más de esto, sostenido, es música con ritmo. Medido: bombo
// sintético 0,89-0,95, una pista real por el loopback 0,81-0,86, voz 0,35,
// ruido 0,21. Por debajo de OFF, sostenido, se apaga (histéresis).
const CONFIDENCE_ON = 0.5;
const CONFIDENCE_OFF = 0.4;
const ON_AFTER_MS = 4000;
const OFF_AFTER_MS = 3000;
// Menos volumen que esto no cuenta (una pestaña de fondo casi muda).
const LEVEL_MIN = 0.003;
// Si Rust deja de mandar, se da por terminada.
const STALE_AFTER_MS = 2000;
// Cada cuánto se revisa el compás (y si otro gesto le quitó los huesos).
const RESYNC_EVERY_MS = 4000;
// Diferencia de tempo que obliga a reprogramar el vaivén.
const TEMPO_CHANGE_RATIO = 0.03;
const HOLD_WHILE_MUSIC_MS = 24 * 60 * 60 * 1000;
const DESIGN_RETRY_AFTER_MS = 30 * 60 * 1000;
const BEATS_PER_CYCLE_OPTIONS = [1, 2, 4];

type UseMusicSwayParams = {
  scheduleMovement: (parsed: ParsedMovement, origin: "idle", autoRevertDelayMs?: number) => void;
  releaseQuirkRevertsNow: (keys: string[]) => void;
  boneTransitionsRef: RefObject<Record<string, BoneTransition>>;
  showExpressionFor: (expression: string, forMs: number) => void;
  isSpeakingRef: RefObject<boolean>;
  asleepRef: RefObject<boolean>;
  processMemoryMarkers: (reply: string) => Promise<void>;
};

export function useMusicSway({
  scheduleMovement,
  releaseQuirkRevertsNow,
  boneTransitionsRef,
  showExpressionFor,
  isSpeakingRef,
  asleepRef,
  processMemoryMarkers,
}: UseMusicSwayParams) {
  const beatRef = useRef<(MusicBeat & { at: number }) | null>(null);
  const musicOnRef = useRef(false);
  const aboveSinceRef = useRef<number | null>(null);
  const belowSinceRef = useRef<number | null>(null);
  // El vaivén en curso: qué huesos, a qué tempo, y el período del ciclo.
  const swayRef = useRef<{ keys: string[]; bpm: number; cycleMs: number } | null>(null);
  const lastResyncRef = useRef(0);
  const designInFlightRef = useRef(false);
  const designRetryAfterRef = useRef(0);

  useEffect(() => {
    loadMusicDesign();
    invoke("escuchar_musica").catch((err) => console.warn("[Música] No se pudo escuchar el audio de la PC:", err));
    const unlisten = listen<MusicBeat>("musica", (event) => {
      beatRef.current = { ...event.payload, at: performance.now() };
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function requestDesign(bpm: number) {
    if (designInFlightRef.current || Date.now() < designRetryAfterRef.current) return;
    designInFlightRef.current = true;
    try {
      await loadMusicDesign();
      if (getMusicDesign()) return;
      const { world, personality, memories } = await loadMemoryContext();
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const result = await designWithSelfView(buildMusicDesignPrompt({ world, personality, memories, todayIso, bpm }), "diseñar música");
      if (!result) throw new Error("sin respuesta");
      for (const reply of result.replies) await processMemoryMarkers(reply);
      const { design, replies } = result;
      if (!design.movement && !design.expression && /\[NO_BAILO\]/i.test(replies[0])) {
        await saveMusicDesign({ choice: "no", createdAt: new Date().toISOString() });
        console.log("[Música] Miku decidió no moverse con la música.");
        return;
      }
      if (!design.movement?.entries.length) {
        throw new Error(`respuesta sin [MOVIMIENTO] ni [NO_BAILO]: ${replies[0].slice(0, 200)}`);
      }
      await saveMusicDesign({
        choice: "bailo",
        expression: design.expression,
        entries: design.movement.entries,
        durationMs: design.movement.durationMs,
        createdAt: new Date().toISOString(),
        rangos: 0,
      });
      console.log("[Música] Miku diseñó cómo se mueve con la música:", replies[replies.length - 1]);
    } catch (err) {
      console.warn("[Música] No se pudo diseñar cómo se mueve con la música; se reintenta más tarde:", err);
      designRetryAfterRef.current = Date.now() + DESIGN_RETRY_AFTER_MS;
    } finally {
      designInFlightRef.current = false;
    }
  }

  function stopSway() {
    const sway = swayRef.current;
    if (!sway) return;
    swayRef.current = null;
    releaseQuirkRevertsNow(sway.keys);
  }

  // Programa (o reprograma) el vaivén al compás: el extremo del vaivén cae
  // en un golpe (con 2 golpes por vaivén, un extremo en cada golpe).
  function startSway(beat: MusicBeat, now: number) {
    const design = getMusicDesign();
    if (!design || design.choice !== "bailo") return;
    const beatMs = 60000 / beat.bpm;
    const beatsPerCycle = BEATS_PER_CYCLE_OPTIONS.reduce((best, option) =>
      Math.abs(option * beatMs - design.durationMs) < Math.abs(best * beatMs - design.durationMs) ? option : best,
    );
    const cycleMs = beatsPerCycle * beatMs;
    const keys = design.entries.map((e) => `${e.bone}.${e.axis}`);
    scheduleMovement({ entries: design.entries, durationMs: cycleMs, animated: true }, "idle", HOLD_WHILE_MUSIC_MS);
    const lastBeatAt = now - beat.lastBeatMsAgo;
    for (const key of keys) {
      const transition = boneTransitionsRef.current[key];
      if (transition) transition.startTime = lastBeatAt - cycleMs * 0.25;
    }
    swayRef.current = { keys, bpm: beat.bpm, cycleMs };
  }

  // Otro gesto (una respuesta, un quirk, el tacto) tomó alguno de sus
  // huesos: no se pelea con él; se retoma cuando termine.
  function swayIsIntact(): boolean {
    const sway = swayRef.current;
    if (!sway) return false;
    return sway.keys.every((key) => {
      const t = boneTransitionsRef.current[key];
      return t && t.animated && t.duration === sway.cycleMs;
    });
  }

  function othersBusy(keys: string[], now: number): boolean {
    return keys.some((key) => {
      const t = boneTransitionsRef.current[key];
      return t && (t.animated || now < t.startTime + t.duration);
    });
  }

  // Se llama en cada cuadro; casi siempre no hace nada.
  function update(now: number) {
    const beat = beatRef.current;
    const fresh = beat && now - beat.at < STALE_AFTER_MS;

    // Mientras habla, su propia voz ensucia lo que escucha: no se decide nada.
    if (!isSpeakingRef.current) {
      const strong = !!fresh && beat!.confidence >= CONFIDENCE_ON && beat!.level >= LEVEL_MIN;
      const weak = !fresh || beat!.confidence < CONFIDENCE_OFF || beat!.level < LEVEL_MIN;
      if (!musicOnRef.current) {
        aboveSinceRef.current = strong ? (aboveSinceRef.current ?? now) : null;
        if (aboveSinceRef.current !== null && now - aboveSinceRef.current >= ON_AFTER_MS) {
          musicOnRef.current = true;
          belowSinceRef.current = null;
          console.log(`[Música] Suena música (~${Math.round(beat!.bpm)} BPM).`);
        }
      } else {
        belowSinceRef.current = weak ? (belowSinceRef.current ?? now) : null;
        if (belowSinceRef.current !== null && now - belowSinceRef.current >= OFF_AFTER_MS) {
          musicOnRef.current = false;
          aboveSinceRef.current = null;
          console.log("[Música] Paró la música.");
          stopSway();
        }
      }
    }

    if (!musicOnRef.current || !fresh) return;
    if (asleepRef.current || isGameModeActive()) {
      stopSway();
      return;
    }
    const design = getMusicDesign();
    if (!design) {
      requestDesign(beat!.bpm);
      return;
    }
    if (design.choice !== "bailo") return;

    if (now - lastResyncRef.current < RESYNC_EVERY_MS && swayRef.current) return;
    lastResyncRef.current = now;
    // La cara, mientras suene (se renueva en cada revisión).
    if (design.expression) showExpressionFor(design.expression, RESYNC_EVERY_MS + 1500);

    const sway = swayRef.current;
    if (sway && swayIsIntact()) {
      // Reprograma solo si cambió el tempo; si no, corrige la fase.
      if (Math.abs(beat!.bpm - sway.bpm) / sway.bpm > TEMPO_CHANGE_RATIO) {
        startSway(beat!, now);
      } else {
        // Solo si se corrió de verdad (más de un 15 % de golpe): la
        // estimación tiembla unos milisegundos y cada corrección es un salto.
        const beatMs = 60000 / sway.bpm;
        const transition = boneTransitionsRef.current[sway.keys[0]];
        if (transition) {
          const ourBeatAt = transition.startTime + sway.cycleMs * 0.25;
          const ourMsSinceBeat = (((now - ourBeatAt) % beatMs) + beatMs) % beatMs;
          let error = ourMsSinceBeat - beat!.lastBeatMsAgo;
          error = ((error + beatMs * 1.5) % beatMs) - beatMs / 2;
          if (Math.abs(error) > beatMs * 0.15) {
            for (const key of sway.keys) {
              const t = boneTransitionsRef.current[key];
              if (t) t.startTime += error;
            }
          }
        }
      }
      return;
    }
    const keys = design.entries.map((e) => `${e.bone}.${e.axis}`);
    if (othersBusy(keys, now)) return;
    startSway(beat!, now);
  }

  return { update, musicOnRef };
}
