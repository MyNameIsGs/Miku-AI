import { ToolDefinition } from "./types";
import {
  EFFECT_KINDS,
  EFFECT_NAMES,
  EffectKind,
  applyToDevices,
  deviceTitle,
  listDevices,
  loadLightsState,
  makeEffect,
  setGlobal,
  zoneLabel,
} from "../lights";

const ACCIONES = ["listar", "color", "efecto", "brillo", "apagar", "prender"] as const;

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
        "Controla las luces RGB de la PC de Sebastián (placa y ventilador, RAM, teclado, micrófono). Puede listar los dispositivos, ponerles un color fijo o un efecto animado, cambiar el brillo general, apagarlas o prenderlas.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "'listar' dice qué dispositivos hay, con su número. 'color' pone un color fijo. 'efecto' pone un efecto animado. 'brillo' cambia el brillo general. 'apagar' apaga todo y 'prender' lo vuelve a prender como estaba.",
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
