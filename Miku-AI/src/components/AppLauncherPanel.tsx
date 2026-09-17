import { useState, DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DiscoveredApp, AppLauncherConfig } from "../hooks/useAppLauncher";

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
};

// El nombre de la app viaja en el dataTransfer con este tipo MIME propio,
// para no chocar con arrastres de texto/archivos normales del navegador.
const DRAG_MIME = "application/x-miku-app-name";

// Tarea 6.2: panel de administración de aplicaciones descubiertas, apps
// personalizadas (cargadas a mano, ej. scripts .bat) y carpetas. Puede
// tapar a Miku mientras está abierto -- no importa, es un panel de
// configuración, no algo que conviva con la conversación. El estilo queda
// deliberadamente simple por ahora (se retoma en el pulido general de la
// app); esta versión mejora la interacción: buscador para filtrar la
// lista y drag-and-drop de apps hacia una carpeta, en vez de escribir
// nombres a mano.
export function AppLauncherPanel({
  discoveredApps,
  customApps,
  config,
  onToggleAppHidden,
  onSetFolderApps,
  onRenameFolder,
  onDeleteFolder,
  onSetAppUrl,
  onAddCustomApp,
  onRemoveCustomApp,
  onSetActionsDisabled,
  onClose,
}: AppLauncherPanelProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [search, setSearch] = useState("");

  const isHidden = (name: string) =>
    config.hiddenApps.some((h) => h.toLowerCase() === name.toLowerCase());

  const filteredApps = discoveredApps.filter((app) =>
    app.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function handleAddFolder() {
    const name = newFolderName.trim();
    if (!name || config.folders[name]) return;
    onSetFolderApps(name, []);
    setNewFolderName("");
  }

  return (
    <div className="app-launcher-panel">
      <div className="app-launcher-header">
        <span>Aplicaciones y carpetas</span>
        <button onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>

      <label className="app-launcher-global-toggle">
        <input
          type="checkbox"
          checked={config.actionsDisabled}
          onChange={(e) => onSetActionsDisabled(e.target.checked)}
        />
        Desactivar todas las acciones de escritorio (para streams)
      </label>

      <div className="app-launcher-section">
        <h4>Carpetas (arrastra apps de las listas de abajo)</h4>
        {Object.entries(config.folders).map(([folderName, appNames]) => (
          <FolderRow
            key={folderName}
            folderName={folderName}
            appNames={appNames}
            onRename={(newName) => onRenameFolder(folderName, newName)}
            onSetApps={(names) => onSetFolderApps(folderName, names)}
            onDelete={() => onDeleteFolder(folderName)}
          />
        ))}
        <div className="app-launcher-new-folder">
          <input
            type="text"
            placeholder="Nombre de carpeta nueva..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddFolder()}
          />
          <button onClick={handleAddFolder}>Agregar</button>
        </div>
      </div>

      <div className="app-launcher-section">
        <h4>Aplicaciones personalizadas (scripts, .bat, etc.)</h4>
        <p className="app-launcher-hint">
          Solo Miku puede abrir lo que vos cargues acá -- ella nunca elige ni
          escribe una ruta por su cuenta.
        </p>
        {customApps.map((app) => (
          <CustomAppRow
            key={app.path}
            app={app}
            onRemove={() => onRemoveCustomApp(app.name)}
          />
        ))}
        <AddCustomAppForm onAdd={onAddCustomApp} />
      </div>

      <div className="app-launcher-section">
        <h4>
          Aplicaciones descubiertas ({filteredApps.length}/
          {discoveredApps.length})
        </h4>
        <input
          type="text"
          className="app-launcher-search"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="app-launcher-app-list">
          {filteredApps.map((app) => (
            <AppRow
              key={app.path}
              app={app}
              hidden={isHidden(app.name)}
              url={config.urls[app.name] ?? ""}
              onToggleHidden={() => onToggleAppHidden(app.name)}
              onSetUrl={(url) => onSetAppUrl(app.name, url)}
            />
          ))}
          {discoveredApps.length === 0 && (
            <p className="app-launcher-empty">Buscando aplicaciones...</p>
          )}
          {discoveredApps.length > 0 && filteredApps.length === 0 && (
            <p className="app-launcher-empty">
              Ninguna coincide con "{search}".
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  folderName,
  appNames,
  onRename,
  onSetApps,
  onDelete,
}: {
  folderName: string;
  appNames: string[];
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

  function handleRemove(appName: string) {
    onSetApps(appNames.filter((name) => name !== appName));
  }

  return (
    <div className="app-launcher-folder-row">
      <div className="app-launcher-folder-row-header">
        <input
          type="text"
          className="app-launcher-folder-name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => nameDraft.trim() && onRename(nameDraft.trim())}
        />
        <button onClick={onDelete} title="Eliminar carpeta">
          🗑
        </button>
      </div>
      <div
        className={`app-launcher-folder-drop ${isDragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {appNames.length === 0 ? (
          <span className="app-launcher-folder-drop-hint">
            Arrastra apps acá
          </span>
        ) : (
          appNames.map((name) => (
            <span key={name} className="app-launcher-chip">
              {name}
              <button onClick={() => handleRemove(name)} title="Quitar">
                ✕
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function AppRow({
  app,
  hidden,
  url,
  onToggleHidden,
  onSetUrl,
}: {
  app: DiscoveredApp;
  hidden: boolean;
  url: string;
  onToggleHidden: () => void;
  onSetUrl: (url: string) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(url);

  return (
    <div
      className={`app-launcher-app-row ${hidden ? "hidden" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, app.name);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title="Arrastra esto a una carpeta para agregarla"
    >
      <input
        type="checkbox"
        checked={!hidden}
        onChange={onToggleHidden}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <span className="app-launcher-app-name">{app.name}</span>
      <input
        type="text"
        className="app-launcher-app-url"
        placeholder="URL opcional..."
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        onBlur={() => onSetUrl(urlDraft)}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function CustomAppRow({
  app,
  onRemove,
}: {
  app: DiscoveredApp;
  onRemove: () => void;
}) {
  return (
    <div
      className="app-launcher-app-row"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, app.name);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={app.path}
    >
      <span className="app-launcher-app-name">{app.name}</span>
      <button onClick={onRemove} title="Eliminar">
        🗑
      </button>
    </div>
  );
}

function AddCustomAppForm({
  onAdd,
}: {
  onAdd: (name: string, path: string) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  async function handlePickFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Ejecutables y scripts", extensions: ["bat", "cmd", "exe"] },
        ],
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
    <div className="app-launcher-new-folder">
      <input
        type="text"
        placeholder="Nombre para Miku..."
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={handlePickFile} title={path || "Elegir archivo..."}>
        {path ? "Archivo elegido ✓" : "Elegir archivo..."}
      </button>
      <button onClick={handleAdd} disabled={!name.trim() || !path.trim()}>
        Agregar
      </button>
    </div>
  );
}
