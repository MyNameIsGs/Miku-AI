import { describe, expect, it } from "vitest";
import { buildRoutesBody, formatRoute } from "./routes";

describe("buildRoutesBody", () => {
  it("auto lleva tráfico; caminando no (la API lo rechaza)", () => {
    expect(buildRoutesBody({ address: "Altamira" }, "Aeropuerto", "auto")).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    });
    expect(buildRoutesBody({ address: "Altamira" }, "Aeropuerto", "caminando")).not.toHaveProperty("routingPreference");
  });

  it("un origen en coordenadas va como latLng", () => {
    expect(buildRoutesBody({ lat: 10.5, lng: -66.8 }, "X", "moto").origin).toEqual({
      location: { latLng: { latitude: 10.5, longitude: -66.8 } },
    });
  });
});

describe("formatRoute", () => {
  // Respuesta real de Altamira al aeropuerto de Maiquetía (2026-09-28).
  const real = {
    routes: [
      {
        duration: "2097s",
        staticDuration: "2156s",
        localizedValues: { distance: { text: "35,0 km" }, duration: { text: "35 min" }, staticDuration: { text: "36 min" } },
      },
    ],
  };

  it("en auto dice que es con el tráfico de ahora", () => {
    expect(formatRoute(real, "Aeropuerto", "auto")).toBe('En auto: 35 min hasta "Aeropuerto" (35,0 km), con el tráfico de ahora.');
  });

  it("si el tráfico suma 3 minutos o más, dice cuánto sería sin tráfico", () => {
    const slow = { routes: [{ ...real.routes[0], duration: "3000s" }] };
    expect(formatRoute(slow, "Aeropuerto", "auto")).toContain("sin tráfico serían 36 min");
  });

  it("transporte público sin datos (Caracas devuelve {}) lo explica", () => {
    expect(formatRoute({}, "Plaza Venezuela", "transporte_publico")).toContain("no tiene rutas en transporte público");
  });
});
