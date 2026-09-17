import { useRef, useState, Dispatch, SetStateAction } from "react";

type UseSpeechRecognitionParams = {
  isVoiceReady: boolean;
  setTranscript: Dispatch<SetStateAction<string>>;
  setShowTextInput: Dispatch<SetStateAction<boolean>>;
};

const TRANSCRIBE_URL = "http://127.0.0.1:8899/transcribe";

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
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
          if (data.error) {
            console.error("Error de transcripción:", data.error);
          } else {
            setTranscript(data.text ?? "");
          }
        } catch (err) {
          console.error("Error al enviar audio para transcribir:", err);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      setTranscript("");
      recorder.start();
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

  return { listening, transcribing, toggleListening };
}
