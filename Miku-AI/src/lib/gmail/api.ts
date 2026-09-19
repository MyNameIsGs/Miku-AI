import { loadGmailAccounts, getValidAccessTokenFor } from "./auth";

export type GmailMessageSummary = {
  account: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
};

async function gmailFetch(accessToken: string, path: string): Promise<Response> {
  return fetch(`https://www.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function headerValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Privacidad por diseño (ver §14 del contexto sobre Nivel 3 de la 6.7):
// pide format=metadata, que trae solo encabezados (De/Asunto/Fecha) más el
// "snippet" corto que la propia API de Gmail genera (un preview de un par
// de líneas) -- nunca el cuerpo completo del correo. Es lo único que viaja
// a OpenRouter/DeepSeek cuando Miku use esto en una respuesta.
async function listRecentMessagesForAccount(
  accessToken: string,
  accountEmail: string,
  maxResults: number,
  daysBack: number,
): Promise<GmailMessageSummary[]> {
  const listParams = new URLSearchParams({
    q: `newer_than:${daysBack}d`,
    maxResults: String(maxResults),
  });
  const listResponse = await gmailFetch(accessToken, `/messages?${listParams.toString()}`);
  if (!listResponse.ok) {
    throw new Error(`Error listando correos de ${accountEmail}: ${await listResponse.text()}`);
  }
  const listData = await listResponse.json();
  const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

  const summaries: GmailMessageSummary[] = [];
  for (const id of ids) {
    const params = new URLSearchParams({ format: "metadata" });
    params.append("metadataHeaders", "Subject");
    params.append("metadataHeaders", "From");
    params.append("metadataHeaders", "Date");
    const response = await gmailFetch(accessToken, `/messages/${id}?${params.toString()}`);
    if (!response.ok) continue;
    const data = await response.json();
    const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
    summaries.push({
      account: accountEmail,
      from: headerValue(headers, "From"),
      subject: headerValue(headers, "Subject"),
      date: headerValue(headers, "Date"),
      snippet: data.snippet ?? "",
    });
  }
  return summaries;
}

// Revisa TODAS las cuentas de Gmail conectadas (Sebastián usa varias) y
// junta los resultados, marcando de qué cuenta vino cada correo. Si una
// cuenta puntual falla (token vencido y no se pudo refrescar, error de
// red, etc.) se la salta y sigue con las demás -- un problema en una
// cuenta no debería tapar los resultados de las otras.
export async function listRecentMessagesAllAccounts(
  maxResults = 15,
  daysBack = 7,
): Promise<GmailMessageSummary[]> {
  const accounts = await loadGmailAccounts();
  if (accounts.length === 0) {
    throw new Error(
      "Gmail no está conectado -- Sebastián tiene que conectar al menos una cuenta desde el panel de Config.",
    );
  }

  const results: GmailMessageSummary[] = [];
  for (const account of accounts) {
    const token = await getValidAccessTokenFor(account.email);
    if (!token) continue; // se desconectó sola -- token vencido o revocado
    try {
      const messages = await listRecentMessagesForAccount(
        token,
        account.email,
        maxResults,
        daysBack,
      );
      results.push(...messages);
    } catch (err) {
      console.error(`Error revisando la cuenta ${account.email}:`, err);
    }
  }
  return results;
}
