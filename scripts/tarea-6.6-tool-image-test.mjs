import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, "..", "Miku-AI", ".env");
const ICON_PATH = path.join(__dirname, "..", "Miku-AI", "src-tauri", "icons", "128x128.png");

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
const iconBase64 = readFileSync(ICON_PATH).toString("base64");
const dataUrl = `data:image/png;base64,${iconBase64}`;

const tools = [{
  type: "function",
  function: {
    name: "ver_pantalla",
    description: "Toma una captura de la pantalla actual.",
    parameters: { type: "object", properties: {}, required: [] },
  },
}];

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

async function main() {
  const messages = [
    { role: "system", content: "Eres Miku. Cuando el usuario pida ver la pantalla, usa la herramienta ver_pantalla." },
    { role: "user", content: "Mira mi pantalla y decime qué ves." },
  ];

  const round1 = await post(messages);
  const choice1 = round1.choices?.[0];
  console.log("=== RONDA 1 ===");
  console.log("finish_reason:", choice1?.finish_reason);
  console.log("tool_calls:", JSON.stringify(choice1?.message?.tool_calls));

  if (choice1?.finish_reason !== "tool_calls") {
    console.log("No pidio la tool, no puedo probar el formato de imagen. Contenido:", choice1?.message?.content);
    return;
  }

  const toolCall = choice1.message.tool_calls[0];
  messages.push(choice1.message);

  // *** Lo que estoy probando: content como ARRAY multi-parte (texto + image_url) en un mensaje role: "tool" ***
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: [
      { type: "text", text: "Captura de pantalla tomada:" },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
  });

  console.log("\n=== RONDA 2 (con content multi-parte en el mensaje tool) ===");
  const round2 = await post(messages);
  console.log(JSON.stringify(round2, null, 2).slice(0, 2500));
}

main();
