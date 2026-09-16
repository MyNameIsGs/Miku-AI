import { useEffect, useRef, useState, useCallback } from "react";
import { Command, Child } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useVoiceServer() {
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const voiceServerChildRef = useRef<Child | null>(null);
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
    if (voiceServerChildRef.current) {
      await voiceServerChildRef.current.kill().catch(() => {});
    }
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

    const command = Command.sidecar("binaries/miku-voice-server", [], {
      env: {
        SystemRoot: "C:\\Windows",
        SYSTEMROOT: "C:\\Windows",
        PATH: "C:\\Windows\\System32;C:\\Windows;C:\\ffmpeg\\bin",
        PYTHONUNBUFFERED: "1",
      },
    });

    command.stdout.on("data", (line) => {
      invoke("log_to_terminal", { msg: `[voice-server] ${line}` });
      if (line.includes("Servidor listo") || line.includes("127.0.0.1:8899")) {
        markVoiceReady();
      }
    });
    command.stderr.on("data", (line) =>
      invoke("log_to_terminal", { msg: `[voice-server][err] ${line}` }),
    );

    command
      .spawn()
      .then((child) => {
        console.log("Servidor iniciado con PID:", child.pid);
        voiceServerChildRef.current = child;

        checkTimer = window.setInterval(async () => {
          if (isReady) return;
          try {
            const res = await fetch("http://127.0.0.1:8899/speak", {
              method: "OPTIONS",
            });
            if (res.ok || res.status > 0) {
              markVoiceReady();
            }
          } catch {
            // El servidor aún está iniciando y cargando el modelo RVC
          }
        }, 1000);
      })
      .catch((err) => {
        console.error("Fallo crítico al iniciar el sidecar de voz:", err);
      });

    return () => {
      if (checkTimer !== null) {
        clearInterval(checkTimer);
      }
      voiceServerChildRef.current?.kill().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await shutdownVoiceServer();
      await appWindow.destroy();
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [shutdownVoiceServer]);

  return {
    isVoiceReady,
    voiceServerChildRef,
    shutdownVoiceServer,
    handleCloseApp,
  };
}
