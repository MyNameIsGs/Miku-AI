import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { TRAVEL_MODES, TravelMode } from "../mapsUrl";
import { buildRoutesBody, formatRoute, ROUTES_FIELD_MASK, Waypoint } from "../routes";

// Google Maps, paso 4: cuánto tarda en llegar (Routes API), con el tráfico
// de ahora en auto y moto. Sin origen, desde donde está (mi_ubicacion).
export const tiempoDeViaje: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "tiempo_de_viaje",
      description:
        "Calcula cuánto tarda Sebastián en llegar a un lugar y a qué distancia está, con el tráfico de ahora si va en auto o moto. Para mostrarle la ruta en el mapa, usa abrir_mapa.",
      parameters: {
        type: "object",
        properties: {
          destino: { type: "string", description: "Adónde va (dirección o lugar)." },
          origen: {
            type: "string",
            description: "Opcional. Desde dónde. Si no lo dijo, no lo pongas: se usa donde está ahora.",
          },
          modo: { type: "string", enum: TRAVEL_MODES, description: "Cómo va a ir. Por defecto, auto." },
        },
        required: ["destino"],
      },
    },
  },
  execute: async (args) => {
    const destination = String(args.destino ?? "").trim();
    if (!destination) return "Error: no se especificó el destino.";
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) return "Error: falta la clave de Google Maps (VITE_GOOGLE_MAPS_API_KEY en .env).";
    const mode: TravelMode = TRAVEL_MODES.includes(args.modo as TravelMode) ? (args.modo as TravelMode) : "auto";

    let origin: Waypoint;
    const originText = args.origen ? String(args.origen).trim() : "";
    if (originText) {
      origin = { address: originText };
    } else {
      try {
        const u = await invoke<{ latitud: number; longitud: number }>("mi_ubicacion");
        origin = { lat: u.latitud, lng: u.longitud };
      } catch (err) {
        return `Error: no sé desde dónde sale Sebastián (${err instanceof Error ? err.message : String(err)}). Pregúntale el origen.`;
      }
    }

    try {
      const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTES_FIELD_MASK },
        body: JSON.stringify(buildRoutesBody(origin, destination, mode)),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return `Error al calcular el viaje: Google respondió ${response.status}: ${data?.error?.message ?? "sin detalle"}`;
      }
      return formatRoute(data, destination, mode);
    } catch (err) {
      return `Error al calcular el viaje: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
