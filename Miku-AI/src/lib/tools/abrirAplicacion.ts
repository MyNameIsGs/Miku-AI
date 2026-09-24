import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { getAppLauncherState, findAppByName, areDesktopActionsDisabled } from "./appLauncherStore";

// Tarea 6.2: el schema se arma de nuevo en cada request (ver
// lib/tools/index.ts) para que la lista de aplicaciones en la
// `description` esté siempre actualizada -- así el LLM hace el
// emparejamiento por nombre él solo ("abre lo del stream" -> nombre real),
// sin que el código tenga que implementar coincidencia difusa.
export function buildAbrirAplicacionTool(): ToolDefinition {
  const { apps } = getAppLauncherState();
  const appNames = apps.map((app) => app.name).join(", ");

  return {
    schema: {
      type: "function",
      function: {
        name: "abrir_aplicacion",
        description:
          apps.length > 0
            ? `Abre una aplicación instalada en la PC de Sebastián por su nombre. Aplicaciones disponibles ahora mismo: ${appNames}. Elige el nombre de la lista más parecido a lo que pide Sebastián. Si ninguno se parece, no llames a esta herramienta -- dile que no la tienes.`
            : "Abre una aplicación instalada en la PC de Sebastián por su nombre. Ahora mismo no hay ninguna aplicación descubierta -- no llames a esta herramienta, avisa que no encuentras aplicaciones.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description:
                "Nombre exacto de la aplicación, tal como aparece en la lista de disponibles.",
            },
          },
          required: ["nombre"],
        },
      },
    },
    execute: async (args) => {
      if (areDesktopActionsDisabled()) {
        return "Las acciones del escritorio están desactivadas en este momento (interruptor global apagado, o modo stream activo porque OBS está transmitiendo o grabando).";
      }

      const nombre = String(args.nombre ?? "").trim();
      const app = findAppByName(nombre);
      if (!app) {
        return `No encontré una aplicación llamada "${nombre}" entre las disponibles.`;
      }

      try {
        await invoke("launch_app_by_path", {
          path: app.path,
          processName: app.processName ?? null,
        });
        return `Abrí "${app.name}".`;
      } catch (err) {
        return `Error al abrir "${app.name}": ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    },
  };
}
