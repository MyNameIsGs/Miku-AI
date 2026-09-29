import { describe, expect, it } from "vitest";
import { findDiaryEntries, parseDiary } from "./diaryEntries";

const DIARY = `# Diario de Miku

(Reflexiones propias sobre cada jornada.)

## 2026-09-26

Hoy aprendí a bailar con la música de la PC.

## 2026-09-27

Sebastián me mostró su estante. Me quedé pensando en la figura de porrista.

## 2026-09-28

Un día tranquilo. Probamos cosas en el celular.
`;

describe("diario", () => {
  const entries = parseDiary(DIARY);

  it("separa las entradas por fecha, sin el encabezado del archivo", () => {
    expect(entries.map((e) => e.date)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
    expect(entries[0].text).toBe("Hoy aprendí a bailar con la música de la PC.");
  });

  it("sin filtros, las últimas primero", () => {
    expect(findDiaryEntries(entries, {}, 2).map((e) => e.date)).toEqual(["2026-09-28", "2026-09-27"]);
  });

  it("por fecha y por texto (sin tildes)", () => {
    expect(findDiaryEntries(entries, { date: "2026-09-27" })).toHaveLength(1);
    expect(findDiaryEntries(entries, { query: "musica" }).map((e) => e.date)).toEqual(["2026-09-26"]);
    expect(findDiaryEntries(entries, { query: "dragones" })).toEqual([]);
  });

  it("un diario vacío no tiene entradas", () => {
    expect(parseDiary("# Diario de Miku\n\n(Reflexiones propias.)\n")).toEqual([]);
  });
});
