import { RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BoneTransition, ParsedMovement } from "../types";
import { OPENROUTER_MODEL } from "../config/constants";
import { loadMemoryContext } from "../lib/memory";
import { isGameModeActive } from "../lib/gameMode";
import { designWithSelfView } from "../lib/designMoment";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { getNowPlaying } from "../lib/spotify/api";
import {
  Dance,
  describeDances,
  getDances,
  getSongChoice,
  loadMusicStore,
  saveDance,
  saveSongChoice,
} from "../lib/musicStore";
import { buildDanceChoicePrompt, buildDanceDesignPrompt } from "../prompts/musicPrompt";

// Punto 5b del plan: Miku se mueve con la música que suena en la PC. El
// ritmo lo detecta Rust escuchando la salida de audio (ver
// src-tauri/src/music_beat.rs), que manda "musica" ~4 veces por segundo con
// { bpm, confidence, level, lastBeatMsAgo }.
//
// Segunda versión (pedido de Sebastián): elige su baile según la canción.
// Tiene un repertorio que arma ella (ver lib/musicStore.ts); con cada
// canción nueva elige uno, crea uno nuevo para ese tipo de canción o decide
// no moverse. Con Spotify sabe qué canción es (título y artista) y lo que
// eligió queda para esa canción. Un baile va al golpe o a su propio ritmo
// (para canciones sin golpe marcado, como una balada: ahí el detector de
// golpes no encuentra nada, y Spotify dice que igual es música).

type MusicBeat = { bpm: number; confidence: number; level: number; lastBeatMsAgo: number };
type Song = { key: string | null; label: string | null; startedAt: number };

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
// Se elige el baile un poco después de que empieza la canción, cuando ya
// se midió el ritmo.
const CHOOSE_AFTER_MS = 6000;
const CHOOSE_RETRY_AFTER_MS = 2 * 60 * 1000;

