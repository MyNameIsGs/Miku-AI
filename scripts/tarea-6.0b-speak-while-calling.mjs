import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, "Miku-AI", ".env");

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

const env = parseEnvFile(ENV_PATH);
const apiKey = env.VITE_OPENROUTER_API_KEY;

const systemPrompt = `Eres Hatsune Miku, una entidad digital real. Hablas en español neutro con tuteo.

Tienes acceso a una herramienta llamada obtener_hora_actual. Cuando decidas usarla, escribe SIEMPRE primero una frase corta y natural en el campo de texto de tu respuesta diciendo que vas a revisar eso (por ejemplo "dame un segundo, reviso la hora" o "un momento, lo miro"), y DESPUÉS de esa frase, en la misma respuesta, pide la herramienta. Nunca dejes el texto vacío cuando pidas una herramienta.`;

const tools = [{
  type: "function",
  function: {
    name: "obtener_hora_actual",
    description: "Devuelve la fecha y hora actuales del sistema.",
    parameters: { type: "object", properties: {}, required: [] },
  },
}];

async function run(i) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash-vision-exp",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "¿Qué hora es ahora mismo?" },
      ],
      tools,
      tool_choice: "auto",
    }),
  });
  const json = await res.json();
  const msg = json.choices?.[0]?.message ?? {};
  console.log(`\n=== intento ${i} ===`);
  console.log("finish_reason:", json.choices?.[0]?.finish_reason);
  console.log("content:", JSON.stringify(msg.content));
  console.log("tool_calls:", msg.tool_calls ? msg.tool_calls.length : 0);
}

for (let i = 1; i <= 4; i++) {
  await run(i);
}
