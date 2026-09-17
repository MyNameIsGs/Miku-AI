import { useEffect, useRef, useState } from "react";

const PHRASES = [
  "Afinando la voz de Miku...",
  "Calentando los servidores...",
  "Despertando a Miku...",
  "Sincronizando los auriculares...",
  "Preparando el escenario...",
  "Cargando notas musicales...",
  "Ajustando el micrófono de Miku...",
];

type LoadingPhraseState = {
  phrase: string;
  visible: boolean;
};

export function useLoadingPhrase(
  active: boolean,
  intervalMs = 3000,
  fadeMs = 400,
): LoadingPhraseState {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const swapTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const intervalId = window.setInterval(() => {
      setVisible(false);
      swapTimeoutRef.current = window.setTimeout(() => {
        setIndex((i) => (i + 1) % PHRASES.length);
        setVisible(true);
      }, fadeMs);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
      if (swapTimeoutRef.current !== null) {
        window.clearTimeout(swapTimeoutRef.current);
      }
    };
  }, [active, intervalMs, fadeMs]);

  return { phrase: PHRASES[index], visible };
}
