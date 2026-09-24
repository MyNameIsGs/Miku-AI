import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { getAppLauncherState, findAppByName, areDesktopActionsDisabled } from "./appLauncherStore";

// Tarea 8.5: control de ventanas -- minimizar, mover a otro monitor, "modo
// foco" (ver window_control.rs). Mismas tres cosas que abrir_aplicacion:
// tools dinámicas (el schema se arma de nuevo en cada request para que la
// lista de apps en la description esté siempre actualizada), resuelven el
// nombre a un `processName` vía appLauncherStore, y respetan el
// interruptor global de acciones desactivadas (para usar durante streams).
//
// A diferencia de abrir_aplicacion, acá hace falta el processName sí o sí
// -- una app sin proceso resuelto (algunos juegos de Steam) no tiene
// ventana que encontrar por este camino.
function resolveProcessName(nombre: string): { processName: string } | { error: string } {
  const app = findAppByName(nombre);
  if (!app) {
    return { error: `No encontré una aplicación llamada "${nombre}" entre las disponibles.` };
  }
  if (!app.processName) {
    return {
      error: `No pude identificar el proceso de "${app.name}" -- no puedo encontrar su ventana por este camino.`,
    };
  }
  return { processName: app.processName };
}

export function buildMinimizarVentanaTool(): ToolDefinition {
  const { apps } = getAppLauncherState();
  const appNames = apps.map((app) => app.name).join(", ");

  return {
    schema: {
      type: "function",
      function: {
        name: "minimizar_ventana",
        description:
          apps.length > 0
            ? `Minimiza (a la barra de tareas) todas las ventanas abiertas de una aplicación, por nombre. Aplicaciones disponibles ahora mismo: ${appNames}.`
            : "Minimiza todas las ventanas abiertas de una aplicación. Ahora mismo no hay ninguna aplicación descubierta -- no llames a esta herramienta.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description: "Nombre exacto de la aplicación, tal como aparece en la lista de disponibles.",
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
      const resolved = resolveProcessName(nombre);
      if ("error" in resolved) return resolved.error;

      try {
        const count = await invoke<number>("minimizar_ventana", {
          nombreProceso: resolved.processName,
        });
        return `Listo, minimicé ${count} ventana${count === 1 ? "" : "s"} de "${nombre}".`;
      } catch (err) {
        return `Error al minimizar "${nombre}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function buildMoverVentanaTool(): ToolDefinition {
  const { apps } = getAppLauncherState();
  const appNames = apps.map((app) => app.name).join(", ");

  return {
    schema: {
      type: "function",
      function: {
        name: "mover_ventana",
        description:
          apps.length > 0
            ? `Mueve todas las ventanas abiertas de una aplicación a otro monitor, ocupando toda su pantalla. Aplicaciones disponibles ahora mismo: ${appNames}. El número de monitor es el mismo índice que usa ver_pantalla (1 = el monitor principal, 2 = el siguiente, etc.) -- si no sabés cuántos hay, probá 1 o 2, o usa ver_pantalla primero.`
            : "Mueve todas las ventanas abiertas de una aplicación a otro monitor. Ahora mismo no hay ninguna aplicación descubierta -- no llames a esta herramienta.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description: "Nombre exacto de la aplicación, tal como aparece en la lista de disponibles.",
            },
            monitor: {
              type: "number",
              description: "Índice del monitor destino (1 = principal, 2 = el siguiente, etc.).",
            },
          },
          required: ["nombre", "monitor"],
        },
      },
    },
    execute: async (args) => {
      if (areDesktopActionsDisabled()) {
        return "Las acciones del escritorio están desactivadas en este momento (interruptor global apagado, o modo stream activo porque OBS está transmitiendo o grabando).";
      }

      const nombre = String(args.nombre ?? "").trim();
      const monitor = Number(args.monitor);
      if (!Number.isInteger(monitor) || monitor < 1) {
        return "Error: el número de monitor tiene que ser 1, 2, etc.";
      }
      const resolved = resolveProcessName(nombre);
      if ("error" in resolved) return resolved.error;

      try {
        const count = await invoke<number>("mover_ventana", {
          nombreProceso: resolved.processName,
          monitor,
        });
        return `Listo, moví ${count} ventana${count === 1 ? "" : "s"} de "${nombre}" al monitor ${monitor}.`;
      } catch (err) {
        return `Error al mover "${nombre}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

export function buildModoFocoTool(): ToolDefinition {
  const { apps } = getAppLauncherState();
  const appNames = apps.map((app) => app.name).join(", ");

  return {
    schema: {
      type: "function",
      function: {
        name: "modo_foco",
        description:
          apps.length > 0
            ? `Activa un modo foco: minimiza todas las demás ventanas abiertas, dejando visible solo la de la aplicación indicada. Aplicaciones disponibles ahora mismo: ${appNames}.`
            : "Activa un modo foco sobre una aplicación puntual. Ahora mismo no hay ninguna aplicación descubierta -- no llames a esta herramienta.",
        parameters: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description: "Nombre exacto de la aplicación que se queda visible, tal como aparece en la lista de disponibles.",
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
      const resolved = resolveProcessName(nombre);
      if ("error" in resolved) return resolved.error;

      try {
        const count = await invoke<number>("modo_foco", {
          nombreProceso: resolved.processName,
        });
        return `Listo, modo foco en "${nombre}" -- minimicé ${count} otra${count === 1 ? "" : "s"} ventana${count === 1 ? "" : "s"}.`;
      } catch (err) {
        return `Error al activar el modo foco en "${nombre}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
