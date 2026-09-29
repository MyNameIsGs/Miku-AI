import { describe, expect, it } from "vitest";
import { localIsoDate, spanishDateLabel } from "./dates";

describe("fechas de hoy", () => {
  it("YYYY-MM-DD en hora local, con ceros", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("cerca de medianoche no se corre de día (no pasa por UTC)", () => {
    expect(localIsoDate(new Date(2026, 8, 28, 23, 30))).toBe("2026-09-28");
  });

  it("la etiqueta larga en español", () => {
    expect(spanishDateLabel(new Date(2026, 8, 28))).toBe("lunes, 28 de septiembre de 2026");
  });
});