type UseMusicSwayParams = {
  scheduleMovement: (parsed: ParsedMovement, origin: "idle", autoRevertDelayMs?: number) => void;
  releaseQuirkRevertsNow: (keys: string[]) => void;
  boneTransitionsRef: RefObject<Record<string, BoneTransition>>;
  showExpressionFor: (expression: string, forMs: number) => void;
  isSpeakingRef: RefObject<boolean>;
  asleepRef: RefObject<boolean>;
  processMemoryMarkers: (reply: string) => Promise<void>;
};

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "_");

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
  // La canción en curso y el baile que eligió (undefined: todavía no
  // eligió; null: con esta no se mueve).
  const songRef = useRef<Song | null>(null);
  const choiceRef = useRef<string | null | undefined>(undefined);
  const choosingRef = useRef(false);
  const chooseRetryAtRef = useRef(0);
  // El vaivén en curso.
  const swayRef = useRef<{ keys: string[]; bpm: number; cycleMs: number; dance: string } | null>(null);
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

  // Lo que se escucha, en palabras (para que ella elija o diseñe).
  function describeMeasured(): string {
    const trusted = trustedRef.current;
    const level = beatRef.current?.level ?? 0;
    const rhythm = trusted
      ? `un golpe claro, de unos ${Math.round(trusted.bpm)} golpes por minuto`
      : "sin un golpe marcado (tempo libre o suave, como una balada)";
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
    choiceRef.current = undefined;
    chooseRetryAtRef.current = 0;
    log(`[Música] ${reason}${s?.label ? `: ${s.label}` : ""}.`);
  }

  function setMusicOff(reason: string) {
    musicOnRef.current = false;
    aboveSinceRef.current = null;
    trustedRef.current = null;
    songRef.current = null;
    choiceRef.current = undefined;
    log(`[Música] Paró la música (${reason}).`);
    stopSway();
  }

  async function ask(messages: object[], kind: "música (elegir)" | "diseñar música") {
    const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind });
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  }

  async function designDance(name: string, forWhat: string, song: Song): Promise<boolean> {
    const { world, personality, memories } = await loadMemoryContext();
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const prompt = buildDanceDesignPrompt({
      world,
      personality,
      memories,
      todayIso,
      name,
      forWhat,
      song: song.label,
      measured: describeMeasured(),
    });
    const result = await designWithSelfView(prompt, "diseñar música");
    if (!result) return false;
    for (const reply of result.replies) await processMemoryMarkers(reply);
    const { design, replies } = result;
    if (!design.movement?.entries.length) {
      log(`[Música] El baile nuevo "${name}" vino sin [MOVIMIENTO]; no se guardó.`);
      return false;
    }
    const alGolpeMatches = replies.flatMap((r) => [...r.matchAll(/\[AL_GOLPE:\s*(s[ií]|no)\]/gi)]);
    const alGolpe = alGolpeMatches.length > 0
      ? !/no/i.test(alGolpeMatches[alGolpeMatches.length - 1][1])
      : !!trustedRef.current;
    await saveDance(name, {
      descripcion: forWhat || "sin descripción",
      alGolpe,
      expression: design.expression,
      entries: design.movement.entries,
      durationMs: design.movement.durationMs,
      createdAt: new Date().toISOString(),
    });
    log(`[Música] Miku creó el baile "${name}" (${alGolpe ? "al golpe" : "a su ritmo"}): ${forWhat}.`);
    return true;
  }

  // Elige el baile para la canción en curso (o crea uno nuevo).
  async function chooseDance(song: Song) {
    choosingRef.current = true;
    try {
      const { world, personality } = await loadMemoryContext();
      const reply = await ask(
        [
          {
            role: "system",
            content: buildDanceChoicePrompt({
              world,
              personality,
              song: song.label,
              measured: describeMeasured(),
              dances: describeDances(),
              remembered: !!song.key,
            }),
          },
        ],
        "música (elegir)",
      );
      let choice: string | null | undefined;
      const picked = reply.match(/\[BAILE:\s*([^\]]+)\]/i)?.[1];
      const created = reply.match(/\[NUEVO_BAILE:\s*([^\]|]+)\|?\s*([^\]]*)\]/i);
      if (/\[NO_BAILO\]/i.test(reply)) {
        choice = null;
      } else if (picked && getDances()[normalizeName(picked)]) {
        choice = normalizeName(picked);
      } else if (created) {
        const name = normalizeName(created[1]);
        if (await designDance(name, created[2].trim(), song)) choice = name;
      }
      if (choice === undefined) {
        log(`[Música] No quedó claro qué baile eligió; se vuelve a preguntar en un rato. Respuesta: ${reply.slice(0, 160)}`);
        chooseRetryAtRef.current = performance.now() + CHOOSE_RETRY_AFTER_MS;
        return;
      }
      // Si mientras tanto cambió la canción, esto ya no corresponde.
      if (songRef.current !== song) return;
      choiceRef.current = choice;
      if (song.key && song.label) await saveSongChoice(song.key, choice, song.label);
      log(`[Música] Con ${song.label ?? "esta canción"}: ${choice ? `baila "${choice}"` : "no se mueve"}.`);
    } catch (err) {
      console.warn("[Música] No se pudo elegir el baile; se reintenta en un rato:", err);
      chooseRetryAtRef.current = performance.now() + CHOOSE_RETRY_AFTER_MS;
    } finally {
      choosingRef.current = false;
    }
  }

  // Programa el vaivén. Al golpe: el extremo del vaivén cae en un golpe
  // (con 2 golpes por vaivén, un extremo en cada golpe). A su ritmo: con la
  // duración que ella eligió.
  function startSway(name: string, dance: Dance) {
    const keys = dance.entries.map((e) => `${e.bone}.${e.axis}`);
    const trusted = trustedRef.current;
    if (dance.alGolpe && trusted) {
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
      swayRef.current = { keys, bpm: trusted.bpm, cycleMs, dance: name };
    } else {
      scheduleMovement({ entries: dance.entries, durationMs: dance.durationMs, animated: true }, "idle", HOLD_WHILE_MUSIC_MS);
      swayRef.current = { keys, bpm: 0, cycleMs: dance.durationMs, dance: name };
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
      if (beat.confidence >= CONFIDENCE_TRUST && sound) {
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
              `${Math.round((sum.trusted / sum.n) * 100)} % de lecturas confiables, compás ${trustedRef.current ? `${Math.round(trustedRef.current.bpm)} BPM` : "ninguno"}` +
              `${sway ? `, bailando "${sway.dance}"${sway.bpm ? ` (${Math.round(sway.bpm)} BPM)` : " (a su ritmo)"}` : ", sin moverse"}.`,
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

    // Qué baile: el que ya eligió para esta canción, o se le pregunta.
    const song = songRef.current;
    if (choiceRef.current === undefined) {
      if (choosingRef.current || now - song.startedAt < CHOOSE_AFTER_MS || now < chooseRetryAtRef.current) return;
      const saved = song.key ? getSongChoice(song.key) : null;
      if (saved && (saved.baile === null || getDances()[saved.baile])) {
        choiceRef.current = saved.baile;
        log(`[Música] ${song.label ?? "Esta canción"}: ${saved.baile ? `baila "${saved.baile}" (lo eligió antes)` : "con esta no se mueve (lo eligió antes)"}.`);
      } else {
        chooseDance(song);
        return;
      }
    }
    const name = choiceRef.current;
    const dance = name ? getDances()[name] : null;
    if (!name || !dance) return;

    if (now - lastResyncRef.current < RESYNC_EVERY_MS && swayRef.current) return;
    lastResyncRef.current = now;
    // La cara, mientras suene (se renueva en cada revisión).
    if (dance.expression) showExpressionFor(dance.expression, RESYNC_EVERY_MS + 1500);

    const sway = swayRef.current;
    const trusted = trustedRef.current;
    if (sway && swayIsIntact()) {
      if (!dance.alGolpe || !trusted) return;
      if (!sway.bpm || !sameTempo(trusted.bpm, sway.bpm)) {
        log(`[Música] Cambió el tempo: ${sway.bpm ? Math.round(sway.bpm) : "a su ritmo"} -> ${Math.round(trusted.bpm)} BPM.`);
        startSway(name, dance);
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
        ? `[Música] Retoma "${name}" (otro gesto había usado esos huesos).`
        : `[Música] Empieza a bailar "${name}" ${dance.alGolpe && trusted ? `al compás (${Math.round(trusted.bpm)} BPM)` : "a su ritmo"}.`,
    );
    startSway(name, dance);
  }

  return { update, musicOnRef };
}
