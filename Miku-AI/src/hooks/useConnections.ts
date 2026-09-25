import { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { MCP_SERVERS, McpServerConfig, connectMcpServer, disconnectMcpServer } from "../lib/mcp";
import { connectSpotify, isSpotifyConnected } from "../lib/spotify/auth";
import { connectGmail, disconnectGmailAccount, listConnectedGmailEmails } from "../lib/gmail/auth";
import { connectCalendar, disconnectCalendarAccount, listConnectedCalendarEmails } from "../lib/calendar/auth";

// B6 del plan (sacado tal cual de App.tsx): las conexiones de la pestaña de
// configuración -- Spotify, cuentas de Gmail y Calendar, servidores MCP
// (con la reconexión automática al abrir). App la llama siempre, así que
// todo arranca igual que antes, esté o no abierto el panel.
export function useConnections() {
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [gmailAccounts, setGmailAccounts] = useState<string[]>([]);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [calendarAccounts, setCalendarAccounts] = useState<string[]>([]);
  const [calendarConnecting, setCalendarConnecting] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  // Tarea 8.2: Miku como cliente MCP -- qué servidores (ver MCP_SERVERS en
  // lib/mcp.ts) están conectados ahora mismo, en esta sesión (no persiste
  // entre reinicios a propósito: son subprocesos, no tiene sentido
  // "recordar" que estaban conectados si el proceso real ya no existe).
  const [mcpConnectedIds, setMcpConnectedIds] = useState<string[]>([]);
  const [mcpConnectingId, setMcpConnectingId] = useState<string | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    isSpotifyConnected()
      .then(setSpotifyConnected)
      .catch((err) => console.error("Error consultando conexión de Spotify:", err));
    listConnectedGmailEmails()
      .then(setGmailAccounts)
      .catch((err) => console.error("Error consultando cuentas de Gmail:", err));
    listConnectedCalendarEmails()
      .then(setCalendarAccounts)
      .catch((err) => console.error("Error consultando cuentas de Calendar:", err));
  }, []);

  // Qué servidores MCP quedan conectados solos al abrir la app: los que
  // Sebastián dejó conectados la última vez (pidió no tener que conectar
  // Playwright a mano cada vez). Desconectar a mano lo saca de la lista.
  // Seguro de reconectar en cada arranque: medido, si la app muere sin
  // desconectar, Playwright cierra solo todo su árbol (node + Chrome sin
  // ventana, 14 procesos) al quedarse sin su entrada -- no se acumulan
  // navegadores huérfanos.
  const MCP_AUTOCONNECT_KEY = "mcpAutoConnect";
  const setMcpAutoConnect = async (serverId: string, enabled: boolean) => {
    try {
      const store = await load(".settings.dat", { autoSave: false });
      const current = (await store.get<string[]>(MCP_AUTOCONNECT_KEY)) ?? [];
      const next = enabled
        ? [...current.filter((id) => id !== serverId), serverId]
        : current.filter((id) => id !== serverId);
      await store.set(MCP_AUTOCONNECT_KEY, next);
      await store.save();
    } catch (err) {
      console.error("Error guardando la reconexión de servidores MCP:", err);
    }
  };

  const handleConnectMcp = async (server: McpServerConfig) => {
    setMcpConnectingId(server.id);
    setMcpError(null);
    try {
      await connectMcpServer(server);
      setMcpConnectedIds((prev) => [...prev.filter((id) => id !== server.id), server.id]);
      await setMcpAutoConnect(server.id, true);
    } catch (err) {
      setMcpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpConnectingId(null);
    }
  };

  const handleDisconnectMcp = async (serverId: string) => {
    try {
      await disconnectMcpServer(serverId);
    } catch (err) {
      console.error("Error desconectando servidor MCP:", err);
    } finally {
      setMcpConnectedIds((prev) => prev.filter((id) => id !== serverId));
      await setMcpAutoConnect(serverId, false);
    }
  };

  useEffect(() => {
    (async () => {
      let ids: string[] = [];
      try {
        const store = await load(".settings.dat", { autoSave: false });
        ids = (await store.get<string[]>(MCP_AUTOCONNECT_KEY)) ?? [];
      } catch (err) {
        console.error("Error leyendo la reconexión de servidores MCP:", err);
      }
      // Uno detrás del otro, en segundo plano: no frena el arranque.
      for (const server of MCP_SERVERS.filter((s) => ids.includes(s.id))) {
        console.log(`[MCP] Reconectando "${server.id}" (quedó conectado la última vez)...`);
        await handleConnectMcp(server);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectSpotify = async () => {
    setSpotifyConnecting(true);
    setSpotifyError(null);
    try {
      await connectSpotify();
      setSpotifyConnected(true);
    } catch (err) {
      setSpotifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpotifyConnecting(false);
    }
  };

  const handleConnectGmail = async () => {
    setGmailConnecting(true);
    setGmailError(null);
    try {
      const email = await connectGmail();
      setGmailAccounts((prev) => [...prev.filter((e) => e !== email), email]);
    } catch (err) {
      console.error("Error conectando Gmail:", err);
      setGmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleDisconnectGmail = async (email: string) => {
    try {
      await disconnectGmailAccount(email);
      setGmailAccounts((prev) => prev.filter((e) => e !== email));
    } catch (err) {
      console.error("Error desconectando cuenta de Gmail:", err);
    }
  };

  const handleConnectCalendar = async () => {
    setCalendarConnecting(true);
    setCalendarError(null);
    try {
      const email = await connectCalendar();
      setCalendarAccounts((prev) => [...prev.filter((e) => e !== email), email]);
    } catch (err) {
      console.error("Error conectando Calendar:", err);
      setCalendarError(err instanceof Error ? err.message : String(err));
    } finally {
      setCalendarConnecting(false);
    }
  };

  const handleDisconnectCalendar = async (email: string) => {
    try {
      await disconnectCalendarAccount(email);
      setCalendarAccounts((prev) => prev.filter((e) => e !== email));
    } catch (err) {
      console.error("Error desconectando cuenta de Calendar:", err);
    }
  };

  return {
    spotifyConnected,
    spotifyConnecting,
    spotifyError,
    gmailAccounts,
    gmailConnecting,
    gmailError,
    calendarAccounts,
    calendarConnecting,
    calendarError,
    mcpConnectedIds,
    mcpConnectingId,
    mcpError,
    handleConnectMcp,
    handleDisconnectMcp,
    handleConnectSpotify,
    handleConnectGmail,
    handleDisconnectGmail,
    handleConnectCalendar,
    handleDisconnectCalendar,
  };
}

export type Connections = ReturnType<typeof useConnections>;
