import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { evaluateTemps, initialTempWatchState, mainGpu } = await import("./hardwareTemps");
import type { Temperatures, TempWatchState } from "./hardwareTemps";

// Así se ve la lectura real de la PC de Sebastián (Afterburner, 2026-10-26).
const reading = (cpu: number, gpu: number, tempLimit = false): Temperatures => ({
  cpu,
  gpus: [
    { name: "AMD Radeon(TM) Graphics", temp: 47, tempLimit: false },
    { name: "NVIDIA GeForce RTX 5070 Ti", temp: gpu, tempLimit },
  ],
});

// Pasa varias lecturas seguidas (una cada 10 s) y junta lo que diría.
function run(readings: Temperatures[], start: TempWatchState = initialTempWatchState(), t0 = 0) {
  let state = start;
  const said: string[][] = [];
  readings.forEach((r, i) => {
    const out = evaluateTemps(state, r, t0 + i * 10_000);
    state = out.state;
    said.push(out.messages);
  });
  return { state, said };
}

describe("avisos de temperatura", () => {
  it("ignora la gráfica integrada y elige la dedicada", () => {
    expect(mainGpu(reading(50, 60))?.name).toBe("NVIDIA GeForce RTX 5070 Ti");
  });

  it("temperaturas normales no dicen nada", () => {
    const { said } = run(Array(10).fill(reading(75, 72)));
    expect(said.flat()).toEqual([]);
  });

  it("un pico corto del CPU no avisa; sostenido sí, una sola vez", () => {
    expect(run([reading(89, 60), reading(80, 60), reading(89, 60)]).said.flat()).toEqual([]);
    const { said } = run(Array(8).fill(reading(89, 60)));
    expect(said.map((s) => s.length)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
    expect(said[2][0]).toContain("procesador");
    expect(said[2][0]).toContain("89");
  });

  it("crítico avisa antes y recuerda cada 5 minutos", () => {
    const { said } = run(Array(32).fill(reading(60, 87)));
    const when = said.flatMap((s, i) => (s.length ? [i] : []));
    // A los 20 s, y después a los 5 min de ese aviso.
    expect(when).toEqual([1, 31]);
    expect(said[1][0]).toContain("tarjeta de video");
  });

  it("si la GPU ya baja el reloj por temperatura cuenta como crítico", () => {
    const { said } = run([reading(60, 80, true), reading(60, 80, true)]);
    expect(said[1]).toHaveLength(1);
  });

  it("de aviso pasa a crítico, y vuelve a avisar solo después de enfriarse", () => {
    const hot = run(Array(3).fill(reading(89, 60)));
    const worse = run(Array(2).fill(reading(94, 60)), hot.state, 30_000);
    expect(worse.said[1]).toHaveLength(1);
    // Baja a 85 (no alcanza para rearmar) y sube de nuevo: no repite el aviso.
    const tibio = run([...Array(2).fill(reading(85, 60)), ...Array(3).fill(reading(89, 60))], worse.state, 60_000);
    expect(tibio.said.flat()).toEqual([]);
    // Se enfría de verdad (< 83) y vuelve a subir: avisa otra vez.
    const again = run([reading(70, 60), ...Array(3).fill(reading(89, 60))], tibio.state, 120_000);
    expect(again.said.flat()).toHaveLength(1);
  });

  it("sin dato del CPU no rompe", () => {
    const { said } = run([{ cpu: null, gpus: [] }, { cpu: null, gpus: [] }]);
    expect(said.flat()).toEqual([]);
  });
});
