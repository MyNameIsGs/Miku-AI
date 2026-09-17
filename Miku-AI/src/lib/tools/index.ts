import { obtenerHoraActual } from "./obtenerHoraActual";
import { ToolDefinition } from "./types";

// Lista blanca de herramientas disponibles para el LLM (Tarea 6.1 en
// adelante). Sumar una tool nueva es agregarla acá -- no hace falta tocar
// el systemPrompt, cada schema ya trae su propio nombre y descripción.
const TOOLS: ToolDefinition[] = [obtenerHoraActual];

export const TOOL_SCHEMAS = TOOLS.map((tool) => tool.schema);

const TOOLS_BY_NAME = new Map(
  TOOLS.map((tool) => [tool.schema.function.name, tool]),
);

export async function executeTool(
  name: string,
  argumentsJson: string,
): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
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
