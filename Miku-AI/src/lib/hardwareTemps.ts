import { invoke } from "@tauri-apps/api/core";

// Avisos de sobrecalentamiento (2026-10-26). Las temperaturas salen de MSI
// Afterburner (ver src-tauri/src/hardware_temps.rs).
export type GpuTemp = { name: string; temp: number; tempLimit: boolean };
export type Temperatures = { cpu: number | null; gpus: GpuTemp[] };

export function readTemperatures(): Promise<Temperatures> {
  return invoke<Temperatures>("temperaturas");
}

// Umbrales a partir de los límites oficiales de las piezas de Sebastián:
// - Ryzen 7 9800X3D: Tjmax 95 °C (AMD). Jugando suele andar entre 60 y 80;
//   los X3D pegan picos cortos, por eso el aviso pide que se sostenga.
// - RTX 5070 Ti: temperatura máxima 88 °C (NVIDIA); arriba de eso baja el
//   reloj. Jugando con buena ventilación anda en ~70.
// "warn" = ya está caliente de más; "critical" = pegado al límite.
export const TEMP_LIMITS = {
  cpu: { warn: 88, critical: 93 },
  gpu: { warn: 83, critical: 87 },
} as const;

// Cuántas lecturas seguidas arriba del umbral antes de avisar (llega una
// cada 10 s desde hardware_temps.rs: ~30 s para "warn", ~20 s para
// "critical"), cuánto tiene que bajar para volver a avisar de cero, y cada
// cuánto recordar si sigue en crítico.
const WARN_READINGS = 3;
const CRITICAL_READINGS = 2;
const REARM_MARGIN = 5;
const CRITICAL_REPEAT_MS = 5 * 60 * 1000;

type Level = "ok" | "warn" | "critical";

type PartState = {
  // Lecturas seguidas en cada nivel (o más).
  warnStreak: number;
  criticalStreak: number;
  // Último nivel del que ya se avisó (para no repetir).
  announced: Level;
  lastCriticalAt: number;
};

export type TempWatchState = Record<"cpu" | "gpu", PartState>;

export function initialTempWatchState(): TempWatchState {
  const part = (): PartState => ({ warnStreak: 0, criticalStreak: 0, announced: "ok", lastCriticalAt: 0 });
  return { cpu: part(), gpu: part() };
}

// La gráfica integrada del Ryzen (y las de Intel) sigue la temperatura del
// procesador; no se evalúa por separado.
function isIntegrated(name: string): boolean {
  return /radeon\(tm\) graphics|uhd graphics|iris/i.test(name);
}

// La GPU dedicada más caliente (normalmente hay una sola).
export function mainGpu(temps: Temperatures): GpuTemp | null {
  const dedicated = temps.gpus.filter((g) => !isIntegrated(g.name));
  if (dedicated.length === 0) return null;
  return dedicated.reduce((a, b) => (b.temp > a.temp ? b : a));
}

const PART_NAMES = { cpu: "el procesador", gpu: "la tarjeta de video" } as const;

function message(part: "cpu" | "gpu", level: Level, temp: number, repeat: boolean): string {
  const who = PART_NAMES[part];
  const t = Math.round(temp);
  const limit = part === "cpu" ? 95 : 88;
  if (level === "critical") {
    return repeat
      ? `Sigue igual: ${who} sigue a ${t} grados. Deberías parar lo que está exigiendo la PC.`
      : `¡Oye! ${who} está a ${t} grados, casi en su límite de ${limit}. Revisa los ventiladores o cierra lo que esté exigiéndola.`;
  }
  return `Ojo, ${who} lleva un rato a ${t} grados. No es peligroso todavía, pero está más caliente de lo normal; quizás los ventiladores no están subiendo.`;
}

function evaluatePart(
  part: "cpu" | "gpu",
  s: PartState,
  temp: number | null,
  forceCritical: boolean,
  now: number,
): { state: PartState; text: string | null } {
  if (temp === null) return { state: s, text: null };
  const { warn, critical } = TEMP_LIMITS[part];
  const isCritical = forceCritical || temp >= critical;
  const next: PartState = {
    ...s,
    warnStreak: temp >= warn || isCritical ? s.warnStreak + 1 : 0,
    criticalStreak: isCritical ? s.criticalStreak + 1 : 0,
  };

  // Bajó lo suficiente: queda listo para volver a avisar desde cero.
  if (temp < warn - REARM_MARGIN && !forceCritical) {
    return { state: { ...next, announced: "ok" }, text: null };
  }

  if (next.criticalStreak >= CRITICAL_READINGS) {
    if (s.announced !== "critical") {
      return { state: { ...next, announced: "critical", lastCriticalAt: now }, text: message(part, "critical", temp, false) };
    }
    if (now - s.lastCriticalAt >= CRITICAL_REPEAT_MS) {
      return { state: { ...next, lastCriticalAt: now }, text: message(part, "critical", temp, true) };
    }
    return { state: next, text: null };
  }

  if (next.warnStreak >= WARN_READINGS && s.announced === "ok") {
    return { state: { ...next, announced: "warn" }, text: message(part, "warn", temp, false) };
  }
  return { state: next, text: null };
}

// Función pura: dado el estado y una lectura, qué hay que decir (si algo).
export function evaluateTemps(
  state: TempWatchState,
  temps: Temperatures,
  now: number,
): { state: TempWatchState; messages: string[] } {
  const gpu = mainGpu(temps);
  const cpu = evaluatePart("cpu", state.cpu, temps.cpu, false, now);
  const g = evaluatePart("gpu", state.gpu, gpu?.temp ?? null, gpu?.tempLimit ?? false, now);
  return {
    state: { cpu: cpu.state, gpu: g.state },
    messages: [cpu.text, g.text].filter((t): t is string => t !== null),
  };
}

// Texto para la tool revisar_temperaturas.
export function describeTemperatures(temps: Temperatures): string {
  const parts: string[] = [];
  if (temps.cpu !== null) {
    parts.push(`Procesador (Ryzen 7 9800X3D): ${Math.round(temps.cpu)} °C (avisa a ${TEMP_LIMITS.cpu.warn}, límite 95).`);
  } else {
    parts.push("Procesador: Afterburner no está mostrando su temperatura.");
  }
  const gpu = mainGpu(temps);
  if (gpu) {
    const throttling = gpu.tempLimit ? " Ya está bajando el reloj por temperatura." : "";
    parts.push(`${gpu.name}: ${Math.round(gpu.temp)} °C (avisa a ${TEMP_LIMITS.gpu.warn}, límite 88).${throttling}`);
  }
  return parts.join(" ");
}
