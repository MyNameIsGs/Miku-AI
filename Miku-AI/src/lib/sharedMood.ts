import { MoodState, VALID_MOODS } from "./moodModel";

// Ánimo compartido entre la PC y el celular (2026-09-28, pedido de
// Sebastián: "una sola mente"). Vive en Miku-AI/memory/estado_animo.json y
// se lee y escribe con la API de GitHub archivo por archivo (como hace
// Android con la memoria), NO con la sincronización por git: la PC hace
// commit+push sin traer antes lo del celular, y con un archivo que cambian
// los dos lados varias veces al día eso terminaría en choques que traban
// toda la memoria. Cada escritura lleva el sha que leyó; si otro lado
// escribió en el medio, se relee y gana el más reciente (setAt).
//
// Necesita VITE_GITHUB_TOKEN en .env (el mismo token que usa el celular).
// Sin token, el ánimo de la PC sigue siendo solo local.

const PATH = "Miku-AI/memory/estado_animo.json";
const API = `https://api.github.com/repos/MyNameIsGs/Miku-AI/contents/${PATH}`;

export type SharedMoodFile = MoodState & { device: "pc" | "celular" };

function token(): string | null {
  const t = import.meta.env.VITE_GITHUB_TOKEN;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

export function sharedMoodEnabled(): boolean {
  return token() !== null;
}

// Valida lo leído: un archivo roto no debe romper el ánimo.
export function parseSharedMood(text: string): SharedMoodFile | null {
  try {
    const s = JSON.parse(text);
    if (!(VALID_MOODS as readonly string[]).includes(s?.mood)) return null;
    if (typeof s.intensity !== "number" || typeof s.halfLifeMs !== "number" || typeof s.setAt !== "number") return null;
    return { mood: s.mood, intensity: s.intensity, halfLifeMs: s.halfLifeMs, setAt: s.setAt, device: s.device === "celular" ? "celular" : "pc" };
  } catch {
    return null;
  }
}

async function readRemote(): Promise<{ state: SharedMoodFile | null; sha: string | null }> {
  const t = token();
  if (!t) return { state: null, sha: null };
  const response = await fetch(`${API}?ref=main`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (response.status === 404) return { state: null, sha: null };
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
  const data = await response.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(String(data.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  return { state: parseSharedMood(text), sha: data.sha ?? null };
}

// El del otro lado, si es más nuevo que `local`; si no, null.
export async function fetchNewerSharedMood(local: MoodState): Promise<SharedMoodFile | null> {
  if (!token()) return null;
  const { state } = await readRemote();
  return state && state.setAt > local.setAt ? state : null;
}

// Publica el de la PC. Si mientras tanto el celular escribió uno más nuevo,
// no lo pisa: lo devuelve para que la PC lo adopte.
export async function publishSharedMood(local: MoodState): Promise<SharedMoodFile | null> {
  const t = token();
  if (!t) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state: remote, sha } = await readRemote();
    if (remote && remote.setAt >= local.setAt) return remote.setAt > local.setAt ? remote : null;
    const body: SharedMoodFile = { ...local, device: "pc" };
    const response = await fetch(API, {
      method: "PUT",
      headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "memory: ánimo (pc)",
        content: btoa(JSON.stringify(body, null, 2)),
        ...(sha ? { sha } : {}),
        branch: "main",
      }),
    });
    if (response.ok) return null;
    // 409/422: el sha cambió (escribió el otro lado): se relee y se compara de nuevo.
    if (response.status !== 409 && response.status !== 422) throw new Error(`GitHub respondió ${response.status}`);
  }
  return null;
}
