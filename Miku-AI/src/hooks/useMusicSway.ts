import { RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BoneTransition, ParsedMovement } from "../types";
import { loadMemoryContext } from "../lib/memory";
import { isGameModeActive } from "../lib/gameMode";
import { designWithSelfView } from "../lib/designMoment";
import { getNowPlaying } from "../lib/spotify/api";
import {
  CATEGORY_LABELS,
  Dance,
  MusicCategory,
  getCategoryDance,
  loadMusicStore,
  saveCategoryDance,
} from "../lib/musicStore";
import { buildCategoryDancePrompt } from "../prompts/musicPrompt";

// Punto 5b del plan: Miku se mueve con la música que suena en la PC. El
// ritmo lo detecta Rust escuchando la salida de audio (ver
// src-tauri/src/music_beat.rs), que manda "musica" ~4 veces por segundo con
// { bpm, confidence, level, lastBeatMsAgo }.
//
// Un baile por categoría de canción (pedido de Sebastián: elegir canción
// por canción era demasiado). La categoría sale de lo medido, sin
// consultar al modelo: sin golpe marcado, ritmo tranquilo o ritmo movido.
// Ella diseña un baile por categoría la primera vez que suena algo de ese
// tipo (o decide no moverse). Spotify (currently-playing) solo sirve para
// saber que es música aunque no tenga golpe (una balada como "Voilà") y
// para detectar el cambio de canción.

type MusicBeat = { bpm: number; confidence: number; level: number; lastBeatMsAgo: number };
type Song = { key: string | null; label: string | null; startedAt: number };
type Reading = { at: number; trusted: boolean; bpm: number };

// Pulso claro: más de esto, sostenido, es música con ritmo. Medido: bombo
// sintético 0,89-0,95, una pista de prueba por el loopback 0,81-0,86, voz
// 0,35, ruido 0,21. Arranca con pulso claro (o con Spotify reproduciendo y
// sonido); una vez sonando, sigue mientras haya sonido (en vivo, una
// canción real bajaba del umbral en sus partes suaves y se cortaba sola).
// Se apaga con silencio real sostenido (más que la pausa entre canciones)
// o si pasa mucho rato sin pulso y Spotify no está reproduciendo (un video
// hablado).
const CONFIDENCE_ON = 0.5;
const ON_AFTER_MS = 4000;
const ON_AFTER_SPOTIFY_MS = 2000;
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
const BEATS_PER_CYCLE_OPTIONS = [1, 2, 4];
// Spotify: cada cuánto se pregunta qué suena (con sonido / sin sonido), y
// cuánto se espera si falla (no conectado, sin internet).
const SPOTIFY_POLL_SOUND_MS = 5000;
const SPOTIFY_POLL_QUIET_MS = 15000;
const SPOTIFY_BACKOFF_MS = 5 * 60 * 1000;
const SPOTIFY_FRESH_MS = 20000;
// Categoría: se decide a los 8 s de empezar la canción (ya medido el
// ritmo) y se revisa cada 10 s con los últimos 20 s; cambia si sale otra
// dos veces seguidas (una intro suave que después explota).
const CLASSIFY_AFTER_MS = 8000;
const RECLASSIFY_EVERY_MS = 10000;
const CLASSIFY_WINDOW_MS = 20000;
// Menos que esta proporción de lecturas con golpe claro: sin golpe.
const ON_BEAT_SHARE = 0.3;
// Tempo (los menores de 70 se duplican: suelen ser la mitad del real)
// desde el que el ritmo es movido.
const MOVIDO_FROM_BPM = 100;
const DESIGN_RETRY_AFTER_MS = 30 * 60 * 1000;

