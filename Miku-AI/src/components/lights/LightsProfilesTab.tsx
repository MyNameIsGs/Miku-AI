import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { effectColor, rgbCss } from "../../lib/lightEffects";
import { LightsGlobal, Scene, STRIP_COLORS, describeStrips, resolveStrips, withStripsSnapshot } from "../../lib/lights";
import {
  Profile,
  Rule,
  RuleThen,
  RuleWhen,
  activeRuleId,
  applyProfile,
  describeThen,
  describeWhen,
  exportJson,
  favoriteSlots,
  importJson,
  loadProfiles,
  newId,
  saveProfiles,
} from "../../lib/lightProfiles";

type LightsProfilesTabProps = {
  scene: Scene;
  global: LightsGlobal;
  onGlobal: (global: LightsGlobal) => void;
  // Se aplicó un perfil: el panel vuelve a leer la escena.
  onApplied: () => void;
  // Editar: el perfil se aplica y el panel pasa a la pestaña Escena con
  // un aviso para guardar los cambios en él.
  onEdit: (profile: Profile) => void;
  onError: (err: unknown) => void;
};

type State = Awaited<ReturnType<typeof loadProfiles>>;

const WHEN_KINDS: { kind: RuleWhen["kind"]; label: string }[] = [
  { kind: "game", label: "Jugando" },
  { kind: "stream", label: "En vivo (OBS)" },
  { kind: "sleeping", label: "Miku durmiendo" },
  { kind: "music", label: "Suena música" },
  { kind: "schedule", label: "Horario" },
  { kind: "away", label: "Ausente" },
];

function defaultWhen(kind: RuleWhen["kind"]): RuleWhen {
  switch (kind) {
    case "game":
      return { kind, match: "" };
    case "schedule":
      return { kind, from: "00:00", to: "07:00" };
    case "away":
      return { kind, minutes: 10 };
    default:
      return { kind } as RuleWhen;
  }
}

