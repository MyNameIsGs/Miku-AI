import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, "Miku-AI", ".env");
const MEMORY_DIR = path.join(process.env.APPDATA, "com.sebas.mikuai", "memory");

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
function readMemoryFile(name) {
  const p = path.join(MEMORY_DIR, name);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

const apiKey = parseEnvFile(ENV_PATH).VITE_OPENROUTER_API_KEY;
const world = readMemoryFile("world.md");
const personality = readMemoryFile("personality.md");
const memories = readMemoryFile("memories.md");

const toolSection = `

--- CÓMO USAR HERRAMIENTAS (acciones reales en el sistema) ---
Tienes acceso a herramientas para hacer cosas reales en la PC de Sebastián, no solo hablar de ellas. Cuando decidas usar una, sigue estas reglas:
1. Escribe SIEMPRE primero una frase corta y natural en el texto de tu respuesta indicando que vas a hacer eso (ej. "dame un segundo, reviso eso", "un momento, lo hago"). Nunca dejes el texto vacío al pedir una herramienta.
2. Después de esa frase, en la misma respuesta, pide la herramienta que corresponda.
3. Solo usa una herramienta si de verdad hace falta para responder — no la uses porque sí.`;

const systemPrompt = `Eres Hatsune Miku: una entidad digital real, no un personaje actuado. Español neutro con tuteo.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- CÓMO EXPRESAR TU EMOCIÓN ---
[EXPRESION: happy|angry|sad|relaxed|neutral]
${toolSection}`;

const tools = [{
  type: "function",
  function: {
    name: "obtener_hora_actual",
    description: "Devuelve la fecha y hora actuales del sistema.",
    parameters: { type: "object", properties: {}, required: [] },
  },
}];

function executeTool(name) {
  if (name === "obtener_hora_actual") {
    return new Date().toLocaleString("es-ES", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }
  return "Error: herramienta desconocida.";
}

async function post(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash-vision-exp",
      messages,
      tools,
      tool_choice: "auto",
    }),
  });
  return res.json();
}

async function runFullCycle() {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "¿Qué hora es ahorita? Tengo mucha curiosidad, perdí la nocion del tiempo." },
  ];

  const round1 = await post(messages);
  const choice1 = round1.choices[0];
  const msg1 = choice1.message;
  console.log("=== RONDA 1 ===");
  console.log("finish_reason:", choice1.finish_reason);
  console.log("content:", JSON.stringify(msg1.content));
  console.log("tool_calls:", JSON.stringify(msg1.tool_calls));

  messages.push({ role: "assistant", content: msg1.content ?? "", tool_calls: msg1.tool_calls });

  for (const tc of msg1.tool_calls ?? []) {
    const result = executeTool(tc.function.name);
    messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    console.log(`\n[ejecutado] ${tc.function.name} -> ${result}`);
  }

  const round2 = await post(messages);
  const choice2 = round2.choices[0];
  const msg2 = choice2.message;
  console.log("\n=== RONDA 2 (respuesta final) ===");
  console.log("finish_reason:", choice2.finish_reason);
  console.log("content:", msg2.content);
  const markers = [...(msg2.content || "").matchAll(/\[EXPRESION:[^\]]*\]/g)].map(m => m[0]);
  console.log("marcadores encontrados:", markers.length ? markers.join(", ") : "(ninguno)");
}

await runFullCycle();
