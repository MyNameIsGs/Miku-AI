export async function fetchOpenRouterWithRetry(
  body: object,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<Response> {
  const delaysMs = [2000, 5000, 10000];
  let lastResponse: Response;

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    lastResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (lastResponse.status !== 429 || attempt === delaysMs.length) {
      return lastResponse;
    }

    const delay = delaysMs[attempt];
    console.log(
      `[INFO] OpenRouter devolvió 429, reintentando en ${delay}ms (intento ${attempt + 1}/${delaysMs.length})...`,
    );
    onRetry?.(attempt + 1, delaysMs.length, delay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return lastResponse!;
}
