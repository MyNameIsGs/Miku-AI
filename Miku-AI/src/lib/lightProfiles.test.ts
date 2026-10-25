import { describe, expect, it, vi } from "vitest";

// lightProfiles importa el store y lights.ts (que hablan con Tauri): acá
// solo se prueban las funciones puras de las reglas.
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { ruleMatches, describeWhen } = await import("./lightProfiles");
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
