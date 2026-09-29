// Google Maps URLs (developers.google.com/maps/documentation/urls): no
// necesitan clave. En la PC abren Maps en el navegador; en el celular, la
// app de Maps. Misma construcción que MapsUrl.kt de Android.

export type MapAction = "buscar" | "ruta" | "navegar";
export type TravelMode = "auto" | "caminando" | "bicicleta" | "transporte_publico" | "moto";

export const MAP_ACTIONS: MapAction[] = ["buscar", "ruta", "navegar"];
export const TRAVEL_MODES: TravelMode[] = ["auto", "caminando", "bicicleta", "transporte_publico", "moto"];

const MODE_PARAM: Record<TravelMode, string> = {
  auto: "driving",
  caminando: "walking",
  bicicleta: "bicycling",
  transporte_publico: "transit",
  moto: "two-wheeler",
};

// Sin origen, Maps usa la ubicación actual del dispositivo.
export function buildMapsUrl(action: MapAction, destination: string, origin?: string, mode?: TravelMode): string {
  const params = new URLSearchParams({ api: "1" });
  if (action === "buscar") {
    params.set("query", destination);
    return `https://www.google.com/maps/search/?${params}`;
  }
  if (origin) params.set("origin", origin);
  params.set("destination", destination);
  if (mode) params.set("travelmode", MODE_PARAM[mode]);
  if (action === "navegar") params.set("dir_action", "navigate");
  return `https://www.google.com/maps/dir/?${params}`;
}
