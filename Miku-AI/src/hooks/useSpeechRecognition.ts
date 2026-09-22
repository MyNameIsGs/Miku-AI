import { useRef, useState, Dispatch, SetStateAction } from "react";

type UseSpeechRecognitionParams = {
  isVoiceReady: boolean;
  setTranscript: Dispatch<SetStateAction<string>>;
  setShowTextInput: Dispatch<SetStateAction<boolean>>;
};

const TRANSCRIBE_URL = "http://127.0.0.1:8899/transcribe";
const TRANSCRIBE_PARTIAL_URL = "http://127.0.0.1:8899/transcribe/partial";

// Tarea 5.4b: cada cuánto le pedimos a MediaRecorder un chunk nuevo (para
// tener algo que mandar) y cada cuánto se manda el buffer acumulado a
// transcribir en vivo. Valores de arranque, sin calibrar contra el uso
// real -- si se siente muy lento o muy espasmódico, ajustar acá primero.
const CHUNK_TIMESLICE_MS = 250;
const PARTIAL_TRANSCRIBE_INTERVAL_MS = 700;

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

// Ajuste post-primera-versión: comparar solo con minúsculas y sin
// puntuación, porque Whisper puede devolver una palabra ya confirmada con
// distinta mayúscula/acento/coma entre una pasada y la siguiente (más
// contexto de audio puede cambiar cómo puntúa, no solo qué palabra eligió)
// -- comparar el texto crudo hacía que casi ninguna palabra se confirmara
// nunca.
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[.,!?¿¡;:"'…]/g, "");
}

function commonPrefixLength(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && normalizeWord(a[i]) === normalizeWord(b[i])) i++;
  return i;
}

