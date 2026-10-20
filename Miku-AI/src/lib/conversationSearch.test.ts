import { describe, expect, it } from "vitest";
import { formatTurns, LoggedTurn, searchTurns } from "./conversationSearch";

const at = (iso: string) => new Date(iso).getTime();
const TURNS: LoggedTurn[] = [
  { at: at("2026-10-19T22:10:00"), user: "¿Qué canción es esta?", miku: "Suena a Vocaloid." },
  { at: at("2026-10-20T05:11:00"), user: "Estoy haciendo un juego con mis amigos en Godot", miku: "Tal vez te haga un personaje entero." },
  { at: at("2026-10-20T05:12:00"), user: "en godot, tal vez te deje decidir tu arquetipo", miku: "Lo pienso y te lo digo." },
  { at: at("2026-10-20T11:40:00"), user: "", miku: "Te llegó un correo de tu jefe." },
];

describe("buscar_en_charlas", () => {
  it("encuentra por tema, sin tildes ni mayúsculas, en orden", () => {
    const found = searchTurns(TURNS, { query: "el juego de GODOT", limit: 5 });
    expect(found.map((t) => t.miku)).toEqual(["Tal vez te haga un personaje entero.", "Lo pienso y te lo digo."]);
  });
  it("con varias palabras alcanza con la mitad, y lo más parecido va primero al recortar", () => {
    const found = searchTurns(TURNS, { query: "godot arquetipo", limit: 1 });
    expect(found[0].user).toContain("arquetipo");
  });
  it("por fecha da ese día; sin nada, lo último", () => {
    expect(searchTurns(TURNS, { date: "2026-10-19", limit: 5 })).toHaveLength(1);
    expect(searchTurns(TURNS, { limit: 2 }).map((t) => t.miku)[1]).toBe("Te llegó un correo de tu jefe.");
  });
  it("nada que ver: vacío", () => {
    expect(searchTurns(TURNS, { query: "fútbol", limit: 5 })).toEqual([]);
  });
  it("lo que dijo sola va sin línea de Sebastián", () => {
    expect(formatTurns([TURNS[3]])).toBe("[2026-10-20 11:40]\nTú: Te llegó un correo de tu jefe.");
  });
});
