import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MCP_SERVERS } from "../lib/mcp";
import { getTodayUsage, TodayUsage } from "../lib/tokenUsage";
import { getAudioDevices } from "../lib/tools/audioDeviceStore";
import { QUIET_HOURS_END_HOUR, QUIET_HOURS_START_HOUR } from "../config/constants";
import { isQuietHours } from "../lib/quietHours";
import { Connections } from "../hooks/useConnections";
import { useStreamMode } from "../hooks/useStreamMode";
import { useGameMode } from "../hooks/useGameMode";
import { IconClose } from "./Icons";
import type { MotionPhase } from "../hooks/usePresenceMotion";

// Panel de Configuración, diseño v1 (docs/diseno-ui-v1/README.md §4):
// cuatro módulos numerados en dos columnas. Todo lo que ya existía se
// conserva; lo que la maqueta dibuja como interruptor pero en la app es
// automático (modo stream, no molestar) se muestra como estado, sin
// interruptor falso.

type ConfigPanelProps = {
  // Fase de entrada/salida (ver usePresenceMotion).
  motion?: MotionPhase;
  voicePitch: number;
  setVoicePitch: (value: number) => void;
  voiceRate: number;
  setVoiceRate: (value: number) => void;
  lipsyncMode: "texto" | "rhubarb";
  setLipsyncMode: (value: "texto" | "rhubarb") => void;
  connections: Connections;
  streamMode: ReturnType<typeof useStreamMode>;
  gameMode: ReturnType<typeof useGameMode>;
  actionsDisabled: boolean;
  setActionsDisabled: (disabled: boolean) => void;
  onOpenQuirks: () => void;
  onOpenAppLauncher: () => void;
  onClose: () => void;
};

const hourLabel = (h: number) => `${h}:00`;

function Module({ number, title, children, className = "" }: { number: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`cfg-module ${className}`} aria-label={title}>
      <div className="cfg-module-title">
        <span className="cfg-module-number">{number}</span>
        <span>{title.toUpperCase()}</span>
      </div>
      {children}
    </section>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button className={`cfg-switch ${on ? "on" : ""}`} aria-pressed={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="cfg-switch-knob" />
    </button>
  );
}

function Status({ tone, children }: { tone: "ok" | "off" | "busy" | "warn"; children: ReactNode }) {
  return (
    <span className="cfg-status">
      <span className={`cfg-led cfg-led-${tone}`} />
      {children}
    </span>
  );
}

// Una fila de conexión: nombre + estado a la izquierda, acción a la
// derecha; opcionalmente un error y un submenú desplegable (las cuentas).
function ConnectionRow({
  name,
  status,
  action,
  error,
  children,
}: {
  name: string;
  status: ReactNode;
  action: ReactNode;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="cfg-connection">
      <div className="cfg-connection-main">
        <div className="cfg-connection-text">
          <span className="cfg-connection-name">{name}</span>
          {status}
        </div>
        {action}
      </div>
      {error && (
        <div className="cfg-error" title={error}>
          {error}
        </div>
      )}
      {children}
    </div>
  );
}

// Submenú de cuentas (Gmail, Calendar): la lista con "Quitar" y el botón
// para sumar otra.
function AccountsList({
  accounts,
  onRemove,
  onAdd,
  adding,
}: {
  accounts: string[];
  onRemove: (email: string) => void;
  onAdd: () => void;
  adding: boolean;
}) {
  return (
    <div className="cfg-accounts">
      {accounts.map((email) => (
        <div key={email} className="cfg-account">
          <span className="cfg-account-email">{email}</span>
          <button className="cfg-btn cfg-btn-small" onClick={() => onRemove(email)}>
            Quitar
          </button>
        </div>
      ))}
      <button className="cfg-btn cfg-btn-accent cfg-btn-small" onClick={onAdd} disabled={adding}>
        {adding ? "Conectando..." : "Otra cuenta"}
      </button>
    </div>
  );
}

