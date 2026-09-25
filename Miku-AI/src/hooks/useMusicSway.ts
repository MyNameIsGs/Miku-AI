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
// sintético 0,89-0,95, una pista de prueba por el loopback 0,81-0,86, voz
// 0,35, ruido 0,21. Arranca con pulso claro; una vez sonando, sigue
// mientras haya sonido (en vivo, una canción real bajaba del umbral en
// sus partes suaves y se cortaba sola -- reporte de Sebastián). Se apaga
// con silencio real sostenido (más que la pausa entre canciones) o si pasa
// mucho rato sin ningún pulso (ya no es música: un video hablado).
const CONFIDENCE_ON = 0.5;
const ON_AFTER_MS = 4000;
const SILENCE_OFF_AFTER_MS = 5000;
const NO_PULSE_CONFIDENCE = 0.3;
const NO_PULSE_OFF_AFTER_MS = 20000;
// Solo con lecturas así de claras se toman el tempo y la fase; en una
// parte dudosa se sigue con el último compás bueno.
const CONFIDENCE_TRUST = 0.45;
// Resumen en la terminal cada tanto mientras suena (para calibrar).
const SUMMARY_EVERY_MS = 15000;
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
  const silentSinceRef = useRef<number | null>(null);
  const noPulseSinceRef = useRef<number | null>(null);
  // El último compás confiable: bpm y cuándo cayó su último golpe.
  const trustedRef = useRef<{ bpm: number; lastBeatAt: number } | null>(null);
  const summaryRef = useRef({ since: 0, n: 0, conf: 0, level: 0, trusted: 0 });
  const lastSummaryAtRef = useRef(0);
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

  function log(msg: string) {
    console.log(msg);
    invoke("log_to_terminal", { msg }).catch(() => {});
  }

  // Mismo tempo, o el doble / la mitad (un error típico de estimación en
  // canciones reales): el vaivén no cambia a la vista, no se reprograma.
  function sameTempo(a: number, b: number) {
    return [1, 2, 0.5].some((k) => Math.abs(a - b * k) / (b * k) <= TEMPO_CHANGE_RATIO);
  }

  function setMusicOff(reason: string) {
    musicOnRef.current = false;
    aboveSinceRef.current = null;
    trustedRef.current = null;
    log(`[Música] Paró la música (${reason}).`);
    stopSway();
  }

  // Se llama en cada cuadro; casi siempre no hace nada.
  function update(now: number) {
    const beat = beatRef.current;
    const fresh = !!beat && now - beat.at < STALE_AFTER_MS;

    // Una lectura nueva (~4 por segundo): estado de la música y compás.
    // Mientras habla, su propia voz ensucia lo que escucha: no se decide nada.
    if (fresh && beat && !isSpeakingRef.current && beat.at !== summaryRef.current.since) {
      summaryRef.current.since = beat.at;
      const sound = beat.level >= LEVEL_MIN;
      if (beat.confidence >= CONFIDENCE_TRUST && sound) {
        trustedRef.current = { bpm: beat.bpm, lastBeatAt: beat.at - beat.lastBeatMsAgo };
      }
      if (!musicOnRef.current) {
        const strong = beat.confidence >= CONFIDENCE_ON && sound;
        aboveSinceRef.current = strong ? (aboveSinceRef.current ?? now) : null;
        if (aboveSinceRef.current !== null && now - aboveSinceRef.current >= ON_AFTER_MS) {
          musicOnRef.current = true;
          silentSinceRef.current = null;
          noPulseSinceRef.current = null;
          summaryRef.current = { since: beat.at, n: 0, conf: 0, level: 0, trusted: 0 };
          lastSummaryAtRef.current = now;
          log(`[Música] Suena música (~${Math.round(beat.bpm)} BPM, confianza ${beat.confidence.toFixed(2)}).`);
        }
      } else {
        silentSinceRef.current = sound ? null : (silentSinceRef.current ?? now);
        noPulseSinceRef.current = beat.confidence < NO_PULSE_CONFIDENCE ? (noPulseSinceRef.current ?? now) : null;
        const sum = summaryRef.current;
        sum.n++;
        sum.conf += beat.confidence;
        sum.level += beat.level;
        if (beat.confidence >= CONFIDENCE_TRUST) sum.trusted++;
        if (silentSinceRef.current !== null && now - silentSinceRef.current >= SILENCE_OFF_AFTER_MS) {
          setMusicOff("silencio");
          return;
        }
        if (noPulseSinceRef.current !== null && now - noPulseSinceRef.current >= NO_PULSE_OFF_AFTER_MS) {
          setMusicOff(`sin pulso ${NO_PULSE_OFF_AFTER_MS / 1000} s`);
          return;
        }
        if (now - lastSummaryAtRef.current >= SUMMARY_EVERY_MS && sum.n > 0) {
          log(
            `[Música] Sigue: confianza media ${(sum.conf / sum.n).toFixed(2)}, nivel ${(sum.level / sum.n).toFixed(3)}, ` +
              `${Math.round((sum.trusted / sum.n) * 100)} % de lecturas confiables, compás ${trustedRef.current ? `${Math.round(trustedRef.current.bpm)} BPM` : "ninguno"}` +
              `${swayRef.current ? `, moviéndose (${Math.round(swayRef.current.bpm)} BPM)` : ", sin moverse"}.`,
          );
          lastSummaryAtRef.current = now;
          summaryRef.current = { since: beat.at, n: 0, conf: 0, level: 0, trusted: 0 };
        }
      }
    }
    // Rust dejó de mandar (no debería): se da por terminada.
    if (musicOnRef.current && !fresh) {
      setMusicOff("sin lecturas del audio");
      return;
    }

    if (!musicOnRef.current) return;
    if (asleepRef.current || isGameModeActive()) {
      stopSway();
      return;
    }
    const design = getMusicDesign();
    const trusted = trustedRef.current;
    if (!design) {
      if (trusted) requestDesign(trusted.bpm);
      return;
    }
    if (design.choice !== "bailo" || !trusted) return;

    if (now - lastResyncRef.current < RESYNC_EVERY_MS && swayRef.current) return;
    lastResyncRef.current = now;
    // La cara, mientras suene (se renueva en cada revisión).
    if (design.expression) showExpressionFor(design.expression, RESYNC_EVERY_MS + 1500);

    const current = { bpm: trusted.bpm, lastBeatMsAgo: now - trusted.lastBeatAt, confidence: 1, level: 1 };
    const sway = swayRef.current;
    if (sway && swayIsIntact()) {
      if (!sameTempo(trusted.bpm, sway.bpm)) {
        log(`[Música] Cambió el tempo: ${Math.round(sway.bpm)} -> ${Math.round(trusted.bpm)} BPM.`);
        startSway(current, now);
        return;
      }
      // Corrige la fase solo si se corrió de verdad (más de un 15 % de
      // golpe): la estimación tiembla unos milisegundos y cada corrección
      // es un salto.
      const beatMs = 60000 / sway.bpm;
      const transition = boneTransitionsRef.current[sway.keys[0]];
      if (transition) {
        const ourBeatAt = transition.startTime + sway.cycleMs * 0.25;
        const ourMsSinceBeat = (((now - ourBeatAt) % beatMs) + beatMs) % beatMs;
        const theirMsSinceBeat = ((current.lastBeatMsAgo % beatMs) + beatMs) % beatMs;
        let error = ourMsSinceBeat - theirMsSinceBeat;
        error = ((error + beatMs * 1.5) % beatMs) - beatMs / 2;
        if (Math.abs(error) > beatMs * 0.15) {
          for (const key of sway.keys) {
            const t = boneTransitionsRef.current[key];
            if (t) t.startTime += error;
          }
        }
      }
      return;
    }
    const keys = design.entries.map((e) => `${e.bone}.${e.axis}`);
    if (othersBusy(keys, now)) return;
    if (sway) log("[Música] Retoma el vaivén (otro gesto había usado esos huesos).");
    else log(`[Música] Empieza a moverse al compás (${Math.round(trusted.bpm)} BPM).`);
    startSway(current, now);
  }

  return { update, musicOnRef };
}
