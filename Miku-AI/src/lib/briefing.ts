import { load } from "@tauri-apps/plugin-store";

// Tarea 8.7: briefing automático al sentarse -- un flag simple con la
// fecha (YYYY-MM-DD local) del último día en que ya se dio el resumen, en
// .settings.dat (mismo store que gmailLastSeenIds y demás flags locales,
// no sincronizado por GitHub -- es puramente "hasta cuándo ya avisó esta
// PC", no hace falta que viaje entre dispositivos).
const STORE_KEY = "lastBriefingDate";

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function hasGivenBriefingToday(): Promise<boolean> {
  const store = await load(".settings.dat", { autoSave: false });
  const lastDate = await store.get<string>(STORE_KEY);
  return lastDate === todayLocalIso();
}

export async function markBriefingGivenToday() {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, todayLocalIso());
  await store.save();
}
