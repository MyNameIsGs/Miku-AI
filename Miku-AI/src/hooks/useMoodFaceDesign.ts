import { RefObject, useEffect, useRef } from "react";
import { OPENROUTER_MODEL } from "../config/constants";
import { loadMemoryContext } from "../lib/memory";
import { fetchOpenRouterWithRetry } from "../lib/openrouter";
import { getSelfViewCapturer } from "../lib/selfViewStore";
import { getCachedMood } from "../lib/mood";
import { parseFaceMarker } from "../lib/faceParts";
import { MOODS_WITH_FACE, MoodWithFace, getMoodFace, loadMoodFaces, saveMoodFace } from "../lib/moodFaceStore";
import { buildMoodFacePrompt } from "../prompts/moodFacePrompt";

// Miku diseña su cara de reposo para cada ánimo (pedido de Sebastián). La
// primera vez que está en reposo con un ánimo que todavía no diseñó, se le
// pregunta; ve cómo le queda en una foto de su cara (con la cara puesta
// como vista previa, en la capa de fondo de useFace) y puede ajustarla una
// vez. Como mucho 4 consultas en total (una por ánimo).

const MOOD_WORDS: Record<MoodWithFace, string> = {
  happy: "contenta",
  sad: "triste",
  angry: "enojada",
  relaxed: "relajada",
};
// Cada cuánto se revisa, y cuánto en reposo antes de preguntar.
const CHECK_EVERY_MS = 3000;
const REST_BEFORE_ASKING_MS = 5000;
// Cuánto dejar la vista previa puesta antes de la foto (la cara se funde).
const PREVIEW_SETTLE_MS = 900;
const RETRY_AFTER_MS = 30 * 60 * 1000;

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
  const retryAfterRef = useRef<Partial<Record<MoodWithFace, number>>>({});

  useEffect(() => {
    loadMoodFaces();
  }, []);

  async function ask(messages: object[]) {
    const response = await fetchOpenRouterWithRetry({ model: OPENROUTER_MODEL, messages }, { kind: "diseñar cara de ánimo" });
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  }

  async function design(mood: MoodWithFace) {
    inFlightRef.current = true;
    try {
      const { world, personality, memories } = await loadMemoryContext();
      const now = new Date();
      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const prompt = buildMoodFacePrompt({ world, personality, memories, todayIso, moodWords: MOOD_WORDS[mood] });
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
      const capture = getSelfViewCapturer();
      if (capture) {
        try {
          previewFaceRef.current = face;
          await new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS));
          const { image } = capture("frente", "cara", null);
          const second = await ask([
            { role: "system", content: prompt },
            { role: "assistant", content: first },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Así se ve tu cara con eso puesto. Si te convence, responde solo [LISTO]. Si quieres ajustarla, responde otra vez con [CARA: ...] completa: reemplaza a la anterior. No repitas [GUARDAR_MEMORIA].",
                },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ]);
          face = parseFaceMarker(second) ?? face;
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
    const mood = getCachedMood();
    if (!(MOODS_WITH_FACE as string[]).includes(mood)) return;
    const m = mood as MoodWithFace;
    if (getMoodFace(m) || Date.now() < (retryAfterRef.current[m] ?? 0)) return;
    design(m);
  }

  return { check };
}
