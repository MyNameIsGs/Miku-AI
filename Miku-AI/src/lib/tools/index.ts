import { obtenerHoraActual } from "./obtenerHoraActual";
import { abrirUrl } from "./abrirUrl";
import { buscarEnWeb } from "./buscarEnWeb";
import { controlMedios } from "./controlMedios";
import { ajustarVolumen } from "./ajustarVolumen";
import { buildAbrirAplicacionTool } from "./abrirAplicacion";
import { buildAbrirCarpetaDeAppsTool } from "./abrirCarpetaDeApps";
import { buildCambiarSalidaAudioTool } from "./cambiarSalidaAudio";
import { ToolDefinition, ToolSchema } from "./types";

// Tools estáticas: no dependen de nada que cambie en runtime, su schema se
// arma una sola vez.
const STATIC_TOOLS: ToolDefinition[] = [
  obtenerHoraActual,
  abrirUrl,
  buscarEnWeb,
  controlMedios,
  ajustarVolumen,
];

// Tools dinámicas (Tarea 6.2 en adelante): su schema depende de estado que
// cambia en runtime (lista de apps descubiertas, carpetas creadas por
// Sebastián), así que se reconstruyen en cada request -- ver
// lib/openrouter.ts, que llama a getToolSchemas() en cada vuelta del ciclo.
const DYNAMIC_TOOL_BUILDERS: (() => ToolDefinition)[] = [
  buildAbrirAplicacionTool,
  buildAbrirCarpetaDeAppsTool,
  buildCambiarSalidaAudioTool,
];

function getAllTools(): ToolDefinition[] {
  return [...STATIC_TOOLS, ...DYNAMIC_TOOL_BUILDERS.map((build) => build())];
}

export function getToolSchemas(): ToolSchema[] {
  return getAllTools().map((tool) => tool.schema);
}

export async function executeTool(
  name: string,
  argumentsJson: string,
): Promise<string> {
  const tool = getAllTools().find((t) => t.schema.function.name === name);
  if (!tool) {
    return `Error: no existe una herramienta llamada "${name}".`;
  }

  let args: Record<string, unknown> = {};
  if (argumentsJson) {
    try {
      args = JSON.parse(argumentsJson);
    } catch {
      return `Error: los argumentos recibidos para "${name}" no son JSON válido.`;
    }
  }

  try {
    return await tool.execute(args);
  } catch (err) {
    return `Error ejecutando "${name}": ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
