import { ToolDefinition } from "./types";
import { deviceTitle, listDevices, paintDevices, zoneLabel } from "../lights";

const ACCIONES = ["listar", "color", "apagar"] as const;

// Luces RGB de la PC (2026-10-21, pedido de Sebastián) a través del
// servidor de OpenRGB, con un cliente propio del protocolo (ver
// openrgb.rs y lib/lights.ts, que guarda el color para que vuelva al
// prender la PC). Por ahora color fijo; los efectos van después.
export const controlarLuces: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "controlar_luces",
      description:
        "Controla las luces RGB de la PC de Sebastián (la RAM, el micrófono y lo que detecte OpenRGB). Puede listar los dispositivos, ponerlos de un color o apagarlos.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: [...ACCIONES],
            description:
              "'listar' dice qué dispositivos hay, con su número. 'color' los pone del color de 'color'. 'apagar' los apaga.",
          },
          color: {
            type: "string",
            description: "Para 'color': el color en hexadecimal, por ejemplo \"#39C5BB\".",
          },
          dispositivos: {
            type: "array",
            items: { type: "number" },
            description:
              "Números de los dispositivos (los que da 'listar') a los que aplicar 'color' o 'apagar'. Si lo omites, se aplica a todos.",
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

      let hex = "#000000";
      if (accion === "color") {
        const match = String(args.color ?? "").trim().match(/^#?([0-9a-f]{6})$/i);
        if (!match) return `Error: "${args.color}" no es un color hexadecimal como "#39C5BB".`;
        hex = `#${match[1]}`;
      }
      const changed = await paintDevices(hex, dispositivos);
      if (changed.length === 0) return "No había ningún dispositivo con esos números.";
      return `${accion === "apagar" ? "Apagados" : "Cambiados"}: ${changed.join(", ")}.`;
    } catch (err) {
      return `Error con las luces: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
