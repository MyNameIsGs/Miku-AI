import { describe, expect, it } from "vitest";
import { diaryWindow, pendingDiaryDate, summarizeDay } from "./diaryDay";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe("pendingDiaryDate", () => {
  it("antes de las 23 no toca el de hoy", () => {
    expect(pendingDiaryDate(new Date(at(2026, 9, 29, 22, 59)), "2026-09-28")).toBeNull();
  });

  it("a las 23 toca el de hoy, una sola vez", () => {
    expect(pendingDiaryDate(new Date(at(2026, 9, 29, 23)), "2026-09-28")).toBe("2026-09-29");
    expect(pendingDiaryDate(new Date(at(2026, 9, 29, 23, 30)), "2026-09-29")).toBeNull();
  });

  it("si anoche la PC estaba apagada, al abrirse escribe el de ayer", () => {
    expect(pendingDiaryDate(new Date(at(2026, 9, 30, 9)), "2026-09-28")).toBe("2026-09-29");
    expect(pendingDiaryDate(new Date(at(2026, 9, 30, 9)), null)).toBe("2026-09-29");
  });

  it("no se pone al día con semanas atrás", () => {
    expect(pendingDiaryDate(new Date(at(2026, 9, 30, 9)), "2026-09-01")).toBe("2026-09-29");
  });

  it("pasa bien de mes", () => {
    expect(pendingDiaryDate(new Date(at(2026, 10, 1, 8)), "2026-09-29")).toBe("2026-09-30");
  });
});

describe("diaryWindow", () => {
  it("va de las 23 de la noche anterior a las 23 de ese día", () => {
    expect(diaryWindow("2026-10-01")).toEqual({ from: at(2026, 9, 30, 23), to: at(2026, 10, 1, 23) });
  });
});

describe("summarizeDay", () => {
  const turns = [
    { at: at(2026, 9, 28, 22), user: "de anteayer", assistant: "viejo" },
    { at: at(2026, 9, 28, 23, 30), user: "a las 23:30 de anoche", assistant: "entra en el de hoy" },
    { at: at(2026, 9, 29, 15), user: "hola", assistant: "¡hola!" },
    { at: at(2026, 9, 29, 23, 10), user: "después de escribir", assistant: "va para mañana" },
  ];

  it("toma solo lo del día del diario", () => {
    const s = summarizeDay("2026-09-29", turns, [], []);
    expect(s.pc).toContain("a las 23:30 de anoche");
    expect(s.pc).toContain("[15:00] Sebastián: hola");
    expect(s.pc).not.toContain("de anteayer");
    expect(s.pc).not.toContain("después de escribir");
    expect(s.hasActivity).toBe(true);
  });

  it("junta la voz del celular y los cambios de ánimo", () => {
    const s = summarizeDay(
      "2026-09-29",
      [],
      [{ heard: "¿qué hora es?", reply: "Las tres.", timestampMs: at(2026, 9, 29, 15) }],
      [
        { at: at(2026, 9, 29, 16), mood: "happy", origin: "charla", level: "muy contenta" },
        { at: at(2026, 9, 29, 17), mood: "neutral", origin: "se apagó solo", level: "neutral" },
        { at: at(2026, 9, 29, 18), mood: "angry", origin: "tacto" },
      ],
    );
    expect(s.phone).toBe("[15:00] Sebastián: ¿qué hora es?\nMiku: Las tres.");
    expect(s.mood).toBe("16:00 — muy contenta, por la charla\n17:00 — se te pasó, quedaste normal\n18:00 — enojada, por un toque");
  });

  it("un día sin nada no tiene actividad", () => {
    expect(summarizeDay("2026-09-20", turns, [], []).hasActivity).toBe(false);
  });

  it("recorta los mensajes largos", () => {
    const s = summarizeDay("2026-09-29", [{ at: at(2026, 9, 29, 12), user: "a".repeat(1000), assistant: "" }], [], []);
    expect(s.pc.length).toBeLessThan(450);
  });
});
