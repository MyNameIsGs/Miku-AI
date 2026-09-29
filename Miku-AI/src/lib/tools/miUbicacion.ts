import { invoke } from "@tauri-apps/api/core";
import { ToolDefinition } from "./types";

// Google Maps, paso 2 (2026-09-28): dónde está la PC, con la ubicación de
// Windows (ver src-tauri/src/location.rs; no por IP, que con la VPN de
// Sebastián da Estados Unidos). Misma tool que MiUbicacion.kt de Android.
type Ubicacion = { latitud: number; longitud: number; precision_m: number; direccion: string | null };

export const miUbicacion: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "mi_ubicacion",
      description:
        "Dónde está Sebastián ahora (la PC): dirección aproximada y coordenadas, con la ubicación de Windows. Úsala cuando haga falta saber dónde está (\"¿dónde estoy?\", \"cerca de mí\", el origen de un viaje).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  execute: async () => {
    try {
      const u = await invoke<Ubicacion>("mi_ubicacion");
      const coords = `${u.latitud.toFixed(5)}, ${u.longitud.toFixed(5)}`;
      const lugar = u.direccion ? `Sebastián está en: ${u.direccion}.` : "No pude pasarla a una dirección.";
      return `${lugar} Coordenadas: ${coords} (precisión ~${Math.round(u.precision_m)} m). Para abrir_mapa puedes usar las coordenadas como origen.`;
    } catch (err) {
      return `Error al obtener la ubicación: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
