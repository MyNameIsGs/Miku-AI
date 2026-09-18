import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";

const ACCIONES = ["subir", "bajar", "establecer", "silenciar", "desilenciar"] as const;

// Tarea 6.4: volumen absoluto vía Core Audio (IAudioEndpointVolume, ver
// media_control.rs) -- permite "ponlo al 30%", no solo subir/bajar a
// ciegas como con las teclas multimedia.
export const ajustarVolumen: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "ajustar_volumen",
      description:
        "Sube, baja, silencia, reactiva o fija el volumen general del sistema de Sebastián.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "'establecer' fija el volumen exacto que venga en 'nivel'. 'subir'/'bajar' lo mueven esa cantidad de puntos porcentuales (10 por defecto si no se especifica 'nivel'). 'silenciar'/'desilenciar' no usan 'nivel'.",
          },
          nivel: {
            type: "number",
            description:
              "Porcentaje 0-100. Para 'establecer', el volumen final. Para 'subir'/'bajar', cuánto moverlo. Se ignora en silenciar/desilenciar.",
          },
        },
        required: ["accion"],
      },
    },
  },
  execute: async (args) => {
    const accion = String(args.accion ?? "");
    if (!ACCIONES.includes(accion as (typeof ACCIONES)[number])) {
      return `Error: acción de volumen desconocida "${accion}".`;
    }
    const nivel =
      typeof args.nivel === "number" && !Number.isNaN(args.nivel)
        ? args.nivel
        : undefined;

    try {
      if (accion === "silenciar") {
        await invoke("ajustar_volumen", { accion, nivel: null });
        return "Sonido silenciado.";
      }
      if (accion === "desilenciar") {
        await invoke("ajustar_volumen", { accion, nivel: null });
        return "Sonido reactivado.";
      }

      const finalLevel = await invoke<number>("ajustar_volumen", {
        accion,
        nivel: nivel ?? null,
      });
      return `Volumen ahora en ${finalLevel}%.`;
    } catch (err) {
      return `Error al ajustar el volumen: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