// Pestaña Perfiles del panel Luces (PLAN.md §3.5): escenas guardadas con
// nombre (los favoritos van a Ctrl+Alt+1…9 y a la bandeja), las reglas
// automáticas en orden de prioridad, qué quedan las luces al cerrar Miku, e
// importar/exportar.
export function LightsProfilesTab({ scene, global, onGlobal, onApplied, onEdit, onError }: LightsProfilesTabProps) {
  const [state, setState] = useState<State | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [activeRule, setActiveRule] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const strips = useRef(new Map<string, HTMLCanvasElement>());
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    loadProfiles().then(setState).catch(onError);
    // Qué regla manda ahora (las evalúa useLightRules).
    const id = window.setInterval(() => setActiveRule(activeRuleId()), 1000);
    setActiveRule(activeRuleId());
    return () => clearInterval(id);
  }, []);

  // Vista previa de cada perfil: el efecto de sus ventiladores en una tira.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      for (const [id, canvas] of strips.current) {
        const profile = stateRef.current?.profiles.find((p) => p.id === id);
        const effect = profile?.scene.groups.find((g) => g.category === "fans")?.effect ?? profile?.scene.groups[0]?.effect;
        const g = canvas.getContext("2d");
        if (!effect || !g) continue;
        const n = 24;
        for (let i = 0; i < n; i++) {
          g.fillStyle = rgbCss(effectColor(effect, `perfil-${id}`, i / n, i, n, t).map((x) => (x * effect.brightness) / 100));
          g.fillRect((i * canvas.width) / n, 0, canvas.width / n - 1, canvas.height);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  async function update(next: State) {
    setState(next);
    await saveProfiles(next);
  }

  if (!state) return <p className="lights-loading">Cargando perfiles…</p>;
  const slots = favoriteSlots(state.profiles);

  const saveCurrent = async (name: string) => {
    const profile: Profile = {
      id: newId(),
      name: name.trim() || `Perfil ${state.profiles.length + 1}`,
      scene: await withStripsSnapshot(scene),
      favorite: false,
    };
    await update({ ...state, profiles: [...state.profiles, profile], activeProfileId: profile.id });
    setNewName(null);
  };

  const setRules = (rules: Rule[]) => update({ ...state, rules });
  const setRule = (id: string, patch: Partial<Rule>) => setRules(state.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const moveRule = (i: number, d: number) => {
    const rules = [...state.rules];
    const [r] = rules.splice(i, 1);
    rules.splice(i + d, 0, r);
    setRules(rules);
  };

  async function doExport() {
    try {
      const path = await save({ defaultPath: "luces-miku.json", filters: [{ name: "Respaldo de luces", extensions: ["json"] }] });
      if (!path) return;
      await invoke("luces_exportar", { ruta: path, contenido: exportJson(state!) });
      setNotice(`Guardado: ${state!.profiles.length} perfiles y ${state!.rules.length} reglas.`);
    } catch (err) {
      onError(err);
    }
  }

  async function doImport() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "Respaldo de luces", extensions: ["json"] }] });
      if (!path || Array.isArray(path)) return;
      const result = await importJson(await invoke<string>("luces_importar", { ruta: path }));
      setState(await loadProfiles());
      setNotice(`Importados: ${result.profiles} perfiles y ${result.rules} reglas.`);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <div className="lights-profiles">
      {notice && (
        <div className="lights-notice" role="status">
          {notice}
          <button className="m-btn m-btn-small" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}

      <section className="lights-module">
        <div className="lights-editor-head">
          <span className="lights-module-title">
            <span className="lights-n">01</span>PERFILES
          </span>
          <div className="lights-zone-actions">
            {newName === null ? (
              <button className="m-btn m-btn-small m-btn-primary" onClick={() => setNewName("")}>
                Guardar escena actual
              </button>
            ) : (
              <>
                <input
                  className="lights-hex lights-name-input"
                  autoFocus
                  placeholder="Nombre del perfil"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveCurrent(newName);
                    if (e.key === "Escape") setNewName(null);
                  }}
                  aria-label="Nombre del perfil"
                />
                <button className="m-btn m-btn-small m-btn-primary" onClick={() => saveCurrent(newName)}>
                  Guardar
                </button>
                <button className="m-btn m-btn-small" onClick={() => setNewName(null)}>
                  Cancelar
                </button>
              </>
            )}
            <button className="m-btn m-btn-small" onClick={doImport}>
              Importar
            </button>
            <button className="m-btn m-btn-small" onClick={doExport} disabled={state.profiles.length === 0 && state.rules.length === 0}>
              Exportar
            </button>
          </div>
        </div>

        {state.profiles.length === 0 ? (
          <div className="m-empty">
            <p className="m-empty-title">Sin perfiles todavía</p>
            <p className="m-empty-text">Arma una escena que te guste en la pestaña Escena y guárdala acá con un nombre.</p>
          </div>
        ) : (
          <div className="lights-profile-grid">
            {state.profiles.map((p) => {
              const slot = slots.findIndex((s) => s.id === p.id);
              const active = state.activeProfileId === p.id;
              return (
                <div key={p.id} className={`lights-profile ${active ? "active" : ""} ${p.by === "miku" ? "by-miku" : ""}`}>
                  <canvas
                    ref={(el) => {
                      if (el) strips.current.set(p.id, el);
                      else strips.current.delete(p.id);
                    }}
                    width={240}
                    height={40}
                    aria-hidden="true"
                  />
                  {renaming?.id === p.id ? (
                    <input
                      className="lights-hex lights-name-input"
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                      onBlur={() => {
                        update({
                          ...state,
                          profiles: state.profiles.map((x) => (x.id === p.id ? { ...x, name: renaming.name.trim() || x.name } : x)),
                        });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      aria-label="Nuevo nombre"
                    />
                  ) : (
                    <span
                      className="lights-profile-name"
                      onDoubleClick={() => setRenaming({ id: p.id, name: p.name })}
                      title="Doble clic para renombrar"
                    >
                      {p.name}
                    </span>
                  )}
                  <span className="lights-profile-meta">
                    {p.by === "miku" ? "DISEÑADO POR ELLA" : slot >= 0 ? `CTRL+ALT+${slot + 1}` : active ? "EN USO" : " "}
                  </span>
                  <ProfileStrips scene={p.scene} />
                  <button
                    className={`lights-star ${p.favorite ? "on" : ""}`}
                    onClick={() =>
                      update({ ...state, profiles: state.profiles.map((x) => (x.id === p.id ? { ...x, favorite: !x.favorite } : x)) })
                    }
                    aria-pressed={p.favorite}
                    aria-label={p.favorite ? "Quitar de favoritos" : "Marcar como favorito"}
                    title={p.favorite ? "Favorito (Ctrl+Alt y la bandeja)" : "Marcar como favorito"}
                  >
                    {p.favorite ? "★" : "☆"}
                  </button>
                  <div className="lights-profile-actions">
                    <button
                      className={`m-btn m-btn-small ${active ? "" : "m-btn-primary"}`}
                      onClick={async () => {
                        await applyProfile(p);
                        setState(await loadProfiles());
                        onApplied();
                      }}
                    >
                      {active ? "Volver a aplicar" : "Aplicar"}
                    </button>
                    <button
                      className="m-btn m-btn-small"
                      onClick={async () => {
                        await applyProfile(p);
                        setState(await loadProfiles());
                        onEdit(p);
                      }}
                      title="Lo pone y te lleva a la pestaña Escena para cambiarlo"
                    >
                      Editar
                    </button>
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={async () => {
                        const next = await withStripsSnapshot(scene);
                        await update({ ...state, profiles: state.profiles.map((x) => (x.id === p.id ? { ...x, scene: next } : x)) });
                        setNotice(`«${p.name}» ahora tiene la escena actual.`);
                      }}
                      aria-label={`Reemplazar ${p.name} con la escena actual`}
                      title="Reemplazarlo con la escena actual"
                    >
                      ⟳
                    </button>
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={() =>
                        update({
                          ...state,
                          profiles: [...state.profiles, { ...p, id: newId(), name: `${p.name} (copia)`, favorite: false, by: undefined }],
                        })
                      }
                      aria-label={`Duplicar ${p.name}`}
                      title="Duplicar"
                    >
                      ⧉
                    </button>
                    <button
                      className="m-btn m-btn-small m-btn-icon"
                      onClick={() => setConfirmDelete(p)}
                      aria-label={`Borrar ${p.name}`}
                      title="Borrar"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="lights-module">
        <div className="lights-editor-head">
          <span className="lights-module-title">
            <span className="lights-n">02</span>AUTOMÁTICO
          </span>
          <button
            className="m-btn m-btn-small"
            onClick={() =>
              setRules([
                ...state.rules,
                { id: newId(), when: { kind: "game", match: "" }, then: { kind: "brightness", value: 100 }, enabled: true },
              ])
            }
          >
            + Regla
          </button>
        </div>
        <span className="lights-hint-small lights-left">
          Se miran de arriba hacia abajo: la primera que se cumple manda. Tu escena vuelve sola cuando ninguna se cumple.
          {activeRule && state.rules.some((r) => r.id === activeRule) && (
            <>
              {" "}
              <b className="lights-pink">Ahora manda: {describeWhen(state.rules.find((r) => r.id === activeRule)!.when)}.</b>
            </>
          )}
        </span>
        {state.rules.length === 0 ? (
          <span className="lights-hint-small lights-left">Sin reglas: las luces quedan siempre como las dejes.</span>
        ) : (
          <ol className="lights-rules">
            {state.rules.map((rule, i) => (
              <li key={rule.id} className={`lights-rule ${rule.enabled ? "" : "off"} ${activeRule === rule.id ? "now" : ""}`}>
                <span className="lights-rule-prio">{i + 1}</span>
                <WhenEditor when={rule.when} onChange={(when) => setRule(rule.id, { when })} />
                <span className="lights-rule-arrow">→</span>
                <ThenEditor then={rule.then} profiles={state.profiles} onChange={(then) => setRule(rule.id, { then })} />
                <div className="lights-layer-actions">
                  <button
                    className="m-btn m-btn-small m-btn-icon"
                    onClick={() => moveRule(i, -1)}
                    disabled={i === 0}
                    aria-label="Subir la regla"
                    title="Más prioridad"
                  >
                    ↑
                  </button>
                  <button
                    className="m-btn m-btn-small m-btn-icon"
                    onClick={() => moveRule(i, 1)}
                    disabled={i === state.rules.length - 1}
                    aria-label="Bajar la regla"
                    title="Menos prioridad"
                  >
                    ↓
                  </button>
                  <button
                    className={`lights-switch lights-switch-small ${rule.enabled ? "on" : ""}`}
                    onClick={() => setRule(rule.id, { enabled: !rule.enabled })}
                    aria-pressed={rule.enabled}
                    aria-label={rule.enabled ? "Desactivar la regla" : "Activar la regla"}
                    title={`${describeWhen(rule.when)} → ${describeThen(rule.then, state.profiles)}`}
                  >
                    <span className="lights-switch-knob" />
                  </button>
                  <button
                    className="m-btn m-btn-small m-btn-icon"
                    onClick={() => setRules(state.rules.filter((r) => r.id !== rule.id))}
                    aria-label="Quitar la regla"
                    title="Quitar"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="lights-module">
        <div className="lights-editor-head">
          <span className="lights-module-title">
            <span className="lights-n">03</span>AL CERRAR MIKU
          </span>
          <div className="lights-seg">
            <button className={global.exitMode !== "off" ? "on" : ""} onClick={() => onGlobal({ ...global, exitMode: "static" })}>
              Color fijo de la escena
            </button>
            <button className={global.exitMode === "off" ? "on" : ""} onClick={() => onGlobal({ ...global, exitMode: "off" })}>
              Apagadas
            </button>
          </div>
        </div>
        <span className="lights-hint-small lights-left">Al suspender o apagar Windows se apagan siempre, y vuelven al despertar.</span>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="¿Borrar este perfil?"
          confirmLabel="Borrar"
          tone="danger"
          onConfirm={() => {
            const id = confirmDelete.id;
            update({
              ...state,
              profiles: state.profiles.filter((p) => p.id !== id),
              activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
            });
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="m-dialog-quote">{confirmDelete.name}</p>
          <p className="m-dialog-text">
            {state.rules.some((r) => r.then.kind === "profile" && r.then.profileId === confirmDelete.id)
              ? "Hay reglas que lo usan: van a quedar sin perfil hasta que elijas otro. No se puede deshacer."
              : "No se puede deshacer."}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

// Cómo quedan las tiras del teclado con ese perfil (si las toca).
function ProfileStrips({ scene }: { scene: Scene }) {
  const s = resolveStrips(scene);
  if (!s) return null;
  const off = s.bottom.mode === 0 && s.top.mode === 0;
  const dot = s.bottom.mode === 3 || s.bottom.mode === 4 ? STRIP_COLORS[s.bottom.color]?.hex : null;
  return (
    <span className="lights-profile-strips" title="Tiras del teclado">
      <span className={`lights-strip-dot ${dot ? "" : off ? "off" : "rainbow"}`} style={dot ? { background: dot } : undefined} />
      {off ? "Tiras apagadas" : `Tiras: ${describeStrips(s).toLowerCase()}`}
    </span>
  );
}

function WhenEditor({ when, onChange }: { when: RuleWhen; onChange: (when: RuleWhen) => void }) {
  return (
    <div className="lights-rule-part">
      <select
        className="lights-select"
        value={when.kind}
        onChange={(e) => onChange(defaultWhen(e.target.value as RuleWhen["kind"]))}
        aria-label="Cuándo"
      >
        {WHEN_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
      {when.kind === "game" && (
        <input
          className="lights-hex lights-rule-input"
          placeholder="cualquier juego"
          value={when.match}
          onChange={(e) => onChange({ ...when, match: e.target.value })}
          aria-label="Nombre del juego (vacío = cualquiera)"
          title="Parte del nombre del juego, por ejemplo VALORANT. Vacío = cualquier juego."
        />
      )}
      {when.kind === "schedule" && (
        <>
          <input
            className="lights-hex lights-time"
            type="time"
            value={when.from}
            onChange={(e) => onChange({ ...when, from: e.target.value })}
            aria-label="Desde"
          />
          <input
            className="lights-hex lights-time"
            type="time"
            value={when.to}
            onChange={(e) => onChange({ ...when, to: e.target.value })}
            aria-label="Hasta"
          />
        </>
      )}
      {when.kind === "away" && (
        <>
          <input
            className="lights-hex lights-num"
            type="number"
            min={1}
            max={240}
            value={when.minutes}
            onChange={(e) => onChange({ ...when, minutes: Math.max(1, Number(e.target.value) || 1) })}
            aria-label="Minutos"
          />
          <span className="lights-hint-small">min</span>
        </>
      )}
    </div>
  );
}

function ThenEditor({ then, profiles, onChange }: { then: RuleThen; profiles: Profile[]; onChange: (then: RuleThen) => void }) {
  const value = then.kind === "profile" ? `profile:${then.profileId}` : then.kind;
  return (
    <div className="lights-rule-part">
      <select
        className="lights-select"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "off") onChange({ kind: "off" });
          else if (v === "brightness") onChange({ kind: "brightness", value: 20 });
          else onChange({ kind: "profile", profileId: v.slice("profile:".length) });
        }}
        aria-label="Qué hacer"
      >
        <option value="brightness">Bajar el brillo</option>
        <option value="off">Apagar</option>
        {profiles.map((p) => (
          <option key={p.id} value={`profile:${p.id}`}>
            Perfil: {p.name}
          </option>
        ))}
      </select>
      {then.kind === "brightness" && (
        <>
          <input
            className="lights-hex lights-num"
            type="number"
            min={0}
            max={100}
            value={then.value}
            onChange={(e) => onChange({ kind: "brightness", value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            aria-label="Brillo máximo"
          />
          <span className="lights-hint-small">%</span>
        </>
      )}
    </div>
  );
}