export function ConfigPanel(props: ConfigPanelProps) {
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
  } = props.connections;
  const { streamMode, gameMode } = props;

  const [openAccounts, setOpenAccounts] = useState<"gmail" | "calendar" | null>(null);

  // Cuánto va gastando hoy (se lee al abrir el panel).
  const [usage, setUsage] = useState<TodayUsage | null>(null);
  const [showUsageDetail, setShowUsageDetail] = useState(false);
  useEffect(() => {
    getTodayUsage().then(setUsage).catch(() => setUsage(null));
  }, []);

  // Salida de audio: Windows no dice cuál es la actual, solo la lista. El
  // selector arranca en "sin cambiar" y al elegir una la pone como
  // predeterminada (lo mismo que hace la tool cambiar_salida_audio).
  const audioDevices = getAudioDevices();
  const [audioOutput, setAudioOutput] = useState("");
  const [audioError, setAudioError] = useState<string | null>(null);
  const changeAudioOutput = async (deviceId: string) => {
    setAudioOutput(deviceId);
    setAudioError(null);
    if (!deviceId) return;
    try {
      await invoke("set_default_audio_output", { deviceId });
    } catch (err) {
      setAudioError(`No se pudo cambiar la salida: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const quietNow = isQuietHours();

  return (
    <div className="m-panel config-panel" data-motion={props.motion} role="dialog" aria-labelledby="cfg-title">
      <div className="m-panel-header">
        <div className="m-panel-heading">
          <h2 id="cfg-title" className="m-panel-title">
            Configuración
          </h2>
          <span className="m-panel-tag">MIXER</span>
        </div>
        <button className="m-panel-close" onClick={props.onClose} aria-label="Cerrar configuración">
          <IconClose />
        </button>
      </div>

      <div className="m-panel-body cfg-grid">
        <div className="cfg-column">
          <Module number="01" title="Voz">
            <div className="cfg-field">
              <div className="cfg-field-row">
                <label htmlFor="cfg-pitch">Tono</label>
                <span className="cfg-hint">grave — aguda · {props.voicePitch}</span>
              </div>
              <input
                id="cfg-pitch"
                type="range"
                min={-12}
                max={24}
                value={props.voicePitch}
                onChange={(e) => props.setVoicePitch(Number(e.target.value))}
              />
            </div>
            <div className="cfg-field">
              <div className="cfg-field-row">
                <label htmlFor="cfg-rate">Velocidad</label>
                <span className="cfg-hint">lenta — rápida · {props.voiceRate}%</span>
              </div>
              <input
                id="cfg-rate"
                type="range"
                min={-30}
                max={50}
                value={props.voiceRate}
                onChange={(e) => props.setVoiceRate(Number(e.target.value))}
              />
            </div>
            <div className="cfg-field-row">
              <span title="Desde el texto: la boca forma las vocales del español y Miku responde ~1 s antes. Rhubarb: analiza el audio (el de antes).">
                Boca
              </span>
              <div className="cfg-segmented" role="group" aria-label="Sincronía de la boca">
                <button aria-pressed={props.lipsyncMode === "texto"} onClick={() => props.setLipsyncMode("texto")}>
                  Desde el texto
                </button>
                <button aria-pressed={props.lipsyncMode === "rhubarb"} onClick={() => props.setLipsyncMode("rhubarb")}>
                  Rhubarb
                </button>
              </div>
            </div>
            <div className="cfg-field">
              <label htmlFor="cfg-output">Salida de audio</label>
              <select
                id="cfg-output"
                className="cfg-select"
                value={audioOutput}
                onChange={(e) => changeAudioOutput(e.target.value)}
              >
                <option value="">Predeterminada del sistema (sin cambiar)</option>
                {audioDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
              {audioError && <div className="cfg-error">{audioError}</div>}
            </div>
          </Module>

          <Module number="03" title="Acciones">
            <div className="cfg-toggle-row">
              <div className="cfg-toggle-text">
                <span>Acciones en el PC</span>
                <span className="cfg-hint">Abrir apps, medios, ventanas…</span>
              </div>
              <Switch
                on={!props.actionsDisabled}
                onChange={(on) => props.setActionsDisabled(!on)}
                label="Acciones en el PC"
              />
            </div>
            <div className="cfg-toggle-row">
              <div className="cfg-toggle-text">
                <span>Esconderse en juegos</span>
                <span className="cfg-hint">
                  {gameMode.game.active
                    ? `Ahora: ${gameMode.game.processName}`
                    : "Con pantalla completa, se esconde"}
                </span>
              </div>
              <Switch on={gameMode.enabled} onChange={(on) => gameMode.setEnabled(on)} label="Esconderse en juegos" />
            </div>
            {/* Automático según OBS: no hay nada que tocar acá. */}
            <div className="cfg-toggle-row">
              <div className="cfg-toggle-text">
                <span>Modo stream automático</span>
                <span className="cfg-hint" title={streamMode.obsError ?? undefined}>
                  {streamMode.active
                    ? `OBS ${streamMode.streaming ? "transmitiendo" : "grabando"}: avisos y acciones en pausa`
                    : streamMode.obsError
                      ? "OBS sin conectar"
                      : "OBS conectado, sin transmitir"}
                </span>
              </div>
              <Status tone={streamMode.active ? "warn" : streamMode.obsError ? "off" : "ok"}>
                {streamMode.active ? "Activo" : "Inactivo"}
              </Status>
            </div>
            <div className="cfg-toggle-row">
              <div className="cfg-toggle-text">
                <span>No molestar</span>
                <span className="cfg-hint">
                  Avisos agrupados de {hourLabel(QUIET_HOURS_START_HOUR)} a {hourLabel(QUIET_HOURS_END_HOUR)}
                </span>
              </div>
              <Status tone={quietNow ? "warn" : "off"}>{quietNow ? "Ahora" : "Fuera de horario"}</Status>
            </div>
          </Module>
        </div>

        <div className="cfg-column">
          <Module number="02" title="Conexiones" className="cfg-connections">
            <ConnectionRow
              name="Spotify"
              status={
                <Status tone={spotifyConnecting ? "busy" : spotifyConnected ? "ok" : "off"}>
                  {spotifyConnecting ? "Conectando..." : spotifyConnected ? "Conectado" : "Sin conectar"}
                </Status>
              }
              action={
                <button
                  className={`cfg-btn ${spotifyConnected ? "" : "cfg-btn-accent"}`}
                  onClick={handleConnectSpotify}
                  disabled={spotifyConnecting}
                >
                  {spotifyConnected ? "Reconectar" : "Conectar"}
                </button>
              }
              error={spotifyError ? "Error al conectar Spotify" : null}
            />

            <ConnectionRow
              name="Gmail"
              status={
                <Status tone={gmailConnecting ? "busy" : gmailAccounts.length > 0 ? "ok" : "off"}>
                  {gmailAccounts.length === 0
                    ? "Sin conectar"
                    : gmailAccounts.length === 1
                      ? "1 cuenta"
                      : `${gmailAccounts.length} cuentas`}
                </Status>
              }
              action={
                gmailAccounts.length === 0 ? (
                  <button className="cfg-btn cfg-btn-accent" onClick={handleConnectGmail} disabled={gmailConnecting}>
                    {gmailConnecting ? "Conectando..." : "Conectar"}
                  </button>
                ) : (
                  <button
                    className={`cfg-btn ${openAccounts === "gmail" ? "open" : ""}`}
                    onClick={() => setOpenAccounts((o) => (o === "gmail" ? null : "gmail"))}
                    aria-expanded={openAccounts === "gmail"}
                  >
                    Cuentas
                  </button>
                )
              }
              error={gmailError ? "Error al conectar Gmail" : null}
            >
              {openAccounts === "gmail" && gmailAccounts.length > 0 && (
                <AccountsList
                  accounts={gmailAccounts}
                  onRemove={handleDisconnectGmail}
                  onAdd={handleConnectGmail}
                  adding={gmailConnecting}
                />
              )}
            </ConnectionRow>

            <ConnectionRow
              name="Google Calendar"
              status={
                <Status tone={calendarConnecting ? "busy" : calendarAccounts.length > 0 ? "ok" : "off"}>
                  {calendarAccounts.length === 0
                    ? "Sin conectar"
                    : calendarAccounts.length === 1
                      ? "1 cuenta"
                      : `${calendarAccounts.length} cuentas`}
                </Status>
              }
              action={
                calendarAccounts.length === 0 ? (
                  <button className="cfg-btn cfg-btn-accent" onClick={handleConnectCalendar} disabled={calendarConnecting}>
                    {calendarConnecting ? "Conectando..." : "Conectar"}
                  </button>
                ) : (
                  <button
                    className={`cfg-btn ${openAccounts === "calendar" ? "open" : ""}`}
                    onClick={() => setOpenAccounts((o) => (o === "calendar" ? null : "calendar"))}
                    aria-expanded={openAccounts === "calendar"}
                  >
                    Cuentas
                  </button>
                )
              }
              error={calendarError ? "Error al conectar Calendar" : null}
            >
              {openAccounts === "calendar" && calendarAccounts.length > 0 && (
                <AccountsList
                  accounts={calendarAccounts}
                  onRemove={handleDisconnectCalendar}
                  onAdd={handleConnectCalendar}
                  adding={calendarConnecting}
                />
              )}
            </ConnectionRow>

            {MCP_SERVERS.map((server) => {
              const connected = mcpConnectedIds.includes(server.id);
              const connecting = mcpConnectingId === server.id;
              return (
                <ConnectionRow
                  key={server.id}
                  name={`${server.label.replace(/\s*\(.*\)$/, "")} · MCP`}
                  status={
                    <Status tone={connecting ? "busy" : connected ? "ok" : "off"}>
                      {connecting ? "Conectando..." : connected ? "Conectado" : "Sin conectar"}
                    </Status>
                  }
                  action={
                    <button
                      className={`cfg-btn ${connected ? "" : "cfg-btn-accent"}`}
                      onClick={() => (connected ? handleDisconnectMcp(server.id) : handleConnectMcp(server))}
                      disabled={connecting}
                      title={connected ? undefined : "Puede tardar la primera vez: descarga el paquete"}
                    >
                      {connected ? "Desconectar" : "Conectar"}
                    </button>
                  }
                />
              );
            })}
            {mcpError && (
              <div className="cfg-error" title={mcpError}>
                Error al conectar servidor MCP
              </div>
            )}
          </Module>

          <Module number="04" title="Hoy">
            <div className="cfg-stats">
              <div className="cfg-stat">
                <span className="cfg-hint">Costo</span>
                <span className="cfg-stat-value">{usage ? `$${usage.cost.toFixed(2)}` : "—"}</span>
              </div>
              <div className="cfg-stat">
                <span className="cfg-hint">Tokens</span>
                <span className="cfg-stat-value">{usage ? usage.tokens.toLocaleString("es-ES") : "—"}</span>
              </div>
            </div>
            {usage && usage.byKind.length > 0 && (
              <>
                <button
                  className="cfg-link"
                  onClick={() => setShowUsageDetail((v) => !v)}
                  aria-expanded={showUsageDetail}
                >
                  {showUsageDetail ? "Ocultar detalle" : "Ver por tipo de llamada"}
                </button>
                {showUsageDetail && (
                  <div className="cfg-usage-detail">
                    {usage.byKind.map((k) => (
                      <div key={k.kind} className="cfg-usage-row">
                        <span>{k.kind}</span>
                        <span className="cfg-hint">
                          {k.calls} · {k.tokens.toLocaleString("es-ES")} tok · ${k.cost.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Module>

          <div className="cfg-footer">
            <button className="cfg-footer-btn" onClick={props.onOpenQuirks}>
              Quirks
            </button>
            <button className="cfg-footer-btn" onClick={props.onOpenAppLauncher}>
              Apps y carpetas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
