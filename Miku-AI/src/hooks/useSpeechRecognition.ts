import { useEffect, useRef, useState, Dispatch, SetStateAction } from "react";

type UseSpeechRecognitionParams = {
  isVoiceReady: boolean;
  setTranscript: Dispatch<SetStateAction<string>>;
  setShowTextInput: Dispatch<SetStateAction<boolean>>;
};

export function useSpeechRecognition({
  isVoiceReady,
  setTranscript,
  setShowTextInput,
}: UseSpeechRecognitionParams) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error("Web Speech API no está disponible en este entorno.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "es-ES";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }

      setTranscript((prev) => (finalText ? prev + " " + finalText : prev));
      if (interimText) setTranscript((prev) => prev);
    };

    recognition.onerror = (event: any) => {
      console.error("Error de reconocimiento de voz:", event.error);
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        recognition.start();
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current || !isVoiceReady) return;

    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      setTranscript("");
      recognitionRef.current.start();
      setListening(true);
      setShowTextInput(true);
    }
  };

  return { listening, toggleListening };
}
