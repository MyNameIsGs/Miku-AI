import { ToolDefinition } from "./types";
import {
  CategoryId,
  EFFECT_KINDS,
  Effect,
  MOOD_COLORS,
  EFFECT_NAMES,
  EffectKind,
  KeyboardStrips,
  STRIP_BRIGHTNESS_MAX,
  STRIP_COLORS,
  STRIP_SPEED_MAX,
  STRIP_MODES,
  applyToDevices,
  deviceTitle,
  listDevices,
  loadLightsState,
  makeEffect,
  normalizeScene,
  readStrips,
  setGlobal,
  setScene,
  withCategoryEffect,
  zoneLabel,
} from "../lights";
import { Profile, applyProfile, loadProfiles, newId, saveProfiles } from "../lightProfiles";
import { deleteMikuEffect, findMikuEffect, loadMikuLights, saveMikuEffect, setMikuMoodColor } from "../mikuLights";

const ACCIONES = [
  "listar",
  "color",
  "efecto",
  "brillo",
  "apagar",
  "prender",
  "tiras",
  "perfil",
  "guardar_perfil",
  "crear_efecto",
  "usar_efecto",
  "borrar_efecto",
  "color_animo",
] as const;
const GRUPOS: Record<string, CategoryId | "all"> = { todo: "all", ventiladores: "fans", ram: "ram", placa: "board", perifericos: "periph" };
const ANIMOS = Object.keys(MOOD_COLORS);
const TIRAS = ["abajo", "arriba", "ambas"] as const;
const MODOS_TIRA = STRIP_MODES.map((m) => m.toLowerCase());
const COLORES_TIRA = STRIP_COLORS.map((c) => c.name.toLowerCase());

const HEX = /^#?([0-9a-f]{6})$/i;

function parseColors(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const colors: string[] = [];
  for (const item of list) {
    const match = String(item).trim().match(HEX);
    if (!match) return null;
    colors.push(`#${match[1].toUpperCase()}`);
  }
  return colors;
}

