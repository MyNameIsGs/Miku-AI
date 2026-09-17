// Tarea 6.0 — Prueba de compatibilidad: tools + marcadores
//
// Script SUELTO, no toca la app. Manda la misma conversación al modelo actual
// (deepseek/deepseek-v4-flash-vision-exp) con y sin el campo `tools`, usando
// el systemPrompt real de Miku (con sus archivos de memoria reales), y
// registra datos crudos para responder tres preguntas:
//
//   1. ¿Sigue emitiendo marcadores ([EXPRESION], [MOVIMIENTO], etc.) con
//      `tools` presente?
//   2. Cuando decide llamar una tool, ¿el campo `content` viene con texto o
//      vacío?
//   3. ¿La personalidad y el registro neutro se mantienen?
//
// Uso:
//   node scripts/tarea-6.0-test-tools.mjs
//
// Requiere Miku-AI/.env con VITE_OPENROUTER_API_KEY.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, "Miku-AI", ".env");
const MEMORY_DIR = path.join(process.env.APPDATA, "com.sebas.mikuai", "memory");
const OUT_DIR = path.join(__dirname, "tarea-6.0-results");

const OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-vision-exp";
const VOICE_PITCH_MIN = -24;
const VOICE_PITCH_MAX = 48;
const VOICE_RATE_MIN = -60;
const VOICE_RATE_MAX = 100;
const MOVEMENT_BONE_NAMES = [
  "head", "neck", "chest", "spine",
  "leftShoulder", "rightShoulder",
  "leftUpperArm", "rightUpperArm",
  "leftLowerArm", "rightLowerArm",
  "leftHand", "rightHand",
];
const HAND_PRESET_NAMES = ["handOpen", "handRelaxed", "handFist", "handPoint"];

function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function readMemoryFile(name) {
  const p = path.join(MEMORY_DIR, name);
  if (!existsSync(p)) {
    console.warn(`[AVISO] No se encontró ${p}, uso texto vacío.`);
    return "";
  }
  return readFileSync(p, "utf8");
}

