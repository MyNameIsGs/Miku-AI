import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { REPO_ROOT } from "../config/constants";

export function useVoiceServer() {
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const hasLaunched = useRef(false);

  const shutdownVoiceServer = useCallback(async () => {
    try {
      await fetch("http://127.0.0.1:8899/shutdown", { method: "POST" }).catch(
        () => {},
      );
    } catch {}
    try {
      await invoke("kill_voice_server");
    } catch {}
  }, []);

  const handleCloseApp = useCallback(async () => {
    const appWindow = getCurrentWindow();
    await shutdownVoiceServer();
    await appWindow.close();
  }, [shutdownVoiceServer]);

  useEffect(() => {
    if (hasLaunched.current) return;
    hasLaunched.current = true;

    let checkTimer: number | null = null;
    let isReady = false;

    const markVoiceReady = () => {
      if (!isReady) {
        isReady = true;
        setIsVoiceReady(true);
        if (checkTimer !== null) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
      }
    };

    // Lanzar el servidor vía Rust (no via sidecar de Tauri)
    invoke("launch_voice_server").catch((err) => {
      console.error("Fallo crítico al iniciar el servidor de voz:", err);
    });

    // Polling para detectar cuando el servidor está listo
    checkTimer = window.setInterval(async () => {
      if (isReady) return;
      try {
        const res = await fetch("http://127.0.0.1:8899/speak", {
          method: "OPTIONS",
        });
        if (res.ok || res.status > 0) markVoiceReady();
      } catch {
        // El servidor aún está iniciando y cargando el modelo RVC
      }
    }, 1000);

    return () => {
      if (checkTimer !== null) clearInterval(checkTimer);
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await invoke("sync_memory_to_github", { repoRoot: REPO_ROOT }).catch(
        () => {},
      );
      await shutdownVoiceServer();
      await appWindow.destroy();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [shutdownVoiceServer]);

  return {
    isVoiceReady,
    shutdownVoiceServer,
    handleCloseApp,
  };
}
