import { RefObject } from "react";

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
};

export function useSpeech({
  setExpression,
  setViseme,
  resetVisemes,
  isSpeakingRef,
}: UseSpeechParams) {
  async function speak(
    text: string,
    pitch: number,
    rate: number,
    expression: string,
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

      const updateMouthFromVisemes = () => {
        const currentTime = audio.currentTime;
        const activeCue = visemes.find(
          (cue: any) => currentTime >= cue.start && currentTime < cue.end,
        );

        const targetShape = activeCue
          ? (VISEME_MAP[activeCue.value] ?? "neutral")
          : "neutral";
        setViseme(targetShape);

        animationFrameId = requestAnimationFrame(updateMouthFromVisemes);
      };

      // El orden importa: la expresión facial se revela recién en
      // audio.onplay, no antes -- para no adelantar la cara antes de que
      // suene la voz.
      audio.onplay = () => {
        setExpression(expression);
        isSpeakingRef.current = true;
        updateMouthFromVisemes();
      };

      audio.onended = () => {
        cancelAnimationFrame(animationFrameId);
        resetVisemes();
        URL.revokeObjectURL(audioUrl);
        setExpression("neutral");
        isSpeakingRef.current = false;
      };

      await audio.play();
    } catch (err) {
      console.error("Error al conectar con el servidor de voz:", err);
      setExpression("neutral");
      isSpeakingRef.current = false;
    }
  }

  return { speak };
}
