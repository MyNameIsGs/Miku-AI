import { describe, expect, it, vi } from "vitest";

// lights.ts habla con Tauri; acá solo se usan sus constantes.
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { effectColor } = await import("./lightEffects");
const { DEFAULT_EFFECT_COLORS, makeEffect } = await import("./lights");

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 3));

// Fuego y Arcoíris pasaron a usar sus colores: con su paleta tienen que
// verse igual que cuando los colores estaban fijos.
describe("fuego y arcoíris con su paleta", () => {
  const times = [0, 0.37, 1.2, 4.9, 13.3];

  it("el fuego con la paleta Fuego es la llama de antes", () => {
    const fx = makeEffect("fire", DEFAULT_EFFECT_COLORS.fire!);
    for (const t of times) {
      for (const i of [0, 3, 7]) {
        const f = 0.55 + 0.45 * Math.sin(t * 9 + i * 1.7 + Math.sin(t * 3 + i));
        const before = [255, 60 + 130 * f, 40 * f].map((x) => x * (0.5 + f / 2));
        close(effectColor(fx, "x", 0.5, i, 12, t), before);
      }
    }
  });

  it("el arcoíris con la paleta Arcoíris es el espectro de antes", () => {
    const withPalette = makeEffect("rainbow", DEFAULT_EFFECT_COLORS.rainbow!);
    const spectrum = makeEffect("rainbow", ["#FFFFFF"]);
    for (const t of times) {
      for (const i of [0, 5, 11]) close(effectColor(withPalette, "x", 0.5, i, 12, t), effectColor(spectrum, "x", 0.5, i, 12, t));
    }
  });

  it("con otros colores, el fuego los usa", () => {
    const fx = makeEffect("fire", ["#0000FF", "#00FFFF"]);
    const [r, , b] = effectColor(fx, "x", 0.5, 0, 12, 0.5);
    expect(r).toBe(0);
    expect(b).toBeGreaterThan(0);
  });
});
