import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

// Luces RGB de la PC (2026-10-22): lo que comparten el panel Luces y la tool
// controlar_luces. El hardware lo maneja el servicio de OpenRGB; esto habla
// con él por openrgb.rs.
//
// Los colores y los tamaños de los conectores ARGB se guardan acá (local,
// .settings.dat) y se vuelven a poner al arrancar la app: al reiniciar la
// PC, la RAM vuelve a su efecto de hardware y la placa se olvida de cuántos
// LEDs tiene cada ventilador.

export type RgbZone = {
  index: number;
  name: string;
  leds: number;
  ledsMin: number;
  ledsMax: number;
  start: number;
};

export type RgbDevice = {
  index: number;
  name: string;
  kind: string;
  zones: RgbZone[];
  leds: number;
  modes: string[];
  activeMode: number;
};

type LightsState = {
  // Por zona (ver zoneKey): cuántos LEDs tiene lo enchufado, y su color.
  sizes: Record<string, number>;
  colors: Record<string, string>;
};

const STORE_KEY = "lights";

export async function loadLightsState(): Promise<LightsState> {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    const saved = await store.get<LightsState>(STORE_KEY);
    return { sizes: saved?.sizes ?? {}, colors: saved?.colors ?? {} };
  } catch (err) {
    console.error("[Luces] No se pudo cargar lo guardado:", err);
    return { sizes: {}, colors: {} };
  }
}

export async function saveLightsState(state: LightsState) {
  try {
    const store = await load(".settings.dat", { autoSave: false });
    await store.set(STORE_KEY, state);
    await store.save();
  } catch (err) {
    console.error("[Luces] No se pudo guardar:", err);
  }
}

// Clave estable de cada dispositivo: su nombre, y si hay varios iguales
// (los dos módulos de RAM se llaman "ENE DRAM") el orden entre ellos. El
// número que da OpenRGB puede cambiar si aparece un dispositivo nuevo.
export function deviceKeys(devices: RgbDevice[]): Map<number, string> {
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  for (const device of [...devices].sort((a, b) => a.index - b.index)) {
    const n = (seen.get(device.name) ?? 0) + 1;
    seen.set(device.name, n);
    keys.set(device.index, n === 1 ? device.name : `${device.name}#${n}`);
  }
  return keys;
}

export const zoneKey = (deviceKey: string, zoneName: string) => `${deviceKey}|${zoneName}`;

// Los conectores ARGB de la placa: la placa no sabe qué hay enchufado.
export const isResizable = (zone: RgbZone) => zone.ledsMax > zone.ledsMin;

const ZONE_LABELS: Record<string, string> = {
  "Chipset Accent": "Luz del chipset",
  LED_C: "Luz de la placa",
  DRAM: "Módulo",
  Keyboard: "Teclado",
  Microphone: "Micrófono",
};

export function zoneLabel(zone: RgbZone): string {
  const argb = zone.name.match(/^ARGB(?:_V\d)?_(\d+)$/i);
  if (argb) return `Conector ARGB ${argb[1]}`;
  return ZONE_LABELS[zone.name] ?? zone.name;
}

// "ENE DRAM" dos veces -> "RAM · módulo 1" y "RAM · módulo 2".
export function deviceTitle(device: RgbDevice, devices: RgbDevice[]): string {
  const same = devices.filter((d) => d.name === device.name).sort((a, b) => a.index - b.index);
  const base = device.kind === "RAM" ? "RAM" : device.name;
  return same.length > 1 ? `${base} · módulo ${same.indexOf(device) + 1}` : base;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function isHexColor(text: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(text.trim());
}

export function normalizeHex(text: string): string {
  return `#${text.trim().replace("#", "").toUpperCase()}`;
}

export const listDevices = () => invoke<RgbDevice[]>("rgb_listar");

export function paintZone(device: RgbDevice, zone: RgbZone, colors: string[]) {
  return invoke("rgb_pintar_zona", {
    dispositivo: device.index,
    zona: zone.index,
    colores: colors.map(hexToRgb),
  });
}

export function resizeZone(device: RgbDevice, zone: RgbZone, size: number) {
  return invoke<RgbDevice>("rgb_redimensionar_zona", {
    dispositivo: device.index,
    zona: zone.index,
    tamano: size,
  });
}

// Un color para dispositivos enteros (la tool de Miku, "todo de este color"
// en el panel). Vacío = todos. Lo guarda para cada zona. Devuelve los
// nombres de los que cambió.
export async function paintDevices(hex: string, indices: number[]): Promise<string[]> {
  const color = normalizeHex(hex);
  const [r, g, b] = hexToRgb(color);
  const changed = await invoke<string[]>("rgb_poner_color", { r, g, b, dispositivos: indices });
  const devices = await listDevices();
  const keys = deviceKeys(devices);
  const state = await loadLightsState();
  for (const device of devices) {
    if (indices.length > 0 && !indices.includes(device.index)) continue;
    for (const zone of device.zones) state.colors[zoneKey(keys.get(device.index)!, zone.name)] = color;
  }
  await saveLightsState(state);
  return changed;
}

// Al arrancar: vuelve a poner los tamaños de los conectores y los colores
// guardados. El servicio de OpenRGB puede estar todavía detectando si la PC
// recién prendió, así que se reintenta un par de veces.
export async function restoreLights() {
  const state = await loadLightsState();
  if (Object.keys(state.sizes).length === 0 && Object.keys(state.colors).length === 0) return;
  for (const waitMs of [0, 20000, 60000]) {
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      const devices = await listDevices();
      if (devices.length === 0) continue;
      const keys = deviceKeys(devices);
      for (const device of devices) {
        const key = keys.get(device.index)!;
        let current = device;
        for (const zone of device.zones) {
          const size = state.sizes[zoneKey(key, zone.name)];
          if (size !== undefined && isResizable(zone) && zone.leds !== size) {
            current = await resizeZone(current, zone, size);
          }
        }
        for (const zone of current.zones) {
          const color = state.colors[zoneKey(key, zone.name)];
          if (color && zone.leds > 0) await paintZone(current, zone, [color]);
        }
      }
      console.log("[Luces] Colores y tamaños guardados restaurados.");
      return;
    } catch (err) {
      console.warn("[Luces] Todavía no se pudieron restaurar:", err);
    }
  }
}
