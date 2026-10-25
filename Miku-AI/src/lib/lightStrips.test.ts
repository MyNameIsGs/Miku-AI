import { describe, expect, it, vi } from "vitest";

// lights.ts habla con Tauri: acá solo se prueban las funciones puras de las
// tiras del teclado.
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { nearestStripColor, resolveStrips, makeEffect } = await import("./lights");
import type { KeyboardStrips, Scene } from "./lights";

const strips: KeyboardStrips = { bottom: { mode: 3, color: 2, brightness: 2, speed: 2 }, top: { mode: 4, color: 6 } };

describe("tiras del teclado", () => {
  it("cada color va al más parecido de los 7", () => {
    expect(nearestStripColor("#FF0000")).toBe(0); // rojo
    expect(nearestStripColor("#3DDC84")).toBe(1); // verde
    expect(nearestStripColor("#2F6BFF")).toBe(2); // azul
    expect(nearestStripColor("#FFD166")).toBe(3); // amarillo
    expect(nearestStripColor("#F0508F")).toBe(4); // rosa
    expect(nearestStripColor("#39C5BB")).toBe(5); // turquesa Miku -> azul claro
    expect(nearestStripColor("#EEEEEE")).toBe(6); // casi gris -> blanco
    expect(nearestStripColor("#000000")).toBe(6);
  });

  it("sin seguir a la escena quedan como están; siguiéndola toman el color de Periféricos", () => {
    const scene: Scene = {
      groups: [{ category: "periph", zones: [], effect: makeEffect("static", ["#FF2020"]) }],
      positions: {},
      keyboardStrips: strips,
    };
    expect(resolveStrips(scene)).toEqual(strips);
    const following = resolveStrips({ ...scene, keyboardStrips: { ...strips, follow: true } });
    expect(following?.bottom.color).toBe(0);
    expect(following?.top.color).toBe(0);
    expect(following?.bottom.mode).toBe(3);
    expect(resolveStrips({ groups: [], positions: {} })).toBeNull();
  });
});
