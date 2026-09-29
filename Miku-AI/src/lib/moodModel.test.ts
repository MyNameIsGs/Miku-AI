import { describe, expect, it } from "vitest";
import { applyPush, currentIntensity, describeMood, moodLevel, MoodPush, MoodState, NEUTRAL_STATE } from "./moodModel";

const MIN = 60 * 1000;
const shake: MoodPush = { mood: "happy", amount: "poco", duration: "un_rato", source: "tacto:agitar" };

// Aplica varios empujones seguidos, con su historial.
function run(pushes: { push: MoodPush; at: number }[], start: MoodState = NEUTRAL_STATE) {
  let state = start;
  const history: { source: string; at: number }[] = [];
  const notes: (string | null)[] = [];
  for (const { push, at } of pushes) {
    const r = applyPush(state, push, history, at);
    state = r.state;
    notes.push(r.note);
    history.push({ source: push.source, at });
  }
  return { state, notes };
}

describe("modelo de ánimo", () => {
  it("una sola sacudida desde neutral la deja apenas un poco contenta, sin cambiar la cara", () => {
    const { state } = run([{ push: shake, at: 0 }]);
    expect(describeMood(state, 0)).toBe("un poco contenta");
    expect(moodLevel(state, 0)).toBe("un_poco");
  });

  it("varias sacudidas la llevan más arriba, pero cada una suma menos (se acostumbra)", () => {
    const one = run([{ push: shake, at: 0 }]).state;
    const three = run([0, 20_000, 40_000].map((at) => ({ push: shake, at }))).state;
    const gainSecond = currentIntensity(run([0, 20_000].map((at) => ({ push: shake, at }))).state, 20_000) - currentIntensity(one, 20_000);
    expect(currentIntensity(three, 40_000)).toBeGreaterThan(currentIntensity(one, 0));
    expect(gainSecond).toBeLessThan(15);
  });

  it("si se repite demasiado seguido, en vez de alegrarla la molesta", () => {
    const { state, notes } = run([0, 30_000, 60_000, 90_000, 120_000].map((at) => ({ push: shake, at })));
    expect(notes[4]).toContain("molestando");
    expect(currentIntensity(state, 120_000)).toBeLessThan(currentIntensity(run([0, 30_000, 60_000, 90_000].map((at) => ({ push: shake, at }))).state, 90_000));
  });

  it("algo de la charla que le importó la pone muy contenta y le dura horas", () => {
    const talk: MoodPush = { mood: "happy", amount: "mucho", duration: "todo_el_dia", source: "charla" };
    const { state } = run([{ push: talk, at: 0 }, { push: talk, at: 60 * MIN }]);
    expect(moodLevel(state, 60 * MIN)).toBe("muy");
    expect(moodLevel(state, 60 * MIN + 5 * 60 * MIN)).not.toBe("neutral");
  });

  it("lo pasajero se apaga en menos de una hora", () => {
    const { state } = run([{ push: { ...shake, amount: "bastante" }, at: 0 }]);
    expect(moodLevel(state, 0)).toBe("normal");
    expect(moodLevel(state, 60 * MIN)).toBe("neutral");
  });

  it("algo triste estando contenta primero le baja la alegría antes de ponerla triste", () => {
    const happy = run([{ push: { mood: "happy", amount: "bastante", duration: "unas_horas", source: "charla" }, at: 0 }]).state;
    const after = applyPush(happy, { mood: "sad", amount: "poco", duration: "unas_horas", source: "charla:2" }, [], 0).state;
    expect(after.mood).toBe("happy");
    expect(currentIntensity(after, 0)).toBeLessThan(currentIntensity(happy, 0));
  });
});
