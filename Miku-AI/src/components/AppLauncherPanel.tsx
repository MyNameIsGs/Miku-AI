import { useState } from "react";
import type { DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DiscoveredApp, AppLauncherConfig } from "../hooks/useAppLauncher";
import type { MotionPhase } from "../hooks/usePresenceMotion";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconClose,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGrip,
  IconLink,
  IconPlus,
  IconSearch,
  IconTrash,
} from "./Icons";

type AppLauncherPanelProps = {
  discoveredApps: DiscoveredApp[];
  customApps: DiscoveredApp[];
  config: AppLauncherConfig;
  onToggleAppHidden: (name: string) => void;
  onSetFolderApps: (folderName: string, appNames: string[]) => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (folderName: string) => void;
  onSetAppUrl: (appName: string, url: string) => void;
  onAddCustomApp: (name: string, path: string) => void;
  onRemoveCustomApp: (name: string) => void;
  onSetActionsDisabled: (disabled: boolean) => void;
  onClose: () => void;
  motion?: MotionPhase;
};

// El nombre de la app viaja en el dataTransfer con este tipo MIME propio,
// para no chocar con arrastres de texto/archivos normales del navegador.
const DRAG_MIME = "application/x-miku-app-name";

// Tarea 6.2 + ronda 2 de diseño (DISENO.md §2.2): apps descubiertas, apps
// propias (scripts, .exe) y carpetas a las que se arrastran apps. Jerarquía
// en tres niveles: interruptor global arriba, carpetas a la izquierda,
// apps a la derecha. Solo Miku abre lo que Sebastián carga acá; ella nunca
// elige ni escribe una ruta por su cuenta.
export function AppLauncherPanel(props: AppLauncherPanelProps) {
  const { config, discoveredApps, customApps } = props;
  const [tab, setTab] = useState<"descubiertas" | "tuyas">("descubiertas");
  const [search, setSearch] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  // La app que se está arrastrando: las carpetas la muestran como chip
  // fantasma mientras pasa por encima.
  const [dragging, setDragging] = useState<string | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null);

  const isHidden = (name: string) => config.hiddenApps.some((h) => h.toLowerCase() === name.toLowerCase());
  const filteredApps = discoveredApps.filter((app) => app.name.toLowerCase().includes(search.trim().toLowerCase()));
  const folderNames = Object.keys(config.folders);

  function handleAddFolder() {
    const name = newFolderName.trim();
    if (!name || config.folders[name]) return;
    props.onSetFolderApps(name, []);
    setNewFolderName("");
  }

  const dragProps = (name: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, name);
      e.dataTransfer.effectAllowed = "copy";
      setDragImage(e, name);
      setDragging(name);
    },
    onDragEnd: () => setDragging(null),
  });

  return (
    <div className="m-panel apps-panel" data-motion={props.motion} role="dialog" aria-labelledby="apps-title">
      <div className="m-panel-header">
        <div className="m-panel-heading">
          <h2 id="apps-title" className="m-panel-title">
            Apps y carpetas
          </h2>
          <span className="m-panel-tag">LANZADOR</span>
        </div>
        <button className="m-panel-close" onClick={props.onClose} aria-label="Cerrar apps y carpetas">
          <IconClose />
        </button>
      </div>

      {/* Nivel 1: el interruptor global (encendido = acciones permitidas). */}
      <div className="apps-global">
        <div className="apps-global-text">
          <span className="apps-global-title">Acciones en el PC</span>
          <span className="cfg-hint">Apágalo y Miku no podrá abrir ni tocar nada del escritorio.</span>
        </div>
        <button
          className={`cfg-switch ${config.actionsDisabled ? "" : "on"}`}
          aria-pressed={!config.actionsDisabled}
          aria-label="Acciones en el PC"
          onClick={() => props.onSetActionsDisabled(!config.actionsDisabled)}
        >
          <span className="cfg-switch-knob" />
        </button>
      </div>

      <div className="apps-columns">
        {/* Nivel 2: carpetas. */}
        <section className="apps-col apps-folders" aria-label="Carpetas">
          <div className="apps-col-head">
            <span className="apps-col-label">CARPETAS · {folderNames.length}</span>
            <span className="cfg-hint">arrastra apps aquí</span>
          </div>
          <div className="apps-scroll">
            {folderNames.map((folderName) => (
              <FolderCard
                key={folderName}
                folderName={folderName}
                appNames={config.folders[folderName]}
                dragging={dragging}
                onRename={(newName) => props.onRenameFolder(folderName, newName)}
                onSetApps={(names) => props.onSetFolderApps(folderName, names)}
                onDelete={() => setConfirmDeleteFolder(folderName)}
              />
            ))}
            <div className="apps-new-folder">
              <label htmlFor="apps-new-folder" className="visually-hidden">
                Nombre de la carpeta nueva
              </label>
              <input
                id="apps-new-folder"
                className="m-field"
                placeholder="Carpeta nueva…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddFolder()}
              />
              <button className="m-btn m-btn-small" onClick={handleAddFolder} disabled={!newFolderName.trim()}>
                <IconPlus size={14} />
                Crear
              </button>
            </div>
          </div>
        </section>

        {/* Nivel 3: apps. */}
        <section className="apps-col apps-list-col" aria-label="Aplicaciones">
          <div className="apps-toolbar">
            <div className="cfg-segmented" role="group" aria-label="Qué apps ver">
              <button aria-pressed={tab === "descubiertas"} onClick={() => setTab("descubiertas")}>
                Descubiertas · {discoveredApps.length}
              </button>
              <button aria-pressed={tab === "tuyas"} onClick={() => setTab("tuyas")}>
                Tuyas · {customApps.length}
              </button>
            </div>
            <button className="m-btn m-btn-small" onClick={() => setTab("tuyas")} title="Agregar un script o un .exe">
              <IconPlus size={14} />
              Script o .exe
            </button>
          </div>

          {tab === "descubiertas" ? (
            <>
              <div className="mem-search apps-search">
                <label htmlFor="apps-q" className="visually-hidden">
                  Buscar apps
                </label>
                <span className="mem-search-icon">
                  <IconSearch size={16} />
                </span>
                <input
                  id="apps-q"
                  type="search"
                  placeholder="Buscar apps"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <ul className="apps-scroll apps-rows">
                {filteredApps.map((app) => (
                  <AppRow
                    key={app.path}
                    app={app}
                    hidden={isHidden(app.name)}
                    url={config.urls[app.name] ?? ""}
                    dragging={dragging === app.name}
                    dragProps={dragProps(app.name)}
                    onToggleHidden={() => props.onToggleAppHidden(app.name)}
                    onSetUrl={(url) => props.onSetAppUrl(app.name, url)}
                  />
                ))}
                {discoveredApps.length === 0 && <p className="mem-empty">Buscando aplicaciones…</p>}
                {discoveredApps.length > 0 && filteredApps.length === 0 && (
                  <p className="mem-empty">Ninguna coincide con «{search}».</p>
                )}
              </ul>
            </>
          ) : (
            <div className="apps-scroll">
              <p className="cfg-hint apps-own-hint">
                Scripts o programas que cargas tú. Solo Miku puede abrir lo que está aquí: ella nunca elige ni escribe
                una ruta por su cuenta.
              </p>
              <ul className="apps-rows">
                {customApps.map((app) => (
                  <li
                    key={app.path}
                    className={`apps-row ${dragging === app.name ? "is-dragging" : ""}`}
                    title={app.path}
                    {...dragProps(app.name)}
                  >
                    <span className="apps-grip" aria-hidden="true">
                      <IconGrip size={14} />
                    </span>
                    <span className="apps-name">{app.name}</span>
                    <button
                      className="apps-icon-btn"
                      onClick={() => props.onRemoveCustomApp(app.name)}
                      aria-label={`Quitar ${app.name}`}
                      title="Quitar"
                    >
                      <IconTrash size={16} />
                    </button>
                  </li>
                ))}
                {customApps.length === 0 && <p className="mem-empty">Todavía no cargaste ninguna.</p>}
              </ul>
              <AddCustomAppForm onAdd={props.onAddCustomApp} />
            </div>
          )}
        </section>
      </div>

      {confirmDeleteFolder && (
        <ConfirmDialog
          title="¿Borrar esta carpeta?"
          confirmLabel="Borrar"
          tone="danger"
          onConfirm={() => {
            props.onDeleteFolder(confirmDeleteFolder);
            setConfirmDeleteFolder(null);
          }}
          onCancel={() => setConfirmDeleteFolder(null)}
        >
          <p className="m-dialog-quote">{confirmDeleteFolder}</p>
          <p className="m-dialog-text">Las apps no se borran: solo deja de existir la carpeta.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// La copia que acompaña al cursor al arrastrar (ronda 2: fondo #16292C,
// borde turquesa, sombra, rotada −2°).
function setDragImage(e: DragEvent, name: string) {
  const ghost = document.createElement("div");
  ghost.className = "apps-drag-ghost";
  ghost.textContent = name;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  window.setTimeout(() => ghost.remove(), 0);
}

function FolderCard({
  folderName,
  appNames,
  dragging,
  onRename,
  onSetApps,
  onDelete,
}: {
  folderName: string;
  appNames: string[];
  dragging: string | null;
  onRename: (name: string) => void;
  onSetApps: (names: string[]) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(folderName);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const appName = e.dataTransfer.getData(DRAG_MIME);
    if (!appName || appNames.includes(appName)) return;
    onSetApps([...appNames, appName]);
  }

  const showGhost = isDragOver && dragging && !appNames.includes(dragging);

  return (
    <div
      className={`apps-folder ${isDragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="apps-folder-head">
        <span className="apps-folder-icon" aria-hidden="true">
          <IconFolder size={16} />
        </span>
        <label className="visually-hidden" htmlFor={`folder-${folderName}`}>
          Nombre de la carpeta
        </label>
        <input
          id={`folder-${folderName}`}
          className="apps-folder-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          // Se guarda al salir del campo, como antes.
          onBlur={() => nameDraft.trim() && nameDraft.trim() !== folderName && onRename(nameDraft.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {isDragOver ? (
          <span className="apps-drop-label">SUELTA PARA AGREGAR</span>
        ) : (
          <button className="apps-icon-btn" onClick={onDelete} aria-label={`Borrar carpeta ${folderName}`} title="Borrar carpeta">
            <IconTrash size={16} />
          </button>
        )}
      </div>
      <div className="apps-chips">
        {appNames.map((name) => (
          <span key={name} className="apps-chip">
            {name}
            <button onClick={() => onSetApps(appNames.filter((n) => n !== name))} aria-label={`Quitar ${name} de la carpeta`}>
              <IconClose size={12} />
            </button>
          </span>
        ))}
        {showGhost && <span className="apps-chip ghost">{dragging}</span>}
        {appNames.length === 0 && !showGhost && <span className="cfg-hint">Vacía: arrastra una app aquí</span>}
      </div>
    </div>
  );
}

function AppRow({
  app,
  hidden,
  url,
  dragging,
  dragProps,
  onToggleHidden,
  onSetUrl,
}: {
  app: DiscoveredApp;
  hidden: boolean;
  url: string;
  dragging: boolean;
  dragProps: object;
  onToggleHidden: () => void;
  onSetUrl: (url: string) => void;
}) {
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(url);

  let domain = "";
  try {
    domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    domain = url;
  }

  const saveUrl = () => {
    if (urlDraft.trim() !== url) onSetUrl(urlDraft.trim());
  };

  return (
    <li className="apps-row-wrap">
      <div
        className={`apps-row ${hidden ? "is-hidden" : ""} ${dragging ? "is-dragging" : ""}`}
        title="Arrástrala a una carpeta para agregarla"
        {...dragProps}
      >
        <span className="apps-grip" aria-hidden="true">
          <IconGrip size={14} />
        </span>
        <span className="apps-name">{app.name}</span>
        {hidden && <span className="apps-hidden-tag">OCULTA</span>}
        {domain && <span className="apps-domain">{domain}</span>}
        <button
          className={`apps-icon-btn ${editingUrl ? "active" : ""}`}
          onClick={() => setEditingUrl((v) => !v)}
          aria-label={`Enlace de ${app.name}`}
          aria-expanded={editingUrl}
          title="Enlace que abre esta app"
        >
          <IconLink size={16} />
        </button>
        <button
          className={`apps-icon-btn ${hidden ? "hidden-on" : ""}`}
          onClick={onToggleHidden}
          aria-pressed={hidden}
          aria-label={hidden ? `Mostrar ${app.name} a Miku` : `Ocultar ${app.name} a Miku`}
          title={hidden ? "Oculta: Miku no la ve (clic para mostrarla)" : "Ocultarla a Miku"}
        >
          {hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      </div>
      {editingUrl && (
        <div className="apps-url">
          <label className="visually-hidden" htmlFor={`url-${app.path}`}>
            Enlace de {app.name}
          </label>
          <input
            id={`url-${app.path}`}
            className="m-field apps-url-input"
            placeholder="https://… (opcional: se abre con esta app)"
            value={urlDraft}
            autoFocus
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={saveUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                saveUrl();
                setEditingUrl(false);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setUrlDraft(url);
                setEditingUrl(false);
              }
            }}
          />
        </div>
      )}
    </li>
  );
}

function AddCustomAppForm({ onAdd }: { onAdd: (name: string, path: string) => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  async function handlePickFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Ejecutables y scripts", extensions: ["bat", "cmd", "exe"] }],
      });
      if (!selected || typeof selected !== "string") return;
      setPath(selected);
      if (!name.trim()) {
        const fileName = selected.split(/[\\/]/).pop() ?? selected;
        setName(fileName.replace(/\.(bat|cmd|exe)$/i, ""));
      }
    } catch (err) {
      console.error("Error eligiendo archivo:", err);
    }
  }

  function handleAdd() {
    if (!name.trim() || !path.trim()) return;
    onAdd(name.trim(), path.trim());
    setName("");
    setPath("");
  }

  return (
    <div className="apps-add">
      <span className="apps-col-label">AGREGAR UNA</span>
      <div className="apps-add-row">
        <label className="visually-hidden" htmlFor="apps-add-name">
          Nombre para Miku
        </label>
        <input
          id="apps-add-name"
          className="m-field"
          placeholder="Nombre para Miku"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="m-btn m-btn-small" onClick={handlePickFile} title={path || undefined}>
          {path ? "Archivo elegido" : "Elegir archivo…"}
        </button>
        <button className="m-btn m-btn-small m-btn-primary" onClick={handleAdd} disabled={!name.trim() || !path.trim()}>
          Agregar
        </button>
      </div>
      {path && <span className="apps-add-path cfg-hint">{path}</span>}
    </div>
  );
}
