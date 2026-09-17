import { useEffect, useState } from "react";

const PHRASES = [
  "Afinando la voz de Miku...",
  "Calentando los servidores...",
  "Despertando a Miku...",
  "Sincronizando los auriculares...",
  "Preparando el escenario...",
  "Cargando notas musicales...",
  "Ajustando el micrófono de Miku...",
];

export function useLoadingPhrase(active: boolean, intervalMs = 3000): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % PHRASES.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return PHRASES[index];
}
