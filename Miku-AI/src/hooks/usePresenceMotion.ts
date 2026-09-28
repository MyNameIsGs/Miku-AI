import { useEffect, useState } from "react";

// Movimiento de entrada/salida (ronda 2, DISENO.md §4): mantiene montado un
// elemento mientras hace su animación de salida, y opcionalmente espera un
// rato antes de empezar a irse (la barra y el panel esperan 600 ms tras
// salir el mouse, para no parpadear si el cursor solo pasa por encima).
//
// Devuelve si hay que dibujarlo y en qué fase está; el componente pone la
// fase en `data-motion` y el CSS hace el resto.

export type MotionPhase = "enter" | "exit";

type Options = {
  // Espera antes de empezar a salir.
  exitDelayMs?: number;
  // Lo que dura la animación de salida (tiene que coincidir con el CSS).
  exitMs: number;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function usePresenceMotion(show: boolean, { exitDelayMs = 0, exitMs }: Options) {
  const [mounted, setMounted] = useState(show);
  const [phase, setPhase] = useState<MotionPhase>("enter");

  useEffect(() => {
    if (show) {
      setMounted(true);
      setPhase("enter");
      return;
    }
    if (!mounted) return;
    const reduced = prefersReducedMotion();
    // Con "reducir movimiento" la salida es un fundido corto y sin espera.
    const delay = reduced ? 0 : exitDelayMs;
    const duration = reduced ? Math.min(exitMs, 120) : exitMs;
    const startExit = window.setTimeout(() => setPhase("exit"), delay);
    const unmount = window.setTimeout(() => setMounted(false), delay + duration);
    return () => {
      clearTimeout(startExit);
      clearTimeout(unmount);
    };
    // `mounted` no va en las dependencias: solo importa cuando cambia `show`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, exitDelayMs, exitMs]);

  return { mounted, phase };
}
