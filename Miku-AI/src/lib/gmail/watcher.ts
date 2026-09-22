import { load } from "@tauri-apps/plugin-store";
import { loadGmailAccounts, getValidAccessTokenFor } from "./auth";
import { getLatestMessageForAccount } from "./api";

// Avisar cuando llega correo nuevo, en vez de depender de que el loop
// idle lo mencione de pasada (idea original #8 del plan) -- pedido por
// Sebastián en vivo ("no tener 10 pestañas de correo abiertas"), mismo
// mecanismo ya implementado en Android (GmailWatcher.kt): compara el id
// del mensaje más reciente de cada cuenta contra el último visto y solo
// anuncia si cambió. El último visto es puramente local (.settings.dat,
// no sincronizado por GitHub) -- es solo "hasta dónde ya avisó esta PC",
// sincronizarlo entre dispositivos no aportaría nada.
const STORE_KEY = "gmailLastSeenIds";

// Idea #8 (de verdad, no la variante simple de "avisar que llegó algo"):
// en vez de armar acá un texto con plantilla fija, se devuelven los
// candidatos crudos -- useGmailWatcher.ts le pasa esto al LLM para que
// decida, en personaje, si vale la pena mencionarlo y con qué palabras
// (ver prompts/mailPrompt.ts). SKIP_LABELS sigue siendo un primer filtro
// barato (spam/promos evidentes, sin gastar tokens en descartarlos).
export type GmailCandidate = {
  from: string;
  subject: string;
  snippet: string;
};

// Mismo criterio de "filtrar spam/promociones" que ya estaba anotado en
// la idea original, y el mismo conjunto que usa Android.
const SKIP_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "SPAM",
  "CATEGORY_FORUMS",
]);

async function loadLastSeenIds(): Promise<Record<string, string>> {
  const store = await load(".settings.dat", { autoSave: false });
  return (await store.get<Record<string, string>>(STORE_KEY)) ?? {};
}

async function saveLastSeenIds(ids: Record<string, string>) {
  const store = await load(".settings.dat", { autoSave: false });
  await store.set(STORE_KEY, ids);
  await store.save();
}

// La primera vez que se revisa una cuenta (sin id previo guardado) NO se
// anuncia nada -- solo establece la base, para no leer en voz alta todo
// lo que ya estaba en la bandeja antes de activar esto.
export async function checkForNewMail(): Promise<GmailCandidate[] | null> {
  const accounts = await loadGmailAccounts();
  if (accounts.length === 0) return null;

  const lastSeen = await loadLastSeenIds();
  const candidates: GmailCandidate[] = [];

  for (const account of accounts) {
    const token = await getValidAccessTokenFor(account.email);
    if (!token) continue;

    let latest;
    try {
      latest = await getLatestMessageForAccount(token, account.email);
    } catch (err) {
      console.error(`Error revisando correo nuevo de ${account.email}:`, err);
      continue;
    }
    if (!latest) continue;

    const previousId = lastSeen[account.email];
    lastSeen[account.email] = latest.id;

    if (!previousId || previousId === latest.id) continue;
    if (latest.labelIds.some((label) => SKIP_LABELS.has(label))) continue;

    candidates.push({
      from: latest.from,
      subject: latest.subject,
      snippet: latest.snippet,
    });
  }

  await saveLastSeenIds(lastSeen);
  return candidates.length > 0 ? candidates : null;
}
