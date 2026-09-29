import { describe, expect, it } from "vitest";
import { formatPlaces } from "./places";

// Forma real de la respuesta (probada contra la API el 2026-09-28).
const WEEK = ["lunes: 8:00–20:00", "martes: 8:00–20:00", "miércoles: 8:00–20:00", "jueves: 8:00–20:00", "viernes: 8:00–22:00", "sábado: Cerrado", "domingo: Cerrado"];

describe("formatPlaces", () => {
  it("arma nombre, dirección, valoración, horario de hoy y teléfono", () => {
    const text = formatPlaces(
      [
        {
          displayName: { text: "Farmatodo Tobogán" },
          formattedAddress: "4 Av, Caracas 1060",
          rating: 4.5,
          userRatingCount: 812,
          currentOpeningHours: { openNow: true, weekdayDescriptions: WEEK },
          nationalPhoneNumber: "0212-555-0000",
        },
      ],
      "farmacia",
      new Date(2026, 8, 25), // viernes
    );
    expect(text).toBe(
      "1. Farmatodo Tobogán\n   Dirección: 4 Av, Caracas 1060\n   Valoración: 4.5 (812 opiniones)\n   Horario: abierto ahora; hoy viernes: 8:00–22:00\n   Teléfono: 0212-555-0000",
    );
  });

  it("el domingo toma la última línea de la semana", () => {
    const text = formatPlaces([{ displayName: { text: "X" }, currentOpeningHours: { openNow: false, weekdayDescriptions: WEEK } }], "x", new Date(2026, 8, 27));
    expect(text).toContain("cerrado ahora; hoy domingo: Cerrado");
  });

  it("sin resultados lo dice", () => {
    expect(formatPlaces(undefined, "unicornios", new Date())).toBe('No encontré lugares para "unicornios".');
  });
});
