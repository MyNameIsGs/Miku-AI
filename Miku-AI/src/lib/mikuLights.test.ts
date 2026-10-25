import { describe, expect, it, vi } from "vitest";

// mikuLights habla con Tauri: acá solo se prueban las funciones puras.
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { parseChoice, describeScene } = await import("./mikuLights");
const { makeEffect } = await import("./lights");

describe("que Miku lo decida", () => {
  it("SILENCIO o cambiar:false es no tocar nada", () => {
    expect(parseChoice("SILENCIO")).toBeNull();
    expect(parseChoice('{"cambiar": false}')).toBeNull();
    expect(parseChoice("me gustan así")).toBeNull();
  });

  it("saca el JSON aunque venga con texto o ``` alrededor", () => {
    const reply = 'Claro:\n```json\n{"nota": "algo tranquilo", "grupos": {"todo": {"efecto": "breathe", "colores": ["#8A5CF6"]}}}\n```';
    const choice = parseChoice(reply);
    expect(choice?.nota).toBe("algo tranquilo");
    expect(choice?.grupos?.todo?.efecto).toBe("breathe");
  });

  it("describe la escena nombrando sus propios efectos", () => {
    const own = makeEffect("wave", ["#39C5BB", "#F0508F"], { speed: 30 });
    const scene = { groups: [{ category: "fans" as const, zones: [], effect: own }], positions: {} };
    const mine = {
      effects: [{ id: "a", name: "Atardecer", description: "", effect: own, created: "2026-10-25" }],
      moodColors: {},
      decides: { on: true, savedScene: null, lastNote: null, lastAt: null },
    };
    expect(describeScene(scene, mine)).toContain('tu efecto "Atardecer"');
  });
});
