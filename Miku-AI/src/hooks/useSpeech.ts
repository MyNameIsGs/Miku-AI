import { RefObject, useRef } from "react";

const VISEME_MAP: Record<string, string> = {
  A: "neutral",
  B: "ih",
  C: "ee",
  D: "aa",
  E: "oh",
  F: "ou",
  G: "ih",
  H: "aa",
  X: "neutral",
};

type UseSpeechParams = {
  setExpression: (name: string) => void;
  setViseme: (shapeName: string) => void;
  resetVisemes: () => void;
  isSpeakingRef: RefObject<boolean>;
  // Interruptor de silencio (botón 🔇 de la toolbar, ver App.tsx). Un ref,
  // no un bool plano, para que speak() siempre lea el valor más reciente
  // sin importar cuándo se haya creado la closure que lo llama (mismo
  // motivo que voicePitchRef/voiceRateRef).
  mutedRef: RefObject<boolean>;
};

export function useSpeech({
  setExpression,
  setViseme,
  resetVisemes,
  isSpeakingRef,
  mutedRef,
}: UseSpeechParams) {
  // Antes de los recordatorios (poner_recordatorio) speak() solo se llamaba
  // desde dos lugares que nunca coincidían en el tiempo por construcción
  // (askMiku y el quirk idle, cada uno con su propio guard de "no llamar de
  // nuevo mientras está pensando/hablando). Un recordatorio puede dispararse
  // en CUALQUIER momento, incluido mientras alguno de esos dos ya está
  // hablando -- sin esta cola, dos llamadas superpuestas crean dos <audio>
  // sonando a la vez y dos loops de requestAnimationFrame peleando por el
  // mismo setViseme/setExpression/isSpeakingRef. La cola serializa: cada
  // speak() espera a que termine el anterior antes de arrancar el suyo.
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function speakImmediately(
    text: string,
    pitch: number,
    rate: number,
    expression: string,
    onReveal?: (revealedText: string) => void,
  ) {
    try {
      const response = await fetch("http://127.0.0.1:8899/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, pitch, tts_rate: rate }),
      });

      if (!response.ok) {
        console.error("Error del servidor de voz:", response.status);
        setExpression("neutral");
        isSpeakingRef.current = false;
        onReveal?.(text);
        return;
      }

      const { audio: audioBase64, visemes } = await response.json();

      const audioBytes = Uint8Array.from(atob(audioBase64), (c) =>
        c.charCodeAt(0),
      );
      const audioBlob = new Blob([audioBytes], { type: "audio/wav" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      let animationFrameId: number;

      // Revela el texto en pantalla al mismo ritmo que va sonando el audio
      // (proporcional a currentTime/duration), para inmersión -- en vez de
      // mostrar la respuesta completa de una sola vez. Si la duración
      // todavía no se conoce (raro con un WAV, pero posible por un frame),
      // se revela todo de una para no dejar la pantalla en blanco.
      // Por palabras completas, no por caracteres: el punto calculado por
      // tiempo se extiende hasta el final de la palabra en curso, en vez de
      // cortarla a la mitad.
      const updateRevealedText = () => {
        if (!onReveal) return;
        const duration = audio.duration;
        const ratio =
          duration && Number.isFinite(duration) && duration > 0
            ? Math.min(1, audio.currentTime / duration)
            : 1;
        let revealCount = Math.max(1, Math.ceil(ratio * text.length));
        while (revealCount < text.length && text[revealCount] !== " ") {
          revealCount++;
        }
        onReveal(text.slice(0, revealCount));
      };

      const updateMouthFromVisemes = () => {
        const currentTime = audio.currentTime;
        const activeCue = visemes.find(
          (cue: any) => currentTime >= cue.start && currentTime < cue.end,
        );

        const targetShape = activeCue
          ? (VISEME_MAP[activeCue.value] ?? "neutral")
          : "neutral";
        setViseme(targetShape);
        updateRevealedText();

        animationFrameId = requestAnimationFrame(updateMouthFromVisemes);
      };

      // El orden importa: la expresión facial (y ahora el texto) se revelan
      // recién en audio.onplay, no antes -- para no adelantar la cara ni el
      // texto antes de que suene la voz.
      audio.onplay = () => {
        setExpression(expression);
        isSpeakingRef.current = true;
        onReveal?.("");
        updateMouthFromVisemes();
      };

      // La promesa de speakImmediately ahora se resuelve recién cuando
      // TERMINA de sonar (onended/onerror), no apenas arranca -- antes
      // `await audio.play()` resolvía al arrancar la reproducción, lo que
      // hacía inútil encolar llamadas (la siguiente podía arrancar mientras
      // la anterior seguía sonando). Necesario para que la cola de speak()
      // de más abajo sirva para algo real.
      await new Promise<void>((resolve) => {
        audio.onended = () => {
          cancelAnimationFrame(animationFrameId);
          resetVisemes();
          URL.revokeObjectURL(audioUrl);
          setExpression("neutral");
          isSpeakingRef.current = false;
          onReveal?.(text);
          resolve();
        };
        audio.onerror = () => {
          cancelAnimationFrame(animationFrameId);
          resetVisemes();
          URL.revokeObjectURL(audioUrl);
          setExpression("neutral");
          isSpeakingRef.current = false;
          onReveal?.(text);
          resolve();
        };
        audio.play().catch(() => {
          setExpression("neutral");
          isSpeakingRef.current = false;
          onReveal?.(text);
          resolve();
        });
      });
    } catch (err) {
      console.error("Error al conectar con el servidor de voz:", err);
      setExpression("neutral");
      isSpeakingRef.current = false;
      onReveal?.(text);
    }
  }

  // Envoltorio público: encola en vez de ejecutar directo -- ver
  // speechQueueRef más arriba. Nunca rechaza (speakImmediately ya atrapa
  // sus propios errores), así que la cola nunca se traba por un fallo.
  function speak(
    text: string,
    pitch: number,
    rate: number,
    expression: string,
    // Opcional: se llama con el texto revelado hasta el momento, en sync
    // con el audio (ver updateRevealedText más arriba) -- solo lo usa
    // askMiku en App.tsx para el response-box; los quirks idle y los
    // recordatorios no muestran texto, así que no lo necesitan.
    onReveal?: (revealedText: string) => void,
  ): Promise<void> {
    // Silenciado: no se toca la cola en absoluto -- si se desmutea después,
    // no hay nada "pendiente" esperando a sonar de golpe. Igual se revela
    // el texto completo de una, ya que sin audio no hay nada que sincronizar.
    if (mutedRef.current) {
      onReveal?.(text);
      return Promise.resolve();
    }

    const run = () => speakImmediately(text, pitch, rate, expression, onReveal);
    const result = speechQueueRef.current.then(run, run);
    speechQueueRef.current = result;
    return result;
  }

  return { speak };
}
