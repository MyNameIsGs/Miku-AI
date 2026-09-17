import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { getAppLauncherState, findAppByName } from "./appLauncherStore";

// Tarea 6.2: las carpetas las define Sebastián en el panel de UI (agrupan
// varias apps bajo un nombre, ej. "setup de streaming"). Igual que con
// abrir_aplicacion, la lista de carpetas va en la description para que el
// LLM la empareje solo.
export function buildAbrirCarpetaDeAppsTool(): ToolDefinition {
  const { folders } = getAppLauncherState();
  const folderNames = Object.keys(folders);

  return {
    schema: {
      type: "function",
      function: {
        name: "abrir_carpeta_de_apps",
        description:
          folderNames.length > 0
            ? `Abre de una vez todas las aplicaciones de una carpeta que Sebastián armó. Carpetas disponibles ahora mismo: ${folderNames.join(", ")}. Elige la más parecida a lo que pide. Si ninguna se parece, no la llames.`
            : "Abre de una vez todas las aplicaciones de una carpeta que Sebastián armó. Ahora mismo no hay ninguna carpeta creada -- no llames a esta herramienta.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description:
                "Nombre exacto de la carpeta, tal como aparece en la lista de disponibles.",
            },
          },
          required: ["nombre"],
        },
      },
    },
    execute: async (args) => {
      const { actionsDisabled, folders } = getAppLauncherState();
      if (actionsDisabled) {
        return "Las acciones del escritorio están desactivadas en este momento (interruptor global apagado).";
      }

      const nombre = String(args.nombre ?? "").trim();
      const folderKey = Object.keys(folders).find(
        (key) => key.toLowerCase() === nombre.toLowerCase(),
      );
      if (!folderKey) {
        return `No encontré una carpeta llamada "${nombre}".`;
      }

      const appNames = folders[folderKey];
      if (!appNames || appNames.length === 0) {
        return `La carpeta "${folderKey}" no tiene aplicaciones cargadas.`;
      }

      const abiertas: string[] = [];
      const fallidas: string[] = [];
      for (const appName of appNames) {
        const app = findAppByName(appName);
        if (!app) {
          fallidas.push(appName);
          continue;
        }
        try {
          await invoke("launch_app_by_path", {
            path: app.path,
            processName: app.processName ?? null,
          });
          abiertas.push(app.name);
        } catch {
          fallidas.push(appName);
        }
      }

      const resumen = [
        abiertas.length > 0 ? `Abrí de "${folderKey}": ${abiertas.join(", ")}.` : "",
        fallidas.length > 0
          ? `No pude abrir: ${fallidas.join(", ")} (ya no están disponibles).`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      return resumen || `La carpeta "${folderKey}" no tenía nada para abrir.`;
    },
  };
}
