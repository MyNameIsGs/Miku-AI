import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { setAppLauncherState } from "../lib/tools/appLauncherStore";

export type DiscoveredApp = { name: string; path: string };

export type AppLauncherConfig = {
  hiddenApps: string[];
  // Nombre de carpeta -> nombres de apps que contiene.
  folders: Record<string, string[]>;
  // Nombre de app -> URL asociada (queda listo para la Tarea 6.3).
  urls: Record<string, string>;
  // Nombre -> ruta absoluta. Cargadas a mano por Sebastián desde el panel
  // (ej. scripts .bat) -- Miku nunca elige ni escribe una ruta, solo lanza
  // por nombre lo que ya está acá, mismo modelo de confianza que las apps
  // descubiertas automáticamente.
  customApps: Record<string, string>;
  actionsDisabled: boolean;
};

const DEFAULT_CONFIG: AppLauncherConfig = {
  hiddenApps: [],
  folders: {},
  urls: {},
  customApps: {},
  actionsDisabled: false,
};

// Tarea 6.2: escanea las apps instaladas (vía Rust, ver app_launcher.rs) y
// persiste en .settings.dat qué apps están ocultas, qué carpetas armó
// Sebastián, qué apps personalizadas cargó a mano, y el interruptor global
// de acciones -- mismo mecanismo que customHandGestures en useMovement.ts.
export function useAppLauncher() {
  const [discoveredApps, setDiscoveredApps] = useState<DiscoveredApp[]>([]);
  const [config, setConfig] = useState<AppLauncherConfig>(DEFAULT_CONFIG);
  const isConfigLoaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const apps = await invoke<DiscoveredApp[]>("scan_installed_apps");
        setDiscoveredApps(apps);
      } catch (err) {
        console.error("Error escaneando aplicaciones instaladas:", err);
      }
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const saved = await store.get<AppLauncherConfig>("appLauncherConfig");
        if (saved) setConfig({ ...DEFAULT_CONFIG, ...saved });
      } catch (err) {
        console.error("Error cargando configuración de aplicaciones:", err);
      } finally {
        isConfigLoaded.current = true;
      }
    })();
  }, []);

  const customApps: DiscoveredApp[] = Object.entries(config.customApps).map(
    ([name, path]) => ({ name, path }),
  );

  // Cada vez que cambian las apps descubiertas o la config, actualiza el
  // store plano que leen las tools (no son componentes de React, no pueden
  // leer este estado directamente).
  useEffect(() => {
    const combined = [...discoveredApps, ...customApps];
    const visibleApps = combined.filter(
      (app) =>
        !config.hiddenApps.some(
          (hidden) => hidden.toLowerCase() === app.name.toLowerCase(),
        ),
    );
    setAppLauncherState({
      apps: visibleApps,
      folders: config.folders,
      actionsDisabled: config.actionsDisabled,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveredApps, config]);

  async function persistConfig(next: AppLauncherConfig) {
    setConfig(next);
    if (!isConfigLoaded.current) return;
    try {
      const store = await load(".settings.dat", { autoSave: false });
      await store.set("appLauncherConfig", next);
      await store.save();
    } catch (err) {
      console.error("Error guardando configuración de aplicaciones:", err);
    }
  }

  function toggleAppHidden(name: string) {
    const isHidden = config.hiddenApps.some(
      (h) => h.toLowerCase() === name.toLowerCase(),
    );
    const hiddenApps = isHidden
      ? config.hiddenApps.filter((h) => h.toLowerCase() !== name.toLowerCase())
      : [...config.hiddenApps, name];
    persistConfig({ ...config, hiddenApps });
  }

  function setFolderApps(folderName: string, appNames: string[]) {
    persistConfig({
      ...config,
      folders: { ...config.folders, [folderName]: appNames },
    });
  }

  function renameFolder(oldName: string, newName: string) {
    if (!newName.trim() || oldName === newName) return;
    const folders = { ...config.folders };
    const apps = folders[oldName] ?? [];
    delete folders[oldName];
    folders[newName] = apps;
    persistConfig({ ...config, folders });
  }

  function deleteFolder(folderName: string) {
    const folders = { ...config.folders };
    delete folders[folderName];
    persistConfig({ ...config, folders });
  }

  function setAppUrl(appName: string, url: string) {
    const urls = { ...config.urls };
    if (url.trim()) {
      urls[appName] = url.trim();
    } else {
      delete urls[appName];
    }
    persistConfig({ ...config, urls });
  }

  function addCustomApp(name: string, path: string) {
    const trimmedName = name.trim();
    if (!trimmedName || !path.trim()) return;
    persistConfig({
      ...config,
      customApps: { ...config.customApps, [trimmedName]: path.trim() },
    });
  }

  function removeCustomApp(name: string) {
    const customApps = { ...config.customApps };
    delete customApps[name];
    persistConfig({ ...config, customApps });
  }

  function setActionsDisabled(disabled: boolean) {
    persistConfig({ ...config, actionsDisabled: disabled });
  }

  return {
    discoveredApps,
    customApps,
    config,
    toggleAppHidden,
    setFolderApps,
    renameFolder,
    deleteFolder,
    setAppUrl,
    addCustomApp,
    removeCustomApp,
    setActionsDisabled,
  };
}
