import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { ChatContentPart } from "../../types";

type ScreenCapture = { label: string; dataUrl: string };

// Tarea 6.6: por defecto captura SOLO el monitor principal -- cada imagen
// de más son varios cientos/miles de tokens de más en la respuesta, y la
// mayoría de las veces alcanza con uno. Miku pide "todos" o un número
// específico solo cuando hace falta (ver la description de más abajo).
function resolveIndices(monitorArg: string): number[] | null {
  const normalized = monitorArg.toLowerCase().trim();
  if (!normalized || normalized === "principal") return [1];
  if (normalized === "todos" || normalized === "all") return null;

  const n = Number.parseInt(normalized, 10);
  return Number.isFinite(n) && n > 0 ? [n] : [1];
}

// Tarea 6.6: los monitores capturados se devuelven como contenido
// multi-parte (texto + image_url por cada uno) en el propio mensaje
// "tool" -- verificado contra la API real que esto funciona: el modelo
// describió correctamente una imagen de prueba mandada así.
export const verPantalla: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "ver_pantalla",
      description:
        "Toma una captura de la pantalla de Sebastián ahora mismo para que puedas comentar qué hay -- un error, un juego, una imagen, algo que no sea una página web. No sirve para leer páginas web completas (para eso está buscar_en_web); esto solo ve lo que está visible en este instante, tal como se ve.",
      parameters: {
        type: "object",
        properties: {
          monitor: {
            type: "string",
            description:
              "Qué monitor mirar: 'principal' (el default si no dices nada), un número como '2' para el segundo monitor si Sebastián lo pide específicamente, o 'todos' si pide ver los dos a la vez. Cada monitor de más cuesta tokens de más -- usa 'todos' solo cuando de verdad haga falta, no por costumbre.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args) => {
    try {
      const monitorArg = String(args.monitor ?? "principal");
      const indices = resolveIndices(monitorArg);

      const captures = await invoke<ScreenCapture[]>("capture_screens", {
        indices,
      });
      if (captures.length === 0) {
        return "No se encontró ningún monitor para capturar.";
      }

      const parts: ChatContentPart[] = [
        {
          type: "text",
          text:
            captures.length > 1
              ? `Capturas de ${captures.length} monitores:`
              : "Captura de la pantalla actual:",
        },
      ];
      for (const capture of captures) {
        parts.push({ type: "text", text: capture.label });
        parts.push({ type: "image_url", image_url: { url: capture.dataUrl } });
      }
      return parts;
    } catch (err) {
      return `Error al capturar la pantalla: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  },
};
