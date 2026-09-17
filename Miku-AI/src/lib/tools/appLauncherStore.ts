// Tarea 6.2: las tools viven en módulos planos (no componentes de React),
// pero necesitan leer el estado de aplicaciones descubiertas/config que
// mantiene useAppLauncher. Este módulo es el punto de contacto: el hook
// escribe acá cada vez que cambia algo, las tools solo leen.
export type AppLauncherToolState = {
  // Ya filtradas: solo las que no están ocultas.
  apps: { name: string; path: string; processName?: string | null }[];
  // Nombre de carpeta -> nombres de apps que contiene.
  folders: Record<string, string[]>;
  actionsDisabled: boolean;
};

let state: AppLauncherToolState = {
  apps: [],
  folders: {},
  actionsDisabled: false,
};

export function setAppLauncherState(next: AppLauncherToolState) {
  state = next;
}

export function getAppLauncherState(): AppLauncherToolState {
  return state;
}

export function findAppByName(name: string) {
  const normalized = name.trim().toLowerCase();
  return state.apps.find((app) => app.name.toLowerCase() === normalized);
}