type UseMusicSwayParams = {
  scheduleMovement: (parsed: ParsedMovement, origin: "idle", autoRevertDelayMs?: number) => void;
  releaseQuirkRevertsNow: (keys: string[]) => void;
  boneTransitionsRef: RefObject<Record<string, BoneTransition>>;
  showExpressionFor: (expression: string, forMs: number) => void;
  isSpeakingRef: RefObject<boolean>;
  asleepRef: RefObject<boolean>;
  processMemoryMarkers: (reply: string) => Promise<void>;
};

// La categoría de un tramo de lecturas.
export function classifyReadings(readings: Reading[]): MusicCategory {
  const onBeat = readings.filter((r) => r.trusted);
  if (readings.length === 0 || onBeat.length / readings.length < ON_BEAT_SHARE) return "sin_golpe";
  const bpms = onBeat.map((r) => r.bpm).sort((a, b) => a - b);
  let bpm = bpms[Math.floor(bpms.length / 2)];
  // Medir la mitad del tempo es un error típico; el doble casi no pasa
  // (el detector prefiere ~115 BPM), y una canción rápida de verdad tiene
  // que seguir siendo movida.
  while (bpm < 70) bpm *= 2;
  return bpm >= MOVIDO_FROM_BPM ? "ritmo_movido" : "ritmo_tranquilo";
}

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
  // Spotify: qué suena según él.
  const spotifyRef = useRef<{ isPlaying: boolean; key: string | null; label: string | null; at: number } | null>(null);
  const spotifyPollAtRef = useRef(0);
  const spotifyInFlightRef = useRef(false);
  const spotifyBackoffUntilRef = useRef(0);
  const lastSoundAtRef = useRef(0);
  // La canción en curso, sus lecturas y su categoría.
  const songRef = useRef<Song | null>(null);
  const readingsRef = useRef<Reading[]>([]);
  const categoryRef = useRef<MusicCategory | null>(null);
  const pendingCategoryRef = useRef<MusicCategory | null>(null);
  const lastClassifyRef = useRef(0);
  const designingRef = useRef(false);
  const designRetryAfterRef = useRef<Partial<Record<MusicCategory, number>>>({});
  // El vaivén en curso.
  const swayRef = useRef<{ keys: string[]; bpm: number; cycleMs: number; category: MusicCategory } | null>(null);
  const lastResyncRef = useRef(0);

  useEffect(() => {
    loadMusicStore();
    invoke("escuchar_musica").catch((err) => console.warn("[Música] No se pudo escuchar el audio de la PC:", err));
    const unlisten = listen<MusicBeat>("musica", (event) => {
      beatRef.current = { ...event.payload, at: performance.now() };
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function log(msg: string) {
    console.log(msg);
    invoke("log_to_terminal", { msg }).catch(() => {});
  }

  function spotifyPlaying(now: number) {
    const s = spotifyRef.current;
    return !!s && s.isPlaying && now - s.at < SPOTIFY_FRESH_MS;
  }

  function pollSpotify(now: number) {
    if (now < spotifyPollAtRef.current || spotifyInFlightRef.current || now < spotifyBackoffUntilRef.current) return;
    const recentSound = now - lastSoundAtRef.current < 3000;
    spotifyPollAtRef.current = now + (recentSound ? SPOTIFY_POLL_SOUND_MS : SPOTIFY_POLL_QUIET_MS);
    spotifyInFlightRef.current = true;
    getNowPlaying()
      .then((np) => {
        spotifyRef.current = {
          isPlaying: np.isPlaying && !!np.track,
          key: np.id ? `spotify:${np.id}` : null,
          label: np.track ? `"${np.track}"${np.artists ? ` de ${np.artists}` : ""}` : null,
          at: performance.now(),
        };
      })
      .catch(() => {
        // Spotify no conectado o sin internet: se sigue solo con el oído.
        spotifyRef.current = null;
        spotifyBackoffUntilRef.current = performance.now() + SPOTIFY_BACKOFF_MS;
      })
      .finally(() => {
        spotifyInFlightRef.current = false;
      });
  }

  // Lo que se escucha, en palabras (para que ella diseñe).
  function describeMeasured(): string {
    const trusted = trustedRef.current;
    const level = beatRef.current?.level ?? 0;
    const rhythm =
      categoryRef.current !== "sin_golpe" && trusted
        ? `un golpe claro, de unos ${Math.round(trusted.bpm)} golpes por minuto`
        : "sin un golpe marcado";
    const volume = level > 0.08 ? "fuerte" : level < 0.02 ? "suave" : "a volumen medio";
    return `${rhythm}; suena ${volume}`;
  }

  function stopSway() {
    const sway = swayRef.current;
    if (!sway) return;
    swayRef.current = null;
    releaseQuirkRevertsNow(sway.keys);
  }

  function newSong(now: number, reason: string) {
    stopSway();
    const s = spotifyPlaying(now) ? spotifyRef.current : null;
    songRef.current = { key: s?.key ?? null, label: s?.label ?? null, startedAt: now };
    readingsRef.current = [];
    categoryRef.current = null;
    pendingCategoryRef.current = null;
    log(`[Música] ${reason}${s?.label ? `: ${s.label}` : ""}.`);
  }

  function setMusicOff(reason: string) {
    musicOnRef.current = false;
    aboveSinceRef.current = null;
    trustedRef.current = null;
    songRef.current = null;
    categoryRef.current = null;
    log(`[Música] Paró la música (${reason}).`);
    stopSway();
  }

  // La primera vez que suena algo de una categoría: ella diseña su baile
  // para ese tipo de canciones (o decide no moverse).
  async function designCategory(category: MusicCategory, song: Song) {
    designingRef.current = true;
    try {
      const { world, personality, memories } = await loadMemoryContext();
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const prompt = buildCategoryDancePrompt({
        world,
        personality,
        memories,
        todayIso,
        categoryLabel: CATEGORY_LABELS[category],
        song: song.label,
        measured: describeMeasured(),
      });
      const result = await designWithSelfView(prompt, "diseñar música");
      if (!result) throw new Error("sin respuesta");
      for (const reply of result.replies) await processMemoryMarkers(reply);
      const { design, replies } = result;
      if (!design.movement && !design.expression && /\[NO_BAILO\]/i.test(replies[0])) {
        await saveCategoryDance(category, "no");
        log(`[Música] Con ${CATEGORY_LABELS[category]}, Miku decidió no moverse.`);
        return;
      }
      if (!design.movement?.entries.length) {
        throw new Error(`respuesta sin [MOVIMIENTO] ni [NO_BAILO]: ${replies[0].slice(0, 160)}`);
      }
      const alGolpeMatches = replies.flatMap((r) => [...r.matchAll(/\[AL_GOLPE:\s*(s[ií]|no)\]/gi)]);
      const alGolpe =
        alGolpeMatches.length > 0
          ? !/no/i.test(alGolpeMatches[alGolpeMatches.length - 1][1])
          : category !== "sin_golpe";
      await saveCategoryDance(category, {
        alGolpe,
        expression: design.expression,
        entries: design.movement.entries,
        durationMs: design.movement.durationMs,
        createdAt: new Date().toISOString(),
      });
      log(`[Música] Miku diseñó su baile para ${category} (${alGolpe ? "al golpe" : "a su ritmo"}).`);
    } catch (err) {
      console.warn(`[Música] No se pudo diseñar el baile para "${category}"; se reintenta más tarde:`, err);
      designRetryAfterRef.current[category] = Date.now() + DESIGN_RETRY_AFTER_MS;
    } finally {
      designingRef.current = false;
    }
  }

  // Programa el vaivén. Al golpe: el extremo del vaivén cae en un golpe
  // (con 2 golpes por vaivén, un extremo en cada golpe). A su ritmo: con la
  // duración que ella eligió.
  function startSway(category: MusicCategory, dance: Dance) {
    const keys = dance.entries.map((e) => `${e.bone}.${e.axis}`);
    const trusted = trustedRef.current;
    if (dance.alGolpe && trusted && category !== "sin_golpe") {
      const beatMs = 60000 / trusted.bpm;
      const beatsPerCycle = BEATS_PER_CYCLE_OPTIONS.reduce((best, option) =>
        Math.abs(option * beatMs - dance.durationMs) < Math.abs(best * beatMs - dance.durationMs) ? option : best,
      );
      const cycleMs = beatsPerCycle * beatMs;
      scheduleMovement({ entries: dance.entries, durationMs: cycleMs, animated: true }, "idle", HOLD_WHILE_MUSIC_MS);
      for (const key of keys) {
        const transition = boneTransitionsRef.current[key];
        if (transition) transition.startTime = trusted.lastBeatAt - cycleMs * 0.25;
      }
      swayRef.current = { keys, bpm: trusted.bpm, cycleMs, category };
    } else {
      scheduleMovement({ entries: dance.entries, durationMs: dance.durationMs, animated: true }, "idle", HOLD_WHILE_MUSIC_MS);
      swayRef.current = { keys, bpm: 0, cycleMs: dance.durationMs, category };
    }
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

  // Mismo tempo, o el doble / la mitad (un error típico de estimación en
  // canciones reales): el vaivén no cambia a la vista, no se reprograma.
  function sameTempo(a: number, b: number) {
    return [1, 2, 0.5].some((k) => Math.abs(a - b * k) / (b * k) <= TEMPO_CHANGE_RATIO);
  }

  // Decide (o revisa) la categoría de la canción en curso.
  function updateCategory(now: number, song: Song) {
    if (now - song.startedAt < CLASSIFY_AFTER_MS || now - lastClassifyRef.current < RECLASSIFY_EVERY_MS) return;
    lastClassifyRef.current = now;
    const recent = readingsRef.current.filter((r) => now - r.at <= CLASSIFY_WINDOW_MS);
    const category = classifyReadings(recent);
    if (categoryRef.current === null) {
      categoryRef.current = category;
      log(`[Música] Tipo de canción: ${category}.`);
      return;
    }
    if (category === categoryRef.current) {
      pendingCategoryRef.current = null;
      return;
    }
    if (pendingCategoryRef.current === category) {
      log(`[Música] La canción cambió de carácter: ${categoryRef.current} -> ${category}.`);
      categoryRef.current = category;
      pendingCategoryRef.current = null;
      stopSway();
    } else {
      pendingCategoryRef.current = category;
    }
  }

  // Se llama en cada cuadro; casi siempre no hace nada.
  function update(now: number) {
    pollSpotify(now);
    const beat = beatRef.current;
    const fresh = !!beat && now - beat.at < STALE_AFTER_MS;
    const onSpotify = spotifyPlaying(now);

    // Una lectura nueva (~4 por segundo): estado de la música y compás.
    // Mientras habla, su propia voz ensucia lo que escucha: no se decide nada.
    if (fresh && beat && !isSpeakingRef.current && beat.at !== summaryRef.current.since) {
      summaryRef.current.since = beat.at;
      const sound = beat.level >= LEVEL_MIN;
      if (sound) lastSoundAtRef.current = now;
      const trustedNow = beat.confidence >= CONFIDENCE_TRUST && sound;
      if (trustedNow) {
        trustedRef.current = { bpm: beat.bpm, lastBeatAt: beat.at - beat.lastBeatMsAgo };
      }
      if (!musicOnRef.current) {
        const strong = (beat.confidence >= CONFIDENCE_ON || onSpotify) && sound;
        aboveSinceRef.current = strong ? (aboveSinceRef.current ?? now) : null;
        const needed = onSpotify ? ON_AFTER_SPOTIFY_MS : ON_AFTER_MS;
        if (aboveSinceRef.current !== null && now - aboveSinceRef.current >= needed) {
          musicOnRef.current = true;
          silentSinceRef.current = null;
          noPulseSinceRef.current = null;
          summaryRef.current = { since: beat.at, n: 0, conf: 0, level: 0, trusted: 0 };
          lastSummaryAtRef.current = now;
          newSong(now, `Suena música (${onSpotify ? "Spotify" : `~${Math.round(beat.bpm)} BPM, confianza ${beat.confidence.toFixed(2)}`})`);
        }
      } else {
        if (sound) {
          readingsRef.current.push({ at: now, trusted: trustedNow, bpm: beat.bpm });
          while (readingsRef.current.length > 0 && now - readingsRef.current[0].at > CLASSIFY_WINDOW_MS) {
            readingsRef.current.shift();
          }
        }
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
        if (!onSpotify && noPulseSinceRef.current !== null && now - noPulseSinceRef.current >= NO_PULSE_OFF_AFTER_MS) {
          setMusicOff(`sin pulso ${NO_PULSE_OFF_AFTER_MS / 1000} s`);
          return;
        }
        if (now - lastSummaryAtRef.current >= SUMMARY_EVERY_MS && sum.n > 0) {
          const sway = swayRef.current;
          log(
            `[Música] Sigue: confianza media ${(sum.conf / sum.n).toFixed(2)}, nivel ${(sum.level / sum.n).toFixed(3)}, ` +
              `${Math.round((sum.trusted / sum.n) * 100)} % de lecturas confiables, tipo ${categoryRef.current ?? "(midiendo)"}` +
              `${sway ? `, bailando${sway.bpm ? ` al compás (${Math.round(sway.bpm)} BPM)` : " a su ritmo"}` : ", sin moverse"}.`,
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
    if (!musicOnRef.current || !songRef.current) return;

    // Cambió la canción en Spotify.
    const s = spotifyRef.current;
    if (onSpotify && s?.key && s.key !== songRef.current.key) {
      trustedRef.current = null;
      newSong(now, "Cambió la canción");
      return;
    }

    if (asleepRef.current || isGameModeActive()) {
      stopSway();
      return;
    }

    updateCategory(now, songRef.current);
    const category = categoryRef.current;
    if (!category) return;
    const dance = getCategoryDance(category);
    if (dance === null) {
      if (!designingRef.current && Date.now() >= (designRetryAfterRef.current[category] ?? 0)) {
        designCategory(category, songRef.current);
      }
      return;
    }
    if (dance === "no") return;

    if (now - lastResyncRef.current < RESYNC_EVERY_MS && swayRef.current) return;
    lastResyncRef.current = now;
    // La cara, mientras suene (se renueva en cada revisión).
    if (dance.expression) showExpressionFor(dance.expression, RESYNC_EVERY_MS + 1500);

    const sway = swayRef.current;
    const trusted = trustedRef.current;
    if (sway && swayIsIntact()) {
      if (!dance.alGolpe || !trusted || category === "sin_golpe") return;
      if (!sway.bpm || !sameTempo(trusted.bpm, sway.bpm)) {
        log(`[Música] Cambió el tempo: ${sway.bpm ? Math.round(sway.bpm) : "a su ritmo"} -> ${Math.round(trusted.bpm)} BPM.`);
        startSway(category, dance);
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
        const theirMsSinceBeat = (((now - trusted.lastBeatAt) % beatMs) + beatMs) % beatMs;
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
    const keys = dance.entries.map((e) => `${e.bone}.${e.axis}`);
    if (othersBusy(keys, now)) return;
    log(
      sway
        ? `[Música] Retoma el baile (otro gesto había usado esos huesos).`
        : `[Música] Empieza a bailar (${category}, ${dance.alGolpe && trusted && category !== "sin_golpe" ? `al compás, ${Math.round(trusted.bpm)} BPM` : "a su ritmo"}).`,
    );
    startSway(category, dance);
  }

  return { update, musicOnRef };
}
