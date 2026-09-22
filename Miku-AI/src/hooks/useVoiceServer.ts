import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { REPO_ROOT } from "../config/constants";

type DownloadProgress = {
  downloaded: number;
  total: number;
};

export function useVoiceServer() {
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const hasLaunched = useRef(false);
  // Tarea 8.9: punto de enganche para que otro hook (useDiary) corra algo
  // ANTES de sync_memory_to_github al cerrar la app -- indirección por ref
  // (no un parámetro del hook) porque useVoiceServer() se llama muy
  // temprano en App.tsx, antes de que exista lo que useDiary necesita
  // (conversationHistoryRef). registerBeforeSync se llama más abajo, desde
  // un useEffect, una vez que todo lo demás ya está armado.
  const beforeSyncRef = useRef<(() => Promise<void>) | null>(null);
  const registerBeforeSync = useCallback((fn: () => Promise<void>) => {
    beforeSyncRef.current = fn;
  }, []);

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
        setDownloadProgress(null);
        if (checkTimer !== null) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
      }
    };

    const unlistenPromise = listen<DownloadProgress>(
      "voice-server-download-progress",
      (event) => setDownloadProgress(event.payload),
    );

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
        // El servidor aún está iniciando (o descargándose) y cargando el modelo RVC
      }
    }, 1000);

    return () => {
      if (checkTimer !== null) clearInterval(checkTimer);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (beforeSyncRef.current) {
        await beforeSyncRef.current().catch(() => {});
      }
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
    downloadProgress,
    shutdownVoiceServer,
    handleCloseApp,
    registerBeforeSync,
  };
}
