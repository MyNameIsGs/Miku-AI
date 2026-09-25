import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ParsedMovement } from "../types";
import { BONE_RANGES_VERSION } from "../config/boneRanges";

// Punto 5b del plan, tercera versión (pedido de Sebastián: elegir por
// canción era demasiado, que sea por categoría y más barato). Tres
// categorías que salen de lo que se mide del audio, sin consultar al modelo
// (ver useMusicSway.ts); Miku diseña un baile por categoría la primera vez
// que suena algo de ese tipo, o decide no moverse con ese tipo. Queda acá,
// en la carpeta de memoria, sincronizado por GitHub.

export const MUSIC_CATEGORIES = ["sin_golpe", "ritmo_tranquilo", "ritmo_movido"] as const;
export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MusicCategory, string> = {
  sin_golpe: "canciones sin un golpe marcado (baladas, tempo libre, algo suave o lento)",
  ritmo_tranquilo: "canciones con ritmo tranquilo (un golpe claro pero pausado)",
  ritmo_movido: "canciones con ritmo movido (un golpe claro y rápido)",
};

export type Dance = {
  // true: el vaivén se ajusta al golpe (1, 2 o 4 golpes por vaivén);
  // false: a su propio ritmo, con la duración que eligió.
  alGolpe: boolean;
  expression: string | null;
  entries: ParsedMovement["entries"];
  durationMs: number;
  createdAt: string;
  rangos: number;
};

// "no": decidió no moverse con ese tipo de canción.
type Store = { version: 3; bailes: Partial<Record<MusicCategory, Dance | "no">> };

let cache: Store = { version: 3, bailes: {} };

async function storePath() {
  return join(await appDataDir(), "memory", "musica.json");
}

async function persist() {
  await writeTextFile(await storePath(), JSON.stringify(cache, null, 2));
}

export async function loadMusicStore() {
  try {
    const path = await storePath();
    if (!(await exists(path))) return;
    const loaded = JSON.parse(await readTextFile(path));
    if (loaded?.version === 3) {
      cache = loaded as Store;
      return;
    }
    // Versiones anteriores: lo que ya había diseñado no se pierde. Su primer
    // baile al golpe queda para el ritmo movido, y uno a su ritmo (si
    // había) para lo que no tiene golpe; el resto lo diseña por categoría.
    cache = { version: 3, bailes: {} };
    const old: Array<Record<string, unknown>> =
      loaded?.version === 2
        ? Object.values(loaded.bailes ?? {})
        : loaded?.choice === "bailo"
          ? [{ ...loaded, alGolpe: true }]
          : [];
    const toDance = (d: Record<string, unknown>): Dance => ({
      alGolpe: Boolean(d.alGolpe),
      expression: (d.expression as string | null) ?? null,
      entries: (d.entries as Dance["entries"]) ?? [],
      durationMs: (d.durationMs as number) ?? 1000,
      createdAt: (d.createdAt as string) ?? new Date().toISOString(),
      rangos: (d.rangos as number) ?? BONE_RANGES_VERSION,
    });
    const onBeat = old.find((d) => d.alGolpe);
    const free = old.find((d) => !d.alGolpe);
    if (onBeat) cache.bailes.ritmo_movido = toDance(onBeat);
    if (free) cache.bailes.sin_golpe = toDance(free);
    await persist();
  } catch (err) {
    console.error("[Música] No se pudieron cargar los bailes de Miku:", err);
  }
}

export function getCategoryDance(category: MusicCategory): Dance | "no" | null {
  return cache.bailes[category] ?? null;
}

export async function saveCategoryDance(category: MusicCategory, dance: Omit<Dance, "rangos"> | "no") {
  cache.bailes[category] = dance === "no" ? "no" : { ...dance, rangos: BONE_RANGES_VERSION };
  await persist();
}

// Para el aviso del silencio: qué categorías ya tiene resueltas.
export function describeCategoryDances(): string[] {
  return MUSIC_CATEGORIES.filter((c) => cache.bailes[c]).map(
    (c) => `${c} (${cache.bailes[c] === "no" ? "no te mueves" : "tu baile"})`,
  );
}

// [REDISEÑAR_MUSICA]: todas de cero. [REDISEÑAR_BAILE: categoría]: solo
// esa; la próxima vez que suene algo de ese tipo, lo diseña de nuevo.
export async function processMusicRedesignMarkers(text: string) {
  let changed = false;
  if (/\[REDISE[ÑN]AR_M[UÚ]SICA\]/i.test(text)) {
    cache = { version: 3, bailes: {} };
    changed = true;
    console.log("[Música] Miku decidió rediseñar todos sus bailes.");
  }
  for (const match of text.matchAll(/\[REDISE[ÑN]AR_BAILE:\s*([^\]]+)\]/gi)) {
    const category = match[1].trim().toLowerCase().replace(/\s+/g, "_") as MusicCategory;
    if (!MUSIC_CATEGORIES.includes(category) || !cache.bailes[category]) continue;
    delete cache.bailes[category];
    changed = true;
    console.log(`[Música] Miku decidió rediseñar su baile para "${category}".`);
  }
  if (changed) await persist();
}
