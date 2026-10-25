import { describe, expect, it, vi } from "vitest";

// lightProfiles importa el store y lights.ts (que hablan con Tauri): acá
// solo se prueban las funciones puras de las reglas.
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { ruleMatches, describeWhen, planScene, PLAN_PROFILES } = await import("./lightProfiles");
import type { Rule, RuleContext } from "./lightProfiles";

const ctx = (patch: Partial<RuleContext> = {}): RuleContext => ({
  game: null,
  stream: false,
  sleeping: false,
  music: false,
  awayMinutes: 0,
  now: new Date(2026, 9, 25, 12, 0),
  ...patch,
});

const rule = (when: Rule["when"]): Rule => ({ id: "r", when, then: { kind: "off" }, enabled: true });

describe("reglas de las luces", () => {
  it("el juego: vacío es cualquiera, si no busca parte del nombre sin importar mayúsculas", () => {
    expect(ruleMatches(rule({ kind: "game", match: "" }), ctx({ game: "deadlock" }))).toBe(true);
    expect(ruleMatches(rule({ kind: "game", match: "" }), ctx())).toBe(false);
    expect(ruleMatches(rule({ kind: "game", match: "valorant" }), ctx({ game: "VALORANT-Win64-Shipping" }))).toBe(true);
    expect(ruleMatches(rule({ kind: "game", match: "valorant" }), ctx({ game: "League of Legends" }))).toBe(false);
  });

  it("el horario funciona también cruzando la medianoche", () => {
    const night = rule({ kind: "schedule", from: "23:00", to: "07:00" });
    expect(ruleMatches(night, ctx({ now: new Date(2026, 9, 25, 23, 30) }))).toBe(true);
    expect(ruleMatches(night, ctx({ now: new Date(2026, 9, 25, 3, 0) }))).toBe(true);
    expect(ruleMatches(night, ctx({ now: new Date(2026, 9, 25, 7, 0) }))).toBe(false);
    expect(ruleMatches(night, ctx({ now: new Date(2026, 9, 25, 15, 0) }))).toBe(false);
    const early = rule({ kind: "schedule", from: "00:00", to: "07:00" });
    expect(ruleMatches(early, ctx({ now: new Date(2026, 9, 25, 6, 59) }))).toBe(true);
    expect(ruleMatches(early, ctx({ now: new Date(2026, 9, 25, 12, 0) }))).toBe(false);
  });

  it("ausente: desde los minutos pedidos", () => {
    expect(ruleMatches(rule({ kind: "away", minutes: 10 }), ctx({ awayMinutes: 9.5 }))).toBe(false);
    expect(ruleMatches(rule({ kind: "away", minutes: 10 }), ctx({ awayMinutes: 10 }))).toBe(true);
  });

  it("se describen en palabras", () => {
    expect(describeWhen({ kind: "game", match: "" })).toBe("Jugando cualquier juego");
    expect(describeWhen({ kind: "schedule", from: "00:00", to: "07:00" })).toBe("De 00:00 a 07:00");
  });
});

describe("perfiles del plan", () => {
  it("cambian el efecto de los grupos y las tiras, sin perder el resto de la escena", () => {
    const base = {
      groups: [{ category: "fans" as const, zones: ["a|ARGB"], effect: PLAN_PROFILES[0].effect }],
      positions: { "a|ARGB": 0.3 },
      keyboardStrips: { bottom: { mode: 0, color: 0, brightness: 3, speed: 1 }, top: { mode: 0, color: 0 }, follow: true },
    };
    const cebollin = PLAN_PROFILES.find((p) => p.name === "Cebollín")!;
    expect(cebollin.by).toBe("miku");
    const scene = planScene(base, cebollin);
    expect(scene.groups[0].effect.kind).toBe("comet");
    expect(scene.positions).toEqual({ "a|ARGB": 0.3 });
    expect(scene.keyboardStrips).toEqual({ bottom: { mode: 4, color: 1, brightness: 3, speed: 1 }, top: { mode: 4, color: 1 }, follow: false });
  });
});

describe("poner un perfil no pisa la configuración del equipo", () => {
  it("toma los efectos del perfil y deja la corrección, el mapa y los excluidos de ahora", async () => {
    const { withSetupOf, makeEffect } = await import("./lights");
    const zones = (r: number) => ({ "a|ARGB": { fans: 3, offset: 0, reverse: false, gain: [r, 1, 1] as [number, number, number] } });
    const look = { groups: [{ category: "fans" as const, zones: ["a|ARGB"], effect: makeEffect("fire", []) }], positions: { "a|ARGB": 0.1 }, zones: zones(1), excluded: [] };
    const now = { groups: [{ category: "fans" as const, zones: ["a|ARGB"], effect: makeEffect("static", ["#39C5BB"]) }], positions: { "a|ARGB": 0.8 }, zones: zones(0.35), excluded: ["b|X"] };
    const out = withSetupOf(look, now);
    expect(out.groups[0].effect.kind).toBe("fire");
    expect(out.zones!["a|ARGB"].gain[0]).toBe(0.35);
    expect(out.positions["a|ARGB"]).toBe(0.8);
    expect(out.excluded).toEqual(["b|X"]);
  });
});
