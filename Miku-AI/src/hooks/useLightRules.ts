import { RefObject, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { isStreamModeActive } from "../lib/streamMode";
import { gameNameFrom } from "../lib/gameSessions";
import { loadLightsState, saveLightsState, sendGlobal } from "../lib/lights";
import { RuleContext, applyProfile, evaluateRules, favoriteSlots, loadProfiles } from "../lib/lightProfiles";

type UseLightRulesParams = {
  // Miku dormida (ver useSleep.ts).
  asleepRef: RefObject<boolean>;
};

// Cada cuánto se vuelven a mirar las reglas aunque no haya pasado nada
// (horario, ausencia). Escondida, WebView2 frena los temporizadores: ahí
// también se mira con el latido que manda game_mode.rs cada ~5 s.
const CHECK_EVERY_MS = 15_000;
// Música: suena si llegó una estimación con volumen hace menos de esto.
const MUSIC_FRESH_MS = 6_000;
const MUSIC_MIN_LEVEL = 0.02;

type GameState = { active: boolean; title: string; processName: string };
type MusicBeat = { level: number };

// Fase 5 de docs/luces-argb/PLAN.md: las reglas automáticas de las luces
// (ver lib/lightProfiles.ts), los atajos Ctrl+Alt+1…9 para los perfiles
// favoritos y los ítems de luces de la bandeja.
export function useLightRules({ asleepRef }: UseLightRulesParams) {
  useEffect(() => {
    let game: string | null = null;
    let lastMusicAt = 0;
    let musicOn = false;
    let awayMinutes = 0;

    const evaluate = () => {
      const ctx: RuleContext = {
        game,
        stream: isStreamModeActive(),
        sleeping: Boolean(asleepRef.current),
        music: Date.now() - lastMusicAt < MUSIC_FRESH_MS,
        awayMinutes,
        now: new Date(),
      };
      evaluateRules(ctx).catch((err) => console.error("[Luces] Reglas:", err));
    };

    const refreshAway = () =>
      invoke<number>("segundos_sin_usar_pc")
        .then((s) => {
          awayMinutes = s / 60;
        })
        .catch(() => {});

    const tick = () => refreshAway().then(evaluate);

    const unlisteners = [
      listen<GameState>("game-mode", (event) => {
        const { active, processName, title } = event.payload;
        game = active ? gameNameFrom(processName, title) : null;
        evaluate();
      }),
      listen<MusicBeat>("musica", (event) => {
        if (event.payload.level >= MUSIC_MIN_LEVEL) lastMusicAt = Date.now();
        // Solo cuando empieza o termina: no a cada estimación.
        const now = Date.now() - lastMusicAt < MUSIC_FRESH_MS;
        if (now !== musicOn) {
          musicOn = now;
          evaluate();
        }
      }),
      listen("game-mode-heartbeat", () => tick()),
      // Bandeja: prender/apagar y el siguiente favorito.
      listen("tray-lights-toggle", async () => {
        const state = await loadLightsState();
        const global = { ...state.global, on: !state.global.on };
        await sendGlobal(global);
        await saveLightsState({ ...state, global });
      }),
      listen("tray-lights-next", async () => {
        const { profiles, activeProfileId } = await loadProfiles();
        const slots = favoriteSlots(profiles);
        if (slots.length === 0) return;
        const i = slots.findIndex((p) => p.id === activeProfileId);
        await applyProfile(slots[(i + 1) % slots.length]);
      }),
    ];

    tick();
    const id = window.setInterval(tick, CHECK_EVERY_MS);

    // Ctrl+Alt+1…9: el favorito de ese lugar.
    const keys = Array.from({ length: 9 }, (_, i) => `CommandOrControl+Alt+${i + 1}`);
    keys.forEach((key, i) => {
      register(key, async (event) => {
        if (event.state !== "Pressed") return;
        const slot = favoriteSlots((await loadProfiles()).profiles)[i];
        if (slot) await applyProfile(slot);
      }).catch((err) => console.error(`[Luces] No se pudo registrar ${key}:`, err));
    });

    return () => {
      clearInterval(id);
      unlisteners.forEach((p) => p.then((u) => u()));
      keys.forEach((key) => unregister(key).catch(() => {}));
    };
  }, []);
}
