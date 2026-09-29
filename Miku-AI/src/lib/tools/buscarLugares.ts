import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";
import { formatPlaces, NEARBY_RADIUS_M, PLACES_FIELD_MASK, PLACES_MAX_RESULTS } from "../places";

// Google Maps, paso 3: busca lugares reales (Places API New). La clave va
// en .env (VITE_GOOGLE_MAPS_API_KEY), nunca en el código: el repo es público.
export const buscarLugares: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "buscar_lugares",
      description:
        "Busca lugares reales en Google Maps (negocios, restaurantes, farmacias, direcciones) y te devuelve nombre, dirección, valoración, si está abierto ahora, el horario de hoy y el teléfono. Úsala para responder sobre lugares; para mostrárselos en el mapa, después usa abrir_mapa.",
      parameters: {
        type: "object",
        properties: {
          consulta: {
            type: "string",
            description: "Qué buscar, como en Google Maps (\"farmacia 24 horas\", \"Farmatodo Altamira\", \"pizzería\").",
          },
          cerca_de_mi: {
            type: "boolean",
            description: "true si lo quiere cerca de donde está ahora (\"cerca de mí\", \"por aquí\"). Si la consulta ya dice dónde, no hace falta.",
          },
        },
        required: ["consulta"],
      },
    },
  },
  execute: async (args) => {
    const query = String(args.consulta ?? "").trim();
    if (!query) return "Error: no se especificó qué buscar.";
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) return "Error: falta la clave de Google Maps (VITE_GOOGLE_MAPS_API_KEY en .env).";

    const body: Record<string, unknown> = { textQuery: query, languageCode: "es", maxResultCount: PLACES_MAX_RESULTS };
    let nearbyNote = "";
    if (args.cerca_de_mi === true) {
      try {
        const u = await invoke<{ latitud: number; longitud: number }>("mi_ubicacion");
        body.locationBias = {
          circle: { center: { latitude: u.latitud, longitude: u.longitud }, radius: NEARBY_RADIUS_M },
        };
      } catch (err) {
        nearbyNote = `\n(No pude saber dónde está Sebastián: ${err instanceof Error ? err.message : String(err)}. Los resultados no están ordenados por cercanía.)`;
      }
    }

    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACES_FIELD_MASK },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        return `Error al buscar lugares: Google respondió ${response.status}: ${data?.error?.message ?? "sin detalle"}`;
      }
      return formatPlaces(data?.places, query, new Date()) + nearbyNote;
    } catch (err) {
      return `Error al buscar lugares: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
