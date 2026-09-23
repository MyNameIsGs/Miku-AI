import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { getMcpState } from "../mcp";

// Tarea 8.2: cada tool de un servidor MCP conectado se expone al LLM con
// un nombre prefijado (mcp_<servidor>_<tool>) -- deja claro de dónde viene
// (código de terceros, no propio) y evita choques de nombre con las tools
// existentes. Al ejecutar, se le saca el prefijo y se despacha por
// mcp_call_tool contra el servidor correspondiente (ver mcp_client.rs) --
// nunca se escribió código de integración específico para este servidor
// en particular, es justamente el punto de conectar por MCP.
//
// Dinámicas (como abrir_aplicacion): el schema se arma de nuevo en cada
// request, según qué servidores estén conectados en ese momento -- ver
// DYNAMIC_TOOL_LIST_BUILDERS en lib/tools/index.ts.
export function buildMcpTools(): ToolDefinition[] {
  const { connectedServers } = getMcpState();
  const tools: ToolDefinition[] = [];

  for (const [serverId, serverTools] of Object.entries(connectedServers)) {
    for (const tool of serverTools) {
      const prefixedName = `mcp_${serverId}_${tool.name}`;
      const schema = tool.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };

      tools.push({
        schema: {
          type: "function",
          function: {
            name: prefixedName,
            description: `[Servidor MCP: ${serverId}] ${tool.description}`,
            parameters: {
              type: "object",
              properties: schema.properties ?? {},
              required: schema.required ?? [],
            },
          },
        },
        // Tarea 6.5, mismo criterio previsto en el plan de la 8.2: es
        // código de terceros (el servidor MCP decide qué hace de verdad
        // con los argumentos), así que pasa por confirmación humana igual
        // que cualquier acción sensible -- a diferencia de las tools
        // propias, donde el código en sí ya es conocido y auditado.
        requiresConfirmation: true,
        describeForConfirmation: (args) =>
          `Ejecutar "${tool.name}" del servidor MCP "${serverId}"\nArgumentos: ${JSON.stringify(args)}`,
        execute: async (args) => {
          try {
            return await invoke<string>("mcp_call_tool", {
              serverId,
              toolName: tool.name,
              argumentsJson: JSON.stringify(args),
            });
          } catch (err) {
            return `Error ejecutando "${tool.name}" (servidor MCP ${serverId}): ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        },
      });
    }
  }

  return tools;
}
