import { describe, expect, it } from "vitest";
import { matchesQuery } from "./textSearch";

describe("matchesQuery", () => {
  const promise = "Sebastián me prometió un helado cuando termine de crearme.";

  it("encuentra sin importar tildes ni mayúsculas, en los dos sentidos", () => {
    expect(matchesQuery(promise, "HELADO")).toBe(true);
    expect(matchesQuery(promise, "sebastian")).toBe(true);
    expect(matchesQuery("la cancion de hoy", "canción")).toBe(true);
  });

  it("exige todas las palabras, en cualquier orden", () => {
    expect(matchesQuery(promise, "crearme helado")).toBe(true);
    expect(matchesQuery(promise, "helado pizza")).toBe(false);
  });

  it("no encuentra lo que no está", () => {
    expect(matchesQuery(promise, "fútbol")).toBe(false);
  });

  it("una búsqueda vacía no filtra", () => {
    expect(matchesQuery(promise, "   ")).toBe(true);
  });
});