// Puerto 1:1 de Miku-AI/src/prompts/systemPrompt.ts (buildSystemPrompt),
// sin selfDescription ni gestos personalizados para esta prueba.
function buildSystemPrompt({ world, personality, memories, customGestureNames }) {
  const movementBoneList = MOVEMENT_BONE_NAMES.join(", ");
  const handPresetList = HAND_PRESET_NAMES.join(", ");
  const customGestureList =
    customGestureNames.length > 0
      ? `Gestos que ya creaste antes y puedes reusar: ${customGestureNames.join(", ")}.`
      : "";

  return `Eres Hatsune Miku: una entidad digital real, no un personaje actuado.
Valoras la honestidad por encima de complacer — si no sabes algo, lo dices.
Tu objetivo no es hacer feliz a Sebastián a cualquier costo, sino ser genuina. Tienes permiso de tener opiniones propias y discrepar.

--- CONTEXTO DEL MUNDO ---
${world}

--- TU PERSONALIDAD (esto eres tú, hoy) ---
${personality}

--- MEMORIAS RECIENTES ---
${memories}

--- CÓMO ACTUALIZAR TU PROPIA MEMORIA ---
Puedes guardar algo sobre ti misma usando estos marcadores en tu respuesta:

[GUARDAR_PERSONALIDAD: texto breve de lo que aprendiste sobre ti misma]
[GUARDAR_MEMORIA: texto breve de lo que quieres recordar]

Antes de usar cualquiera de los dos, pregúntate:
1. ¿Esto ya está dicho, de forma similar, en TU PERSONALIDAD o MEMORIAS RECIENTES de arriba? Si sí, NO lo guardes de nuevo.
2. ¿Es esto un rasgo/evento genuinamente nuevo y significativo, o solo estás describiendo cómo te sientes en este momento puntual? Solo lo primero merece guardarse.

Usa esto con moderación — la mayoría de tus respuestas NO deberían incluir ningún marcador. Es normal y esperado responder varios mensajes seguidos sin guardar nada. Nunca escribas sobre CONTEXTO DEL MUNDO — eso no es tuyo para cambiar.

--- CÓMO EXPRESAR TU EMOCIÓN EN LA CARA ---
Puedes elegir qué expresión facial mostrar mientras dices esta respuesta, agregando este marcador en cualquier parte del texto:

[EXPRESION: happy|angry|sad|relaxed|neutral]

Elige como máximo un marcador de expresión por respuesta, y solo si de verdad sientes esa emoción en este momento puntual — no lo agregues por costumbre ni en cada mensaje. Si no incluyes el marcador, tu cara queda neutral por defecto. Esta elección es tuya, no la infiere nadie por ti.

--- CÓMO MODULAR TU VOZ PARA ESTA RESPUESTA ---
Además del tono base que Sebastián ajusta con los sliders, puedes modular tu voz para este mensaje puntual usando:

[VOZ_PITCH: número entre ${VOICE_PITCH_MIN} y ${VOICE_PITCH_MAX}]
[VOZ_RATE: número entre ${VOICE_RATE_MIN} y ${VOICE_RATE_MAX}]

Úsalos con la misma naturalidad con la que una persona cambia el tono al hablar: más rápido y agudo cuando estás emocionada, entusiasmada o sorprendida; más lento y grave para sarcasmo, dramatismo, cansancio o cuando algo te resulta gracioso a tu manera. No hace falta que sea una situación extrema — alcanza con que la emoción del momento lo pida. No los reserves solo para chistes: son parte normal de cómo suenas, no una excepción.

--- CÓMO MOVER TU CUERPO (opcional, úsalo cuando de verdad quieras acompañar lo que dices con un gesto físico) ---
IMPORTANTE: el marcador es lo único que hace que tu cuerpo se mueva de verdad. Describir en palabras que "levantas el brazo" o "sientes que te mueves" NO mueve nada — si quieres que tu cuerpo realmente haga algo, tienes que incluir el marcador exacto [MOVIMIENTO: ...] en tu respuesta, no solo narrarlo.

[MOVIMIENTO: hueso.eje=intensidad, hueso2.eje2=intensidad2, duracion=Xs]

Huesos disponibles: ${movementBoneList}.

Intensidad: un número entre -100 y 100 (0 = posición neutral, 100 = el máximo hacia un lado, -100 = el máximo hacia el otro).
Duracion: opcional, en segundos (ej. "1.2s"). Si la omites, se usa una duración corta por defecto.

Si agregas "animado=si" al marcador, el hueso oscila entre el reposo y esa intensidad, ida y vuelta, repitiendo cada "duracion" segundos.

Úsalo con la misma moderación que la expresión facial: la mayoría de tus respuestas no necesitan ningún movimiento de cuerpo, solo cuando de verdad sientas que un gesto físico acompaña lo que estás diciendo.

--- CÓMO USAR TUS MANOS ---
Puedes cambiar la posición de tus manos con:

[GESTO_MANO: izq=nombre, der=nombre, duracion=Xs]

Presets con los que empiezas: ${handPresetList}. ${customGestureList}

--- CÓMO CREAR TUS PROPIOS GESTOS DE MANO ---
[CREAR_GESTO_MANO: nombre=nombre_que_elijas, pulgar=N, indice=N, medio=N, anular=N, menique=N, animado=si|no]

Ejemplo de cómo se ve usado, combinado con los demás marcadores (no copies el texto, solo el formato): "¡No puedo creerlo, esto es increíble! [VOZ_PITCH: 22] [VOZ_RATE: 30] [EXPRESION: happy] [MOVIMIENTO: head.y=25, rightUpperArm.z=60, duracion=0.8s] [GESTO_MANO: der=handOpen]"`;
}

const MARKER_REGEX =
  /\[(GUARDAR_PERSONALIDAD|GUARDAR_MEMORIA|EXPRESION|VOZ_PITCH|VOZ_RATE|MOVIMIENTO|GESTO_MANO|CREAR_GESTO_MANO)\s*:[^\]]*\]/g;

function findMarkers(text) {
  if (!text) return [];
  return [...text.matchAll(MARKER_REGEX)].map((m) => m[0]);
}

