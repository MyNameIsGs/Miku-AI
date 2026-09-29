import { describe, expect, it } from "vitest";
import { toApiMessages } from "./chatHistory";

describe("toApiMessages", () => {
  it("aplana los turnos y pasa tool_calls y tool_call_id tal cual", () => {
    const call = { id: "c1", type: "function" as const, function: { name: "obtener_hora_actual", arguments: "{}" } };
    expect(
      toApiMessages([
        [
          { role: "user", content: "¿qué hora es?" },
          { role: "assistant", content: "", tool_calls: [call] },
          { role: "tool", content: "14:25", tool_call_id: "c1" },
          { role: "assistant", content: "Son las 2:25." },
        ],
        [{ role: "user", content: "gracias" }],
      ]),
    ).toEqual([
      { role: "user", content: "¿qué hora es?" },
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", content: "14:25", tool_call_id: "c1" },
      { role: "assistant", content: "Son las 2:25." },
      { role: "user", content: "gracias" },
    ]);
  });
});
