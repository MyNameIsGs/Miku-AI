import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", "Miku-AI", ".env");

function parseEnvFile(filePath) {
  const env = {};
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

const apiKey = parseEnvFile(ENV_PATH).VITE_OPENROUTER_API_KEY;

async function search(query, maxResults) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash-vision-exp",
      messages: [
        {
          role: "system",
          content:
            "Responde la pregunta del usuario usando la información encontrada. Sé breve.",
        },
        { role: "user", content: query },
      ],
      plugins: [{ id: "web", max_results: maxResults }],
    }),
  });
  const json = await res.json();
  return json;
}

async function main() {
  console.log("=== Test 1: pregunta que necesita info actual/reciente ===");
  const r1 = await search("¿Quién ganó el último Balón de Oro y cuándo se entregó?", 3);
  console.log(JSON.stringify(r1, null, 2).slice(0, 3000));

  console.log("\n\n=== Test 2: pregunta trivial, sin necesidad real de buscar ===");
  const r2 = await search("¿Cuánto es 2 + 2?", 2);
  console.log(JSON.stringify(r2, null, 2).slice(0, 2000));
}

main();
