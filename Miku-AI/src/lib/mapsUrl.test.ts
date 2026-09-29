import { describe, expect, it } from "vitest";
import { buildMapsUrl } from "./mapsUrl";

describe("buildMapsUrl", () => {
  it("buscar un lugar", () => {
    expect(buildMapsUrl("buscar", "farmacia cerca")).toBe(
      "https://www.google.com/maps/search/?api=1&query=farmacia+cerca",
    );
  });

  it("ruta sin origen deja que Maps use la ubicación actual", () => {
    const url = new URL(buildMapsUrl("ruta", "Plaza Venezuela, Caracas", undefined, "transporte_publico"));
    expect(url.pathname).toBe("/maps/dir/");
    expect(url.searchParams.get("origin")).toBeNull();
    expect(url.searchParams.get("destination")).toBe("Plaza Venezuela, Caracas");
    expect(url.searchParams.get("travelmode")).toBe("transit");
    expect(url.searchParams.get("dir_action")).toBeNull();
  });

  it("navegar agrega dir_action=navigate y respeta el origen", () => {
    const url = new URL(buildMapsUrl("navegar", "Aeropuerto de Maiquetía", "Mi casa", "auto"));
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("Mi casa");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.get("dir_action")).toBe("navigate");
  });
});