// Luces RGB de la PC a través del servicio de OpenRGB (cliente propio del
// protocolo en openrgb.rs). Los efectos los dibuja el motor en Rust
// (lights_engine.rs); lo que pone Miku queda guardado como escena
// (lib/lights.ts) y vuelve al prender la PC.
export const controlarLuces: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "controlar_luces",
      description:
        "Controla las luces RGB de la PC de Sebastián (placa y ventilador, RAM, teclado, micrófono). Puede listar los dispositivos, ponerles un color fijo o un efecto animado (a todo o a un grupo), cambiar el brillo general, apagarlas o prenderlas, poner o guardar perfiles, diseñar tus propios efectos con nombre (quedan en la galería del panel como tuyos) y elegir el color de cada ánimo tuyo para el efecto «Su ánimo». Las tiras de luz del teclado van aparte ('tiras'): solo tienen 5 modos y 7 colores propios, y cada cambio hace parpadear el teclado, así que no las cambies seguido.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "'listar' dice qué dispositivos hay, con su número. 'color' pone un color fijo. 'efecto' pone un efecto animado. 'brillo' cambia el brillo general. 'apagar' apaga todo y 'prender' lo vuelve a prender como estaba. 'tiras' cambia las tiras del teclado (modo, color, brillo, velocidad). 'perfil' pone un perfil guardado por su nombre. 'guardar_perfil' guarda las luces de ahora como un perfil tuyo. 'crear_efecto' diseña un efecto tuyo (nombre, descripcion, efecto y sus parámetros), lo guarda y lo pone para que se vea. 'usar_efecto' pone uno tuyo por su nombre. 'borrar_efecto' borra uno tuyo. 'color_animo' elige el color de uno de tus ánimos.",
          },
          color: {
            type: "string",
            description: "Para 'color' y 'color_animo': el color en hexadecimal, por ejemplo \"#39C5BB\".",
          },
          efecto: {
            type: "string",
            enum: [...EFFECT_KINDS],
            description: `Para 'efecto' y 'crear_efecto': ${EFFECT_KINDS.map((k) => `'${k}' (${EFFECT_NAMES[k]})`).join(", ")}.`,
          },
          colores: {
            type: "array",
            items: { type: "string" },
            description:
              "Para 'efecto' y 'crear_efecto': uno o más colores en hexadecimal. La ola, el degradado y los destellos usan varios.",
          },
          velocidad: {
            type: "number",
            description: "Para 'efecto' y 'crear_efecto': de 1 (muy lento) a 100 (muy rápido); 50 es normal.",
          },
          grupo: {
            type: "string",
            enum: Object.keys(GRUPOS),
            description:
              "Para 'color', 'efecto', 'crear_efecto' y 'usar_efecto': a qué grupo del panel. Si lo omites (y no das 'dispositivos'), va a todo.",
          },
          brillo_grupo: {
            type: "number",
            description: "Para 'efecto' y 'crear_efecto': brillo propio de ese efecto, de 0 a 100 (100 por defecto).",
          },
          tamano: {
            type: "number",
            description:
              "Para 'efecto' y 'crear_efecto': de 1 a 100; ancho de la ola, largo de la estela del cometa, cantidad de destellos.",
          },
          variante: {
            type: "string",
            enum: ["golpe", "vumetro", "espectro", "juegos"],
            description:
              "Para 'efecto' y 'crear_efecto': con 'music', 'golpe' (pulsa con el ritmo), 'vumetro' (se llena con el volumen) o 'espectro' (graves a agudos); con 'screen', 'juegos' = solo mientras hay un juego.",
          },
          direccion: {
            type: "string",
            enum: ["izquierda", "derecha"],
            description: "Para 'efecto' y 'crear_efecto': hacia dónde corre la ola, el cometa o el arcoíris.",
          },
          nombre: {
            type: "string",
            description: "Para 'perfil', 'guardar_perfil', 'crear_efecto', 'usar_efecto' y 'borrar_efecto': el nombre.",
          },
          descripcion: {
            type: "string",
            description: "Para 'crear_efecto': cómo es, en pocas palabras (se ve en el panel).",
          },
          animo: {
            type: "string",
            enum: ANIMOS,
            description: "Para 'color_animo': cuál de tus ánimos (con 'color').",
          },
          nivel: {
            type: "number",
            description: "Para 'brillo': de 0 a 100.",
          },
          tira: {
            type: "string",
            enum: [...TIRAS],
            description:
              "Para 'tiras': 'abajo' (las dos de abajo del teclado), 'arriba' (la de debajo de DEL/END) o 'ambas' (por defecto).",
          },
          modo_tira: {
            type: "string",
            enum: MODOS_TIRA,
            description: "Para 'tiras': el modo. 'sólido' y 'respirar' usan color_tira; los arcoíris no.",
          },
          color_tira: {
            type: "string",
            enum: COLORES_TIRA,
            description: "Para 'tiras': uno de los 7 colores que tienen.",
          },
          brillo_tira: {
            type: "number",
            description: `Para 'tiras' (solo las de abajo): de 0 (tenue) a ${STRIP_BRIGHTNESS_MAX} (máximo).`,
          },
          velocidad_tira: {
            type: "number",
            description: `Para 'tiras' (solo las de abajo): de 0 (lenta) a ${STRIP_SPEED_MAX} (rápida).`,
          },
          dispositivos: {
            type: "array",
            items: { type: "number" },
            description: "Números de los dispositivos (los que da 'listar') para 'color' o 'efecto'. Si lo omites, se aplica a todos.",
          },
        },
        required: ["accion"],
      },
    },
  },
  execute: async (args) => {
    const accion = String(args.accion ?? "");
    if (!ACCIONES.includes(accion as (typeof ACCIONES)[number])) {
      return `Error: acción de luces desconocida "${accion}".`;
    }
    const dispositivos = Array.isArray(args.dispositivos) ? args.dispositivos.filter((n): n is number => typeof n === "number") : [];

    try {
      if (accion === "listar") {
        const devices = await listDevices();
        if (devices.length === 0) return "OpenRGB está abierto pero no detectó ningún dispositivo con luces.";
        return devices
          .map((d) => {
            const zones = d.zones.map((z) => `${zoneLabel(z)} (${z.leds})`).join(", ");
            return `${d.index}: ${deviceTitle(d, devices)} (${d.kind}, ${d.leds} LEDs: ${zones})`;
          })
          .join("\n");
      }

      if (accion === "tiras") return await changeStrips(args);

      if (accion === "brillo" || accion === "apagar" || accion === "prender") {
        const { global } = await loadLightsState();
        if (accion === "brillo") {
          const nivel = Number(args.nivel);
          if (Number.isNaN(nivel)) return "Error: falta 'nivel' (0 a 100).";
          await setGlobal({ ...global, on: true, brightness: Math.max(0, Math.min(100, Math.round(nivel))) });
          return `Brillo general en ${Math.max(0, Math.min(100, Math.round(nivel)))}%.`;
        }
        await setGlobal({ ...global, on: accion === "prender" });
        return accion === "apagar" ? "Luces apagadas." : "Luces prendidas.";
      }

      if (accion === "perfil" || accion === "guardar_perfil") return await profileAction(accion, args);
      if (accion === "crear_efecto" || accion === "usar_efecto" || accion === "borrar_efecto") return await ownEffectAction(accion, args);
      if (accion === "color_animo") {
        const animo = String(args.animo ?? "");
        const colors = parseColors(args.color);
        if (!ANIMOS.includes(animo)) return `Error: ánimo desconocido "${args.animo}". Opciones: ${ANIMOS.join(", ")}.`;
        if (!colors || colors.length !== 1) return `Error: "${args.color}" no es un color hexadecimal como "#39C5BB".`;
        await setMikuMoodColor(animo, colors[0]);
        return `Listo: cuando estés ${animo}, el efecto "Su ánimo" usa ${colors[0]}.`;
      }

      let effect: Effect;
      if (accion === "color") {
        const colors = parseColors(args.color);
        if (!colors || colors.length !== 1) return `Error: "${args.color}" no es un color hexadecimal como "#39C5BB".`;
        effect = makeEffect("static", colors);
      } else {
        const built = effectFromArgs(args);
        if (typeof built === "string") return built;
        effect = built;
      }
      const grupo = args.grupo === undefined ? null : GRUPOS[String(args.grupo)];
      if (args.grupo !== undefined && !grupo) return `Error: grupo desconocido "${args.grupo}".`;
      let changed: string[];
      if (grupo || dispositivos.length === 0) {
        await applyToGroup(effect, grupo ?? "all");
        changed = [String(args.grupo ?? "todo")];
      } else {
        changed = await applyToDevices(effect, dispositivos);
      }
      if (changed.length === 0) return "No había ningún dispositivo con esos números.";
      // Si estaban apagadas, un color o un efecto nuevo las prende.
      const { global } = await loadLightsState();
      if (!global.on) await setGlobal({ ...global, on: true });
      return `Listo en: ${changed.join(", ")}.`;
    } catch (err) {
      return `Error con las luces: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

async function changeStrips(args: Record<string, unknown>): Promise<string> {
  const tira = TIRAS.includes(args.tira as (typeof TIRAS)[number]) ? (args.tira as (typeof TIRAS)[number]) : "ambas";
  const mode = args.modo_tira === undefined ? null : MODOS_TIRA.indexOf(String(args.modo_tira).toLowerCase());
  const color = args.color_tira === undefined ? null : COLORES_TIRA.indexOf(String(args.color_tira).toLowerCase());
  if (mode === -1) return `Error: modo de tira desconocido "${args.modo_tira}". Opciones: ${MODOS_TIRA.join(", ")}.`;
  if (color === -1) return `Error: color de tira desconocido "${args.color_tira}". Opciones: ${COLORES_TIRA.join(", ")}.`;
  const level = (v: unknown, max: number) => (typeof v === "number" ? Math.max(0, Math.min(max, Math.round(v))) : null);
  const brightness = level(args.brillo_tira, STRIP_BRIGHTNESS_MAX);
  const speed = level(args.velocidad_tira, STRIP_SPEED_MAX);
  if (mode === null && color === null && brightness === null && speed === null)
    return "Error: dime qué cambiar (modo_tira, color_tira, brillo_tira o velocidad_tira).";

  const state = await loadLightsState();
  const scene = state.scene ?? { groups: [], positions: {} };
  const current: KeyboardStrips = scene.keyboardStrips ?? (await readStrips());
  // Un color elegido por ella manda sobre "seguir a la escena".
  const next: KeyboardStrips = { ...current, follow: color === null ? current.follow : false };
  if (tira !== "arriba") {
    next.bottom = {
      mode: mode ?? current.bottom.mode,
      color: color ?? current.bottom.color,
      brightness: brightness ?? current.bottom.brightness,
      speed: speed ?? current.bottom.speed,
    };
  }
  if (tira !== "abajo") next.top = { mode: mode ?? current.top.mode, color: color ?? current.top.color };
  await setScene({ ...scene, keyboardStrips: next });
  const describe = (m: number, c: number) => `${STRIP_MODES[m]}${m >= 3 ? ` ${STRIP_COLORS[c].name.toLowerCase()}` : ""}`;
  return `Tiras: abajo ${describe(next.bottom.mode, next.bottom.color)}, arriba ${describe(next.top.mode, next.top.color)}.`;
}

// El efecto que piden los argumentos (para 'efecto' y 'crear_efecto'), o
// el error.
function effectFromArgs(args: Record<string, unknown>): Effect | string {
  const kind = String(args.efecto ?? "") as EffectKind;
  if (!EFFECT_KINDS.includes(kind)) return `Error: efecto desconocido "${args.efecto}".`;
  const colors = parseColors(args.colores);
  if (!colors) return "Error: algún color de 'colores' no es hexadecimal como \"#39C5BB\".";
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
  return makeEffect(kind, colors.length > 0 ? colors.slice(0, 6) : ["#39C5BB", "#F0508F"], {
    speed: num(args.velocidad, 1, 100, 50),
    brightness: num(args.brillo_grupo, 0, 100, 100),
    size: num(args.tamano, 1, 100, 40),
    direction: args.direccion === "izquierda" ? -1 : 1,
    mode: args.variante === "vumetro" || args.variante === "espectro" || args.variante === "juegos" ? String(args.variante) : undefined,
  });
}

async function applyToGroup(effect: Effect, group: CategoryId | "all") {
  const [devices, state] = await Promise.all([listDevices(), loadLightsState()]);
  await setScene(withCategoryEffect(normalizeScene(state.scene, devices), group, effect));
  if (!state.global.on) await setGlobal({ ...state.global, on: true });
}

async function profileAction(accion: "perfil" | "guardar_perfil", args: Record<string, unknown>): Promise<string> {
  const name = String(args.nombre ?? "").trim();
  const state = await loadProfiles();
  if (accion === "perfil") {
    const profile = state.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!profile) {
      const names = state.profiles.map((p) => p.name).join(", ");
      return names ? `No hay un perfil "${name}". Los que hay: ${names}.` : "Todavía no hay perfiles guardados.";
    }
    await applyProfile(profile);
    return `Perfil "${profile.name}" puesto.`;
  }
  if (!name) return "Error: falta 'nombre' para el perfil.";
  const { scene } = await loadLightsState();
  if (!scene) return "Todavía no hay una escena de luces para guardar.";
  const existing = state.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
  // Uno de Sebastián con ese nombre no se pisa.
  if (existing && existing.by !== "miku") return `Ya hay un perfil de Sebastián que se llama "${existing.name}": elige otro nombre.`;
  const profile: Profile = { id: existing?.id ?? newId(), name, scene, favorite: existing?.favorite ?? false, by: "miku" };
  await saveProfiles({
    ...state,
    profiles: existing ? state.profiles.map((p) => (p.id === existing.id ? profile : p)) : [...state.profiles, profile],
  });
  return `Guardado el perfil "${name}" (queda como tuyo en la pestaña Perfiles).`;
}

async function ownEffectAction(accion: "crear_efecto" | "usar_efecto" | "borrar_efecto", args: Record<string, unknown>): Promise<string> {
  const name = String(args.nombre ?? "").trim();
  if (!name) return "Error: falta 'nombre' del efecto.";
  const grupo = args.grupo === undefined ? "all" : GRUPOS[String(args.grupo)];
  if (!grupo) return `Error: grupo desconocido "${args.grupo}".`;
  if (accion === "crear_efecto") {
    const effect = effectFromArgs(args);
    if (typeof effect === "string") return effect;
    await saveMikuEffect(name, String(args.descripcion ?? ""), effect);
    await applyToGroup(effect, grupo);
    return `Efecto "${name}" guardado en la galería como tuyo, y puesto en ${args.grupo ?? "todo"} para que se vea.`;
  }
  const mine = await loadMikuLights();
  const own = findMikuEffect(mine, name);
  if (!own) {
    const names = mine.effects.map((e) => e.name).join(", ");
    return names ? `No tienes un efecto "${name}". Los tuyos: ${names}.` : "Todavía no diseñaste ningún efecto.";
  }
  if (accion === "borrar_efecto") {
    await deleteMikuEffect(own.id);
    return `Efecto "${own.name}" borrado.`;
  }
  await applyToGroup(own.effect, grupo);
  return `Puse tu efecto "${own.name}" en ${args.grupo ?? "todo"}.`;
}
