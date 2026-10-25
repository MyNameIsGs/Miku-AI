import { ToolDefinition } from "./types";
import {
  EFFECT_KINDS,
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
  readStrips,
  setGlobal,
  setScene,
  zoneLabel,
} from "../lights";

const ACCIONES = ["listar", "color", "efecto", "brillo", "apagar", "prender", "tiras"] as const;
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
        "Controla las luces RGB de la PC de Sebastián (placa y ventilador, RAM, teclado, micrófono). Puede listar los dispositivos, ponerles un color fijo o un efecto animado, cambiar el brillo general, apagarlas o prenderlas. Las tiras de luz del teclado van aparte ('tiras'): solo tienen 5 modos y 7 colores propios, y cada cambio hace parpadear el teclado, así que no las cambies seguido.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "'listar' dice qué dispositivos hay, con su número. 'color' pone un color fijo. 'efecto' pone un efecto animado. 'brillo' cambia el brillo general. 'apagar' apaga todo y 'prender' lo vuelve a prender como estaba. 'tiras' cambia las tiras del teclado (modo, color, brillo, velocidad).",
          },
          color: {
            type: "string",
            description: "Para 'color': el color en hexadecimal, por ejemplo \"#39C5BB\".",
          },
          efecto: {
            type: "string",
            enum: [...EFFECT_KINDS],
            description: `Para 'efecto': ${EFFECT_KINDS.map((k) => `'${k}' (${EFFECT_NAMES[k]})`).join(", ")}.`,
          },
          colores: {
            type: "array",
            items: { type: "string" },
            description: "Para 'efecto': uno o más colores en hexadecimal. La ola, el degradado y los destellos usan varios.",
          },
          velocidad: {
            type: "number",
            description: "Para 'efecto': de 1 (muy lento) a 100 (muy rápido); 50 es normal.",
          },
          nivel: {
            type: "number",
            description: "Para 'brillo': de 0 a 100.",
          },
          tira: {
            type: "string",
            enum: [...TIRAS],
            description: "Para 'tiras': 'abajo' (las dos de abajo del teclado), 'arriba' (la de debajo de DEL/END) o 'ambas' (por defecto).",
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
            description:
              "Números de los dispositivos (los que da 'listar') para 'color' o 'efecto'. Si lo omites, se aplica a todos.",
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
    const dispositivos = Array.isArray(args.dispositivos)
      ? args.dispositivos.filter((n): n is number => typeof n === "number")
      : [];

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

      let changed: string[];
      if (accion === "color") {
        const colors = parseColors(args.color);
        if (!colors || colors.length !== 1) return `Error: "${args.color}" no es un color hexadecimal como "#39C5BB".`;
        changed = await applyToDevices(makeEffect("static", colors), dispositivos);
      } else {
        const kind = String(args.efecto ?? "") as EffectKind;
        if (!EFFECT_KINDS.includes(kind)) return `Error: efecto desconocido "${args.efecto}".`;
        const colors = parseColors(args.colores);
        if (!colors) return "Error: algún color de 'colores' no es hexadecimal como \"#39C5BB\".";
        const speed = typeof args.velocidad === "number" ? Math.max(1, Math.min(100, args.velocidad)) : 50;
        changed = await applyToDevices(makeEffect(kind, colors.length > 0 ? colors : ["#39C5BB", "#F0508F"], { speed }), dispositivos);
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
  if (mode === null && color === null && brightness === null && speed === null) return "Error: dime qué cambiar (modo_tira, color_tira, brillo_tira o velocidad_tira).";

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
