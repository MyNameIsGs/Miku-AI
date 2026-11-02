import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { setGameModeActive } from "../lib/gameMode";
import { gameNameFrom, recordGameState } from "../lib/gameSessions";

export type GameState = { active: boolean; title: string; processName: string };

// Cómo se ve la ventana: "hiding"/"appearing" son las animaciones (clases
// CSS en .app-container, ver App.css).
export type GameVisual = "shown" | "hiding" | "hidden" | "appearing";

// Después de hablar se espera más antes de volver a esconderse: da tiempo
// a terminar de leer la respuesta en pantalla (con 6 s no alcanzaba, pidió
// Sebastián) y cubre de sobra la ventana de seguimiento de la Tarea 8.1
// (5 s para seguir hablando sin "Hey Miku").
const HIDE_DELAY_AFTER_CONVERSATION_MS = 15000;
// Al entrar a un juego, casi enseguida.
const HIDE_DELAY_ON_GAME_START_MS = 1500;
const HIDE_ANIMATION_MS = 400;
const APPEAR_ANIMATION_MS = 600;

type UseGameModeParams = {
  // Escuchando, pensando o hablando: mientras tanto se queda visible.
  busy: boolean;
  // Latido de game_mode.rs mientras está oculta (cada ~5 s): con la
  // ventana oculta el bucle de dibujo se detiene, y lo que no puede
  // esperar (los recordatorios) se revisa desde acá.
  onHiddenHeartbeat: () => void;
};

// Modo juego (ver game_mode.rs): con un juego a pantalla completa, Miku se
// esconde (y deja libre la GPU) pero sigue funcionando; "Hey Miku" la trae
// con una animación, y cuando termina la charla se vuelve a esconder.
export function useGameMode({ busy, onHiddenHeartbeat }: UseGameModeParams) {
  const [enabled, setEnabledState] = useState(true);
  const [game, setGame] = useState<GameState>({ active: false, title: "", processName: "" });
  const [visual, setVisual] = useState<GameVisual>("shown");
  // Traída a mano (Ctrl+Shift+H o el ícono de la bandeja) en pleno juego:
  // se queda a la vista hasta que la escondan a mano o termine el juego
  // (2026-11-02, pedido de Sebastián: antes el atajo mostraba la ventana
  // pero ella seguía invisible).
  const [pinned, setPinned] = useState(false);
  const lastBusyAtRef = useRef(0);
  const heartbeatRef = useRef(onHiddenHeartbeat);
  heartbeatRef.current = onHiddenHeartbeat;

  // Ajuste guardado (por defecto prendido). Mandarlo a Rust también
  // arranca su hilo de vigilancia.
  useEffect(() => {
    (async () => {
      let saved = true;
      try {
        const store = await load(".settings.dat", { autoSave: false });
        saved = (await store.get<boolean>("gameModeEnabled")) ?? true;
      } catch (err) {
        console.error("Error cargando el ajuste del modo juego:", err);
      }
      setEnabledState(saved);
      invoke("set_game_mode_enabled", { enabled: saved }).catch(console.error);
    })();
  }, []);

  async function setEnabled(next: boolean) {
    setEnabledState(next);
    invoke("set_game_mode_enabled", { enabled: next }).catch(console.error);
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("gameModeEnabled", next);
      await store.save();
    } catch (err) {
      console.error("Error guardando el ajuste del modo juego:", err);
    }
  }

  useEffect(() => {
    const unlisteners = [
      listen<GameState>("game-mode", (event) => {
        setGame(event.payload);
        setGameModeActive(event.payload.active);
        // A qué juega y cuánto (contexto para Miku + pausas en sesiones
        // largas, ver gameSessions.ts).
        const { active, processName, title } = event.payload;
        recordGameState(active, active ? gameNameFrom(processName, title) : null).catch(
          console.error,
        );
        console.log(
          `[Modo juego] ${event.payload.active ? `activo (${event.payload.processName})` : "inactivo"}`,
        );
      }),
      // Rust ya mostró la ventana ("Hey Miku" mientras estaba oculta). Se
      // cuenta como charla reciente: no se vuelve a esconder enseguida si
      // el micrófono tarda un instante en arrancar.
      listen("game-mode-summon", () => {
        lastBusyAtRef.current = performance.now();
        setVisual("appearing");
      }),
      listen("game-mode-heartbeat", () => heartbeatRef.current()),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);

  useEffect(() => {
    if (busy) lastBusyAtRef.current = performance.now();
  }, [busy]);

  // El próximo juego vuelve a esconderla solo.
  useEffect(() => {
    if (!game.active) setPinned(false);
  }, [game.active]);

  // ¿Está escondida (o escondiéndose) por el juego? Ahí el atajo la trae.
  const hiddenByGame = game.active && (visual === "hiding" || visual === "hidden");

  function summon() {
    setPinned(true);
    if (visual === "hidden") {
      // Directo y no esperando al efecto: con la ventana oculta, la página
      // anda frenada.
      invoke("game_mode_show").catch(console.error);
      setVisual("appearing");
    }
  }

  // La escondieron a mano: el modo juego vuelve a mandar.
  function release() {
    setPinned(false);
  }

  useEffect(() => {
    const shouldBeHidden = game.active && !busy && !pinned;

    if (visual === "shown" && shouldBeHidden) {
      const recentlyBusy = performance.now() - lastBusyAtRef.current < HIDE_DELAY_AFTER_CONVERSATION_MS;
      const id = window.setTimeout(
        () => setVisual("hiding"),
        recentlyBusy ? HIDE_DELAY_AFTER_CONVERSATION_MS : HIDE_DELAY_ON_GAME_START_MS,
      );
      return () => clearTimeout(id);
    }

    if (visual === "hiding") {
      if (!shouldBeHidden) {
        setVisual("shown");
        return;
      }
      const id = window.setTimeout(() => {
        invoke("game_mode_hide").catch(console.error);
        setVisual("hidden");
      }, HIDE_ANIMATION_MS);
      return () => clearTimeout(id);
    }

    if (visual === "hidden" && !shouldBeHidden) {
      // Por ejemplo, un recordatorio que empieza a sonar, o el juego que
      // terminó.
      invoke("game_mode_show").catch(console.error);
      setVisual("appearing");
      return;
    }

    if (visual === "appearing") {
      const id = window.setTimeout(() => setVisual("shown"), APPEAR_ANIMATION_MS);
      return () => clearTimeout(id);
    }
  }, [visual, game.active, busy, pinned]);

  return { enabled, setEnabled, game, visual, hiddenByGame, summon, release };
}
