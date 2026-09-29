import { openUrl } from "@tauri-apps/plugin-opener";
import { ToolDefinition } from "./types";
import { buildMapsUrl, MAP_ACTIONS, MapAction, TRAVEL_MODES, TravelMode } from "../mapsUrl";

// Google Maps, paso 1 (2026-09-28): abre un lugar, una ruta o la
// navegación con Maps URLs (sin clave). Misma tool que en Android.
export const abrirMapa: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "abrir_mapa",
      description:
        "Abre Google Maps para mostrarle a Sebastián un lugar, una ruta o iniciar la navegación. Solo abre el mapa: no te devuelve información del lugar ni del viaje.",
      parameters: {
        type: "object",
        properties: {
          accion: {
            type: "string",
            enum: MAP_ACTIONS,
            description:
              "buscar = mostrar un lugar o una búsqueda en el mapa; ruta = mostrar el recorrido hasta un destino; navegar = empezar la navegación paso a paso.",
          },
          destino: {
            type: "string",
            description: "El lugar, dirección o búsqueda (\"farmacias\", \"Plaza Venezuela, Caracas\").",
          },
          origen: {
            type: "string",
            description: "Opcional. Desde dónde. Si no lo dijo, no lo pongas: Maps usa la ubicación actual.",
          },
          modo: {
            type: "string",
            enum: TRAVEL_MODES,
            description: "Opcional, para ruta o navegar. Cómo va a ir.",
          },
        },
        required: ["accion", "destino"],
      },
    },
  },
  execute: async (args) => {
    const action = String(args.accion ?? "") as MapAction;
    const destination = String(args.destino ?? "").trim();
    if (!MAP_ACTIONS.includes(action)) return `Error: acción desconocida "${args.accion}".`;
    if (!destination) return "Error: no se especificó el destino.";
    const origin = args.origen ? String(args.origen).trim() : undefined;
    const mode = TRAVEL_MODES.includes(args.modo as TravelMode) ? (args.modo as TravelMode) : undefined;

    try {
      await openUrl(buildMapsUrl(action, destination, origin || undefined, mode));
      const what = action === "buscar" ? `"${destination}"` : `la ruta a "${destination}"`;
      return `Abrí Google Maps con ${what} en el navegador de la PC.${action === "navegar" ? " (En la PC no hay navegación paso a paso: queda la ruta.)" : ""}`;
    } catch (err) {
      return `Error al abrir Google Maps: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
