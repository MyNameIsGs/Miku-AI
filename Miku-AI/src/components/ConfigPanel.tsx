import { MCP_SERVERS } from "../lib/mcp";
import { Connections } from "../hooks/useConnections";
import { useStreamMode } from "../hooks/useStreamMode";
import { useGameMode } from "../hooks/useGameMode";

// B6 del plan (sacado tal cual de App.tsx): el panel de configuración.
type ConfigPanelProps = {
  voicePitch: number;
  setVoicePitch: (value: number) => void;
  voiceRate: number;
  setVoiceRate: (value: number) => void;
  lipsyncMode: "texto" | "rhubarb";
  setLipsyncMode: (value: "texto" | "rhubarb") => void;
  connections: Connections;
  streamMode: ReturnType<typeof useStreamMode>;
  gameMode: ReturnType<typeof useGameMode>;
};

export function ConfigPanel({
  voicePitch,
  setVoicePitch,
  voiceRate,
  setVoiceRate,
  lipsyncMode,
  setLipsyncMode,
  connections,
  streamMode,
  gameMode,
}: ConfigPanelProps) {
  const {
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
  } = connections;
  return (
    <div className="config-panel">
      <label>
        Tono de voz: {voicePitch}
        <input
          type="range"
          min={-12}
          max={24}
          value={voicePitch}
          onChange={(e) => setVoicePitch(Number(e.target.value))}
        />
      </label>
      <label>
        Velocidad: {voiceRate}%
        <input
          type="range"
          min={-30}
          max={50}
          value={voiceRate}
          onChange={(e) => setVoiceRate(Number(e.target.value))}
        />
      </label>
      <label title="Desde el texto: la boca forma las vocales del español y Miku responde ~1 s antes. Rhubarb: analiza el audio (el de antes).">
        Boca:{" "}
        <select
          value={lipsyncMode}
          onChange={(e) => setLipsyncMode(e.target.value as "texto" | "rhubarb")}
        >
          <option value="texto">Vocales del texto (más rápida)</option>
          <option value="rhubarb">Rhubarb (la de antes)</option>
        </select>
      </label>
      <div className="oauth-connect-row">
        <button
          onClick={handleConnectSpotify}
          disabled={spotifyConnecting}
          className={spotifyConnected ? "active" : ""}
        >
          {spotifyConnecting
            ? "Conectando..."
            : spotifyConnected
              ? "Spotify conectado"
              : "Conectar Spotify"}
        </button>
        {spotifyError && (
          <span className="oauth-error" title={spotifyError}>
            Error al conectar Spotify
          </span>
        )}
      </div>
      <div className="oauth-connect-row gmail-accounts-row">
        {gmailAccounts.map((email) => (
          <span key={email} className="gmail-account-chip">
            {email}
            <button
              onClick={() => handleDisconnectGmail(email)}
              title="Desconectar esta cuenta"
            >
              ✕
            </button>
          </span>
        ))}
        <button onClick={handleConnectGmail} disabled={gmailConnecting}>
          {gmailConnecting
            ? "Conectando..."
            : gmailAccounts.length > 0
              ? "+ Otra cuenta de Gmail"
              : "Conectar Gmail"}
        </button>
        {gmailError && (
          <span className="oauth-error" title={gmailError}>
            Error al conectar Gmail
          </span>
        )}
      </div>
      <div className="oauth-connect-row gmail-accounts-row">
        {calendarAccounts.map((email) => (
          <span key={email} className="gmail-account-chip">
            {email}
            <button
              onClick={() => handleDisconnectCalendar(email)}
              title="Desconectar esta cuenta"
            >
              ✕
            </button>
          </span>
        ))}
        <button onClick={handleConnectCalendar} disabled={calendarConnecting}>
          {calendarConnecting
            ? "Conectando..."
            : calendarAccounts.length > 0
              ? "+ Otra cuenta de Calendar"
              : "Conectar Calendar"}
        </button>
        {calendarError && (
          <span className="oauth-error" title={calendarError}>
            Error al conectar Calendar
          </span>
        )}
      </div>
      <div className="oauth-connect-row gmail-accounts-row">
        {MCP_SERVERS.map((server) => {
          const connected = mcpConnectedIds.includes(server.id);
          return (
            <span key={server.id} className="gmail-account-chip">
              {server.label}
              <button
                onClick={() =>
                  connected ? handleDisconnectMcp(server.id) : handleConnectMcp(server)
                }
                disabled={mcpConnectingId === server.id}
                className={connected ? "active" : ""}
                title={
                  connected
                    ? "Desconectar este servidor MCP"
                    : "Conectar (puede tardar la primera vez, descarga el paquete)"
                }
              >
                {mcpConnectingId === server.id
                  ? "Conectando..."
                  : connected
                    ? "Conectado ✕"
                    : "Conectar"}
              </button>
            </span>
          );
        })}
        {mcpError && (
          <span className="oauth-error" title={mcpError}>
            Error al conectar servidor MCP
          </span>
        )}
      </div>
      {/* Tarea 8.3: solo informativo -- el modo stream se prende y se
          apaga solo según OBS, no hay nada que tocar acá. */}
      <div className="oauth-connect-row">
        <span
          className={streamMode.obsError ? "oauth-error" : undefined}
          title={streamMode.obsError ?? undefined}
        >
          {streamMode.active
            ? `Modo stream: ACTIVO (OBS ${streamMode.streaming ? "transmitiendo" : "grabando"}) -- avisos y acciones en pausa`
            : streamMode.obsError
              ? "Modo stream: sin conexión con OBS"
              : "Modo stream: inactivo (OBS conectado)"}
        </span>
      </div>
      <div className="oauth-connect-row">
        <label title="Con un juego (o cualquier app) a pantalla completa, Miku se esconde y deja libre la GPU; 'Hey Miku' la trae de vuelta">
          <input
            type="checkbox"
            checked={gameMode.enabled}
            onChange={(e) => gameMode.setEnabled(e.target.checked)}
          />{" "}
          Esconderse en juegos
          {gameMode.game.active && ` (ahora: ${gameMode.game.processName})`}
        </label>
      </div>
    </div>
  );
}
