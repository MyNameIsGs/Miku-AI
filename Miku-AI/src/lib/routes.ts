// Google Maps, paso 4 (2026-09-28): cuánto se tarda, con Routes API
// (computeRoutes). Con tráfico (TRAFFIC_AWARE) solo en auto y moto: los
// demás modos no lo aceptan. Misma lógica que TiempoDeViaje.kt de Android.
import { TravelMode } from "./mapsUrl";

export const ROUTES_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.localizedValues";

const ROUTES_MODE: Record<TravelMode, string> = {
  auto: "DRIVE",
  caminando: "WALK",
  bicicleta: "BICYCLE",
  transporte_publico: "TRANSIT",
  moto: "TWO_WHEELER",
};

const MODE_WORDS: Record<TravelMode, string> = {
  auto: "En auto",
  caminando: "Caminando",
  bicicleta: "En bicicleta",
  transporte_publico: "En transporte público",
  moto: "En moto",
};

export type Waypoint = { address: string } | { lat: number; lng: number };

function waypoint(w: Waypoint) {
  return "address" in w ? { address: w.address } : { location: { latLng: { latitude: w.lat, longitude: w.lng } } };
}

export function buildRoutesBody(origin: Waypoint, destination: string, mode: TravelMode) {
  const withTraffic = mode === "auto" || mode === "moto";
  return {
    origin: waypoint(origin),
    destination: { address: destination },
    travelMode: ROUTES_MODE[mode],
    ...(withTraffic ? { routingPreference: "TRAFFIC_AWARE" } : {}),
    languageCode: "es",
  };
}

type RoutesResponse = {
  routes?: {
    duration?: string;
    staticDuration?: string;
    localizedValues?: { distance?: { text?: string }; duration?: { text?: string }; staticDuration?: { text?: string } };
  }[];
};

const seconds = (d?: string) => (d ? parseInt(d, 10) : NaN);

export function formatRoute(data: RoutesResponse | null, destination: string, mode: TravelMode): string {
  const route = data?.routes?.[0];
  if (!route) {
    return mode === "transporte_publico"
      ? `Google no tiene rutas en transporte público para ir a "${destination}" (en muchas ciudades no tiene datos de metro ni autobuses).`
      : `Google no encontró una ruta ${MODE_WORDS[mode].toLowerCase()} hasta "${destination}".`;
  }
  const loc = route.localizedValues;
  let text = `${MODE_WORDS[mode]}: ${loc?.duration?.text ?? "?"} hasta "${destination}" (${loc?.distance?.text ?? "?"})`;
  // Con tráfico, cuánto suma respecto de ir sin tráfico (si es notorio).
  const delay = seconds(route.duration) - seconds(route.staticDuration);
  if ((mode === "auto" || mode === "moto") && delay >= 180) {
    text += `, con el tráfico de ahora; sin tráfico serían ${loc?.staticDuration?.text ?? "menos"}`;
  } else if (mode === "auto" || mode === "moto") {
    text += ", con el tráfico de ahora";
  }
  return `${text}.`;
}
