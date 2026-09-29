import { describe, expect, it } from "vitest";
import { parseSharedMood } from "./sharedMood";

describe("parseSharedMood", () => {
  it("lee el archivo que escriben la PC y el celular", () => {
    expect(parseSharedMood('{"mood":"happy","intensity":40,"halfLifeMs":1200000,"setAt":1790000000000,"device":"celular"}')).toEqual({
      mood: "happy",
      intensity: 40,
      halfLifeMs: 1200000,
      setAt: 1790000000000,
      device: "celular",
    });
  });

  it("un archivo roto o con un ánimo inválido no rompe nada", () => {
    expect(parseSharedMood("no es json")).toBeNull();
    expect(parseSharedMood('{"mood":"feliz","intensity":40,"halfLifeMs":1,"setAt":1}')).toBeNull();
    expect(parseSharedMood('{"mood":"sad","intensity":"mucho","halfLifeMs":1,"setAt":1}')).toBeNull();
  });
});
