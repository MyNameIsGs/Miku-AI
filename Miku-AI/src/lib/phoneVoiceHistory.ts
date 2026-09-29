import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { PhoneVoiceEntry } from "./diaryDay";

// Lo que habló con Sebastián por voz en el celular ("Hey Miku"), para el
// diario. Android lo escribe en Miku-AI/memory/voice_history.json con la
// API de GitHub; la copia local de la PC es la del último pull (al abrir),
// así que primero se lee de GitHub (lo de hoy) y, si no se puede, la local.

const API = "https://api.github.com/repos/MyNameIsGs/Miku-AI/contents/Miku-AI/memory/voice_history.json";

export function parsePhoneVoiceHistory(text: string): PhoneVoiceEntry[] {
  try {
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is PhoneVoiceEntry =>
        typeof e?.heard === "string" && typeof e?.reply === "string" && typeof e?.timestampMs === "number",
    );
  } catch {
    return [];
  }
}

async function readFromGitHub(): Promise<string | null> {
  const token = import.meta.env.VITE_GITHUB_TOKEN;
  if (typeof token !== "string" || !token.trim()) return null;
  const response = await fetch(`${API}?ref=main`, {
    headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json();
  return new TextDecoder().decode(Uint8Array.from(atob(String(data.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}

export async function readPhoneVoiceHistory(): Promise<PhoneVoiceEntry[]> {
  try {
    const remote = await readFromGitHub();
    if (remote !== null) return parsePhoneVoiceHistory(remote);
  } catch (err) {
    console.warn("[Diario] No se pudo leer la voz del celular de GitHub, uso la copia local:", err);
  }
  try {
    const path = await join(await appDataDir(), "memory", "voice_history.json");
    return (await exists(path)) ? parsePhoneVoiceHistory(await readTextFile(path)) : [];
  } catch {
    return [];
  }
}
