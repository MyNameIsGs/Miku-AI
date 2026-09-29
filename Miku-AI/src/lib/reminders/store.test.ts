import { describe, expect, it } from "vitest";
import { reminderSpeech } from "./store";

describe("reminderSpeech", () => {
  it("a tiempo, dice el mensaje tal cual", () => {
    expect(reminderSpeech({ id: "1", message: "ya se enfrió tu café", dueAt: 0 })).toBe("ya se enfrió tu café");
  });

  it("si venció con la app cerrada, aclara para qué hora era", () => {
    const dueAt = new Date(2026, 8, 28, 15, 30).getTime();
    const text = reminderSpeech({ id: "1", message: "saca la ropa", dueAt, late: true });
    expect(text).toMatch(/^Te lo digo tarde, era para las 15:30/);
    expect(text).toContain("saca la ropa");
  });
});