export function useSpeechRecognition({
  isVoiceReady,
  setTranscript,
  setShowTextInput,
}: UseSpeechRecognitionParams) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Tarea 8.1: cuando el corte de grabación lo dispara el VAD (no un click
  // manual, ver autoStopListening), quien pidió el corte quiere el texto
  // final para mandarlo solo -- "voz sin manos" de verdad no debería
  // necesitar un click de "Enviar" después. Un corte manual (toggleListening)
  // no resuelve nada acá, deja el texto en el cuadro para revisar como
  // siempre.
  const pendingAutoStopResolveRef = useRef<((text: string) => void) | null>(null);
  const partialIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const partialInFlightRef = useRef(false);
  // Palabras del último resultado parcial (crudas, para comparar contra la
  // próxima pasada) y palabras ya "confirmadas" (las que se muestran, solo
  // crecen, nunca se acortan).
  const previousWordsRef = useRef<string[]>([]);
  const confirmedWordsRef = useRef<string[]>([]);

  // Tarea 5.4b: transcripción incremental -- reusa el mismo Whisper ya
  // cargado (sin motor nuevo, ver §6.26 del contexto). No es streaming real
  // (Whisper no está pensado para eso) -- es la política "LocalAgreement":
  // cada tick se manda TODO el audio grabado hasta ahora (más largo cada
  // vez) a /transcribe/partial, pero una palabra solo se muestra una vez
  // que aparece igual en dos resultados seguidos -- así Whisper puede
  // seguir "cambiando de idea" con las últimas palabras sin que se note
  // como parpadeo en lo que ya se mostró (lo que hacía sentir la primera
  // versión poco suave). Se salta el tick si el anterior todavía no
  // volvió, para no amontonar pedidos si la GPU se atrasa.
  const startPartialTranscription = (mimeType: string) => {
    previousWordsRef.current = [];
    confirmedWordsRef.current = [];

    partialIntervalRef.current = setInterval(async () => {
      if (partialInFlightRef.current || chunksRef.current.length === 0) return;
      partialInFlightRef.current = true;
      try {
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        const response = await fetch(TRANSCRIBE_PARTIAL_URL, {
          method: "POST",
          headers: { "Content-Type": audioBlob.type },
          body: audioBlob,
        });
        const data = await response.json();
        if (data.error) return;

        const words = String(data.text ?? "").trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) return;

        if (previousWordsRef.current.length > 0) {
          const agreed = commonPrefixLength(previousWordsRef.current, words);
          if (agreed > confirmedWordsRef.current.length) {
            confirmedWordsRef.current = words.slice(0, agreed);
          }
        }
        previousWordsRef.current = words;

        // Ajuste post-primera-versión: mostrar SIEMPRE lo más fresco que
        // Whisper devolvió (confirmado + lo que todavía no se confirmó),
        // no solo lo confirmado -- mostrar únicamente lo confirmado dejaba
        // huecos de silencio entre actualizaciones y después aparecía un
        // pedazo de texto de golpe, se sentía "a los saltos". Lo ya
        // confirmado nunca se reescribe hacia atrás; solo el tramo final
        // (últimas palabras, todavía sin confirmar dos veces seguidas)
        // puede seguir ajustándose de una pasada a la otra.
        const confirmedLen = confirmedWordsRef.current.length;
        const display = [...confirmedWordsRef.current, ...words.slice(confirmedLen)].join(" ");
        setTranscript(display);
      } catch (err) {
        console.error("Error en transcripción parcial:", err);
      } finally {
        partialInFlightRef.current = false;
      }
    }, PARTIAL_TRANSCRIBE_INTERVAL_MS);
  };

  const stopPartialTranscription = () => {
    if (partialIntervalRef.current) {
      clearInterval(partialIntervalRef.current);
      partialIntervalRef.current = null;
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        stopPartialTranscription();

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        });
        chunksRef.current = [];

        setTranscribing(true);
        try {
          const response = await fetch(TRANSCRIBE_URL, {
            method: "POST",
            headers: { "Content-Type": audioBlob.type },
            body: audioBlob,
          });
          const data = await response.json();
          const text = data.error ? "" : String(data.text ?? "");
          if (data.error) {
            console.error("Error de transcripción:", data.error);
          } else {
            setTranscript(text);
          }
          // Tarea 8.1: si este corte lo pidió autoStopListening(), le
          // devuelve el texto final ya transcripto -- quien llamó decide
          // si lo manda solo.
          const resolveAutoStop = pendingAutoStopResolveRef.current;
          pendingAutoStopResolveRef.current = null;
          resolveAutoStop?.(text);
        } catch (err) {
          console.error("Error al enviar audio para transcribir:", err);
          const resolveAutoStop = pendingAutoStopResolveRef.current;
          pendingAutoStopResolveRef.current = null;
          resolveAutoStop?.("");
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      setTranscript("");
      // timeslice: sin esto, ondataavailable solo dispara una vez al
      // frenar la grabación entera -- con él, vamos juntando chunks que la
      // transcripción parcial puede ir usando mientras se sigue grabando.
      recorder.start(CHUNK_TIMESLICE_MS);
      startPartialTranscription(recorder.mimeType || mimeType);
      setListening(true);
      setShowTextInput(true);
    } catch (err) {
      console.error("No se pudo acceder al micrófono:", err);
    }
  };

  const stopListening = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setListening(false);
  };

  const toggleListening = () => {
    if (!isVoiceReady || transcribing) return;

    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Tarea 8.1: corte automático por VAD (silencio sostenido) -- a
  // diferencia de toggleListening, resuelve con el texto final ya
  // transcripto para que quien llamó (ver useVoiceActivityDetection.ts)
  // pueda mandarlo solo, sin esperar un click de "Enviar". Si no había
  // nada grabándose, resuelve con "" de una -- no hay nada que transcribir.
  const autoStopListening = (): Promise<string> => {
    return new Promise((resolve) => {
      if (!listening || !mediaRecorderRef.current) {
        resolve("");
        return;
      }
      pendingAutoStopResolveRef.current = resolve;
      stopListening();
    });
  };

  return { listening, transcribing, toggleListening, autoStopListening };
}
