import { invoke } from "@tauri-apps/api/core";

// Tarea 8.2: Miku como cliente MCP -- conecta servidores MCP locales
// (procesos, hablan por stdio) usando el SDK oficial `rmcp` del lado Rust
// (ver mcp_client.rs). Mismo patrón que appLauncherStore.ts: este módulo
// guarda el estado (qué servidores están conectados y qué tools expone
// cada uno), las tools (lib/tools/mcpTools.ts) solo leen de acá.
export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerConfig = {
  id: string;
  label: string;
  command: string;
  args: string[];
};

// Primer candidato concreto (Tarea 8.2, tal como lo proponía el plan): un
// servidor MCP de navegador, para poder leer una página web de verdad --
// pospuesto en la Tarea 6.3 (leer_pagina) porque en ese momento no valía
// la pena escribirlo a mano. `@playwright/mcp` es el servidor oficial de
// Microsoft; `npx -y` evita que la primera descarga se quede esperando
// una confirmación que nadie va a ver (corre en segundo plano).
export const MCP_SERVERS: McpServerConfig[] = [
  {
    id: "playwright",
    label: "Playwright (navegador)",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  },
];

type McpState = {
  connectedServers: Record<string, McpToolInfo[]>;
};

let state: McpState = { connectedServers: {} };

export function getMcpState(): McpState {
  return state;
}

export function isMcpServerConnected(serverId: string): boolean {
  return serverId in state.connectedServers;
}

export async function connectMcpServer(server: McpServerConfig): Promise<McpToolInfo[]> {
  const tools = await invoke<McpToolInfo[]>("mcp_connect", {
    serverId: server.id,
    command: server.command,
    args: server.args,
  });
  state = {
    connectedServers: { ...state.connectedServers, [server.id]: tools },
  };
  return tools;
}

export async function disconnectMcpServer(serverId: string) {
  await invoke("mcp_disconnect", { serverId });
  const next = { ...state.connectedServers };
  delete next[serverId];
  state = { connectedServers: next };
}