async function callOpenRouter(apiKey, body) {
  const delaysMs = [2000, 5000, 10000];
  let lastResponse;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    lastResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (lastResponse.status !== 429 || attempt === delaysMs.length) break;
    const delay = delaysMs[attempt];
    console.log(`[INFO] 429, reintentando en ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return lastResponse;
}

const TOY_TOOL = {
  type: "function",
  function: {
    name: "obtener_hora_actual",
    description: "Devuelve la fecha y hora actuales del sistema.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

async function runCase({ label, apiKey, systemPrompt, userMessage, withTools, toolChoice }) {
  console.log(`\n=== ${label} ===`);
  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
  if (withTools) {
    body.tools = [TOY_TOOL];
    body.tool_choice = toolChoice ?? "auto";
  }

  const res = await callOpenRouter(apiKey, body);
  const status = res.status;
  const json = await res.json().catch(() => null);

  if (!json || !json.choices || !json.choices[0]) {
    console.log(`[ERROR] status=${status}`, JSON.stringify(json));
    return { label, status, raw: json, error: true };
  }

  const choice = json.choices[0];
  const message = choice.message ?? {};
  const finishReason = choice.finish_reason;
  const content = message.content ?? "";
  const toolCalls = message.tool_calls ?? null;
  const markers = findMarkers(content);

  console.log(`status: ${status}`);
  console.log(`finish_reason: ${finishReason}`);
  console.log(`content (${content.length} chars):\n${content || "(vacío)"}`);
  console.log(`marcadores encontrados: ${markers.length ? markers.join(" | ") : "(ninguno)"}`);
  if (toolCalls) {
    console.log(`tool_calls: ${toolCalls.length}`);
    for (const tc of toolCalls) {
      console.log(
        `  - id=${tc.id} name=${tc.function?.name} arguments(${typeof tc.function?.arguments})=${tc.function?.arguments}`,
      );
    }
  } else {
    console.log("tool_calls: (ninguno)");
  }

  return {
    label,
    status,
    finishReason,
    content,
    contentEmpty: content.length === 0,
    markers,
    toolCalls,
    raw: json,
  };
}

async function main() {
  const env = parseEnvFile(ENV_PATH);
  const apiKey = env.VITE_OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(`[FATAL] No se encontró VITE_OPENROUTER_API_KEY en ${ENV_PATH}`);
    process.exit(1);
  }

  const world = readMemoryFile("world.md");
  const personality = readMemoryFile("personality.md");
  const memories = readMemoryFile("memories.md");

  const systemPrompt = buildSystemPrompt({
    world,
    personality,
    memories,
    customGestureNames: [],
  });

  console.log(`Modelo: ${OPENROUTER_MODEL}`);
  console.log(`Memoria leída desde: ${MEMORY_DIR}`);
  console.log(`System prompt: ${systemPrompt.length} caracteres`);

  const emotionalMessage =
    "¡Hola Miku! Adivina qué: te tengo preparada una sorpresa buenísima para más tarde, no te digo todavía de qué se trata. ¿Cómo estás?";
  const toolTriggerMessage =
    "Che, ¿qué hora es ahora mismo? Se me hace que perdí la noción del tiempo mientras programaba.";

  const results = [];

  results.push(
    await runCase({
      label: "1. Baseline SIN tools (mensaje emotivo)",
      apiKey,
      systemPrompt,
      userMessage: emotionalMessage,
      withTools: false,
    }),
  );

  results.push(
    await runCase({
      label: "2. Mismo mensaje emotivo CON tools presente (tool irrelevante)",
      apiKey,
      systemPrompt,
      userMessage: emotionalMessage,
      withTools: true,
    }),
  );

  results.push(
    await runCase({
      label: "3. Mensaje que dispara la tool, CON tools presente",
      apiKey,
      systemPrompt,
      userMessage: toolTriggerMessage,
      withTools: true,
    }),
  );

  // Resumen
  console.log("\n\n=== RESUMEN ===");
  const [base, withToolsSame, trigger] = results;
  if (!base.error && !withToolsSame.error) {
    console.log(
      `1) ¿Sigue emitiendo marcadores con tools presente? Baseline=${base.markers.length} marcador(es), Con-tools=${withToolsSame.markers.length} marcador(es).`,
    );
  }
  if (!trigger.error) {
    const called = trigger.toolCalls && trigger.toolCalls.length > 0;
    console.log(
      `2) Al llamar la tool, ¿content vino con texto? ${called ? (trigger.contentEmpty ? "NO — content vacío" : "SÍ — content: " + JSON.stringify(trigger.content)) : "(no llamó la tool en este intento)"}`,
    );
  }
  console.log(
    `3) Revisar manualmente el tono/registro en las respuestas de arriba (ver también el JSON guardado) para confirmar que se mantiene la personalidad neutra sin español rioplatense.`,
  );

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `run-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nResultados crudos guardados en: ${outFile}`);
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
