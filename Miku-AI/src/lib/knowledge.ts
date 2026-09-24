import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { VOICE_SERVER_URL } from "../config/constants";

// Tarea 8.11: memoria con recuperación semántica, solo para las memorias
// "de agente" -- saber práctico (cómo calibrar un movimiento, preferencias
// de Sebastián sobre avisos/apps, datos de su equipo). Viven en
// conocimiento.md y de ahí se traen solo las más parecidas a lo que se
// está hablando, así el archivo puede crecer sin pesar en cada mensaje.
//
// Las memorias "de Miku" (quién es ella, su relación con Sebastián) siguen
// en memories.md, cargadas COMPLETAS como siempre (ver memory.ts): su
// identidad nunca depende de que una búsqueda acierte.
//
// Fuente de verdad: conocimiento.md, texto plano, sincronizado por GitHub
// como el resto. El índice (conocimiento.index.json) es un caché local
// derivado: no se sincroniza y se reconstruye solo con lo que falte.

// Siempre se traen las N más parecidas, sin umbral: e5 da puntajes muy
// juntos (medido: 0.77-0.87 entre lo relevante y lo que no), así que un
// umbral fijo no separa bien. Incluir una de más cuesta unas líneas de
// prompt; perder una relevante es peor.
export const KNOWLEDGE_TOP_K = 6;

// Cambia si se cambia de modelo -- invalida el caché entero (vectores de
// modelos distintos no son comparables).
const EMBEDDING_MODEL_ID = "multilingual-e5-small-qint8";

const SEED_KNOWLEDGE = `# Conocimiento

(Saber práctico que Miku fue aprendiendo: cómo hacer cosas, preferencias de Sebastián, datos de su equipo. Cada entrada va separada por una línea en blanco. Solo se cargan las entradas relacionadas con la conversación del momento.)
`;

type KnowledgeIndex = {
  model: string;
  vectors: Record<string, number[]>;
};

async function knowledgePaths() {
  const memoryDir = await join(await appDataDir(), "memory");
  return {
    filePath: await join(memoryDir, "conocimiento.md"),
    indexPath: await join(memoryDir, "conocimiento.index.json"),
  };
}

export async function ensureKnowledgeFile() {
  const { filePath } = await knowledgePaths();
  if (!(await exists(filePath))) {
    await writeTextFile(filePath, SEED_KNOWLEDGE);
  }
}

// Una entrada = un bloque separado por línea en blanco. El título (#) y la
// descripción entre paréntesis del principio no son entradas.
function splitBlocks(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isEntryBlock(block: string): boolean {
  return !block.startsWith("#") && !block.startsWith("(");
}

function parseEntries(content: string): string[] {
  return splitBlocks(content).filter(isEntryBlock);
}

export async function loadKnowledgeEntries(): Promise<string[]> {
  await ensureKnowledgeFile();
  const { filePath } = await knowledgePaths();
  return parseEntries(await readTextFile(filePath));
}

export async function appendKnowledge(text: string) {
  await ensureKnowledgeFile();
  const { filePath } = await knowledgePaths();
  const current = await readTextFile(filePath);
  await writeTextFile(filePath, `${current.trim()}\n\n${text.trim()}\n`);
}

// Edición a mano desde el panel de memoria. La entrada se busca por su
// texto y no por posición: Miku puede agregar una mientras el panel está
// abierto, y así eso no corre los índices. Si ya no está (la cambió otra
// cosa entretanto), se avisa en vez de pisar algo equivocado.
//
// El índice de embeddings no se toca: vectorsForEntries descarta solo lo
// que ya no existe y calcula lo nuevo en la próxima búsqueda.
async function rewriteKnowledgeEntry(oldText: string, newText: string | null) {
  await ensureKnowledgeFile();
  const { filePath } = await knowledgePaths();
  const blocks = splitBlocks(await readTextFile(filePath));
  const target = oldText.trim();
  const i = blocks.findIndex((block) => isEntryBlock(block) && block === target);
  if (i === -1) {
    throw new Error("La entrada ya no está en conocimiento.md (¿cambió mientras tanto?)");
  }
  if (newText === null) {
    blocks.splice(i, 1);
  } else {
    // Sin líneas en blanco adentro: partirían la entrada en varias. Y sin
    // "#"/"(" al principio, que la convertirían en algo que no es entrada.
    const cleaned = newText.trim().replace(/\n\s*\n/g, "\n").replace(/^[#(]+\s*/, "");
    if (!cleaned) throw new Error("La entrada no puede quedar vacía");
    blocks[i] = cleaned;
  }
  await writeTextFile(filePath, `${blocks.join("\n\n")}\n`);
}

export async function updateKnowledgeEntry(oldText: string, newText: string) {
  await rewriteKnowledgeEntry(oldText, newText);
}

export async function deleteKnowledgeEntry(text: string) {
  await rewriteKnowledgeEntry(text, null);
}

async function embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
  const response = await fetch(`${VOICE_SERVER_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, kind }),
  });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.vectors)) {
    throw new Error(data.error ?? `El servidor de voz respondió ${response.status}`);
  }
  return data.vectors;
}

async function loadIndex(indexPath: string): Promise<KnowledgeIndex> {
  try {
    if (await exists(indexPath)) {
      const parsed = JSON.parse(await readTextFile(indexPath)) as KnowledgeIndex;
      if (parsed.model === EMBEDDING_MODEL_ID && parsed.vectors) return parsed;
    }
  } catch (err) {
    console.warn("[Conocimiento] Índice ilegible, se reconstruye:", err);
  }
  return { model: EMBEDDING_MODEL_ID, vectors: {} };
}

// Vectores de todas las entradas: reusa los del caché y calcula solo los
// que falten (entradas nuevas o editadas a mano). Las que ya no existen se
// sacan del caché.
async function vectorsForEntries(entries: string[]): Promise<number[][]> {
  const { indexPath } = await knowledgePaths();
  const index = await loadIndex(indexPath);

  const current = new Set(entries);
  const missing = entries.filter((entry) => !index.vectors[entry]);
  const stale = Object.keys(index.vectors).filter((key) => !current.has(key));

  if (missing.length > 0) {
    const newVectors = await embed(missing, "passage");
    missing.forEach((entry, i) => {
      index.vectors[entry] = newVectors[i];
    });
  }
  stale.forEach((key) => delete index.vectors[key]);

  if (missing.length > 0 || stale.length > 0) {
    await writeTextFile(indexPath, JSON.stringify(index));
  }
  return entries.map((entry) => index.vectors[entry]);
}

// Las entradas más relacionadas con `query`, de más a menos parecida. Si
// el servidor de voz no responde (todavía arrancando, por ejemplo), cae a
// las más recientes -- mejor contexto imperfecto que ninguno.
export async function retrieveKnowledge(
  query: string,
  k: number = KNOWLEDGE_TOP_K,
): Promise<string[]> {
  const entries = await loadKnowledgeEntries();
  if (entries.length === 0) return [];

  try {
    const [entryVectors, [queryVector]] = await Promise.all([
      vectorsForEntries(entries),
      embed([query.slice(0, 2000)], "query"),
    ]);
    // Vectores normalizados: el producto punto es la similitud coseno.
    const scored = entries.map((entry, i) => ({
      entry,
      score: entryVectors[i].reduce((sum, value, j) => sum + value * queryVector[j], 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.entry);
  } catch (err) {
    console.warn("[Conocimiento] Búsqueda semántica no disponible, uso las más recientes:", err);
    return entries.slice(-k);
  }
}
