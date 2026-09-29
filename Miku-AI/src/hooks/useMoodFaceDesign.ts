import { RefObject, useEffect, useRef } from "react";
import { OPENROUTER_MODEL } from "../config/constants";
import { loadMemoryContext } from "../lib/memory";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { getSelfViewCapturer } from "../lib/selfViewStore";
import { getRestingFaceKey } from "../lib/mood";
import { describeFace, parseFaceMarker } from "../lib/faceParts";
import {
  FACE_KEYS,
  FaceKey,
  MoodWithFace,
  getMoodFace,
  getPreviousMoodFace,
  loadMoodFaces,
  saveMoodFace,
} from "../lib/moodFaceStore";
import { buildMoodFacePrompt } from "../prompts/moodFacePrompt";

// Miku diseña su cara de reposo para cada ánimo (pedido de Sebastián). La
// primera vez que está en reposo con un ánimo que todavía no diseñó, se le
// pregunta; ve cómo le queda en una foto de su cara (con la cara puesta
// como vista previa, en la capa de fondo de useFace) y puede ajustarla y
// volver a verse hasta REVIEW_ROUNDS veces. Una vez por ánimo, y otra cada
// vez que se pide rediseñarla (ella en un silencio, o Sebastián en Memoria).

const BASE_WORDS: Record<MoodWithFace, string> = {
  happy: "contenta",
  sad: "triste",
  angry: "enojada",
  relaxed: "relajada",
};
// Una cara por nivel (ver moodFaceStore.ts): "happy" = contenta,
// "happy_muy" = muy contenta.
const MOOD_WORDS = Object.fromEntries(
  FACE_KEYS.map((k) => [k, k.endsWith("_muy") ? `muy ${BASE_WORDS[k.replace(/_muy$/, "") as MoodWithFace]}` : BASE_WORDS[k as MoodWithFace]]),
) as Record<FaceKey, string>;
// Cada cuánto se revisa, y cuánto en reposo antes de preguntar.
const CHECK_EVERY_MS = 3000;
const REST_BEFORE_ASKING_MS = 5000;
// Cuánto dejar la vista previa puesta antes de la foto (la cara se funde).
const PREVIEW_SETTLE_MS = 900;
const RETRY_AFTER_MS = 30 * 60 * 1000;
// Cuántas veces puede verse y ajustar antes de que quede guardada.
const REVIEW_ROUNDS = 3;

type UseMoodFaceDesignParams = {
  previewFaceRef: RefObject<string | null>;
  getExpression: () => string;
  isSpeakingRef: RefObject<boolean>;
  asleepRef: RefObject<boolean>;
  processMemoryMarkers: (reply: string) => Promise<void>;
};

export function useMoodFaceDesign({
  previewFaceRef,
  getExpression,
  isSpeakingRef,
  asleepRef,
  processMemoryMarkers,
}: UseMoodFaceDesignParams) {
  const lastCheckRef = useRef(0);
  const notRestSinceRef = useRef(0);
  const inFlightRef = useRef(false);
  const retryAfterRef = useRef<Partial<Record<FaceKey, number>>>({});

  useEffect(() => {
    loadMoodFaces();
  }, []);

  async function ask(messages: object[]) {
    const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind: "diseñar cara de ánimo" });
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  }

  async function design(mood: FaceKey) {
    inFlightRef.current = true;
    try {
      const { world, personality, memories } = await loadMemoryContext();
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const prev = getPreviousMoodFace(mood);
      const previous = prev
        ? { face: prev.face === "ninguna" ? "que no se te notara en la cara" : describeFace(prev.face), byUser: prev.byUser }
        : null;
      const baseKey = mood.replace(/_muy$/, "") as FaceKey;
      const baseFace = mood !== baseKey ? getMoodFace(baseKey) : null;
      const normalLevelFace =
        baseFace && baseFace !== "ninguna" ? { words: MOOD_WORDS[baseKey], face: describeFace(baseFace) } : null;
      const prompt = buildMoodFacePrompt({ world, personality, memories, todayIso, moodWords: MOOD_WORDS[mood], previous, normalLevelFace });
      const first = await ask([{ role: "system", content: prompt }]);
      await processMemoryMarkers(first);

      if (/\[SIN_CARA\]/i.test(first)) {
        await saveMoodFace(mood, "ninguna");
        console.log(`[Cara] Estando ${MOOD_WORDS[mood]}, Miku prefiere que no se le note en la cara.`);
        return;
      }
      let face = parseFaceMarker(first);
      if (!face) throw new Error(`respuesta sin [CARA] ni [SIN_CARA]: ${first.slice(0, 160)}`);

      // Que se vea cómo le queda: la cara puesta como vista previa, una foto.
      // Puede ajustarla y volver a verse hasta REVIEW_ROUNDS veces (antes
      // era una sola revisión, y la cara de "contenta" quedó rara: un guiño
      // a medias y ojos felices al 30 %).
      const capture = getSelfViewCapturer();
      if (capture) {
        try {
          const messages: object[] = [
            { role: "system", content: prompt },
            { role: "assistant", content: first },
          ];
          for (let round = 1; round <= REVIEW_ROUNDS; round++) {
            previewFaceRef.current = face;
            await new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS));
            const { image } = capture("frente", "cara", null);
            const last = round === REVIEW_ROUNDS;
            messages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Así se ve tu cara con eso puesto. Mírala como la vería otra persona: ¿se ve como la cara de alguien ${MOOD_WORDS[mood]} y en silencio, de verdad? Fíjate si algo se ve raro, forzado o desparejo entre un lado y el otro. Si te convence, responde solo [LISTO]. Si no, responde con [CARA: ...] completa: reemplaza a la anterior${last ? " (es la última vez que te ves antes de que quede guardada)" : " y vas a volver a verte"}. No repitas [GUARDAR_MEMORIA].`,
                },
                { type: "image_url", image_url: { url: image } },
              ],
            });
            const reply = await ask(messages);
            const adjusted = parseFaceMarker(reply);
            if (!adjusted) break; // [LISTO]
            face = adjusted;
            messages.push({ role: "assistant", content: reply });
          }
        } catch (err) {
          console.warn("[Cara] No se pudo mostrarle cómo le queda; queda la primera versión:", err);
        } finally {
          previewFaceRef.current = null;
        }
      }
      await saveMoodFace(mood, face);
      console.log(`[Cara] Miku diseñó su cara de ${MOOD_WORDS[mood]}: ${face}`);
    } catch (err) {
      console.warn(`[Cara] No se pudo diseñar la cara de "${mood}"; se reintenta más tarde:`, err);
      retryAfterRef.current[mood] = Date.now() + RETRY_AFTER_MS;
    } finally {
      inFlightRef.current = false;
    }
  }

  // Se llama en cada cuadro; casi siempre no hace nada.
  function check(now: number) {
    const atRest = getExpression() === "neutral" && !isSpeakingRef.current && !asleepRef.current;
    if (!atRest) notRestSinceRef.current = now;
    if (now - lastCheckRef.current < CHECK_EVERY_MS) return;
    lastCheckRef.current = now;
    if (inFlightRef.current || !atRest || now - notRestSinceRef.current < REST_BEFORE_ASKING_MS) return;
    // La cara del nivel en que está ahora: nada con "un poco" (la cara no
    // cambia); "happy" contenta, "happy_muy" muy contenta.
    const key = getRestingFaceKey();
    if (!(FACE_KEYS as string[]).includes(key)) return;
    const m = key as FaceKey;
    if (getMoodFace(m) || Date.now() < (retryAfterRef.current[m] ?? 0)) return;
    design(m);
  }

  return { check };
}
