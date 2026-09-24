import { useRef } from "react";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";

const REPORT_EVERY_MS = 60 * 1000;
// Por debajo de esto, además de la consola, va a la terminal de Tauri.
const LOW_FPS = 40;

// Monitor de rendimiento liviano. Sebastián notó que, tras hablar un rato,
// el render iba a menos cuadros (recién abierta, no). Una fuga de ese tipo
// se ve en algo que CRECE con el tiempo: esto deja un registro por minuto
// de fps, memoria JS y recursos de la GPU (geometrías, texturas, shaders),
// para comparar "recién abierta" contra "después de hablar un rato".
// Cuesta un contador por cuadro y un log por minuto.
export function usePerfMonitor() {
  const framesRef = useRef(0);
  const windowStartRef = useRef(performance.now());
  const baselineRef = useRef<string | null>(null);

  function onFrame(renderer: THREE.WebGLRenderer, now: number) {
    framesRef.current++;
    const elapsed = now - windowStartRef.current;
    if (elapsed < REPORT_EVERY_MS) return;

    const fps = Math.round((framesRef.current * 1000) / elapsed);
    framesRef.current = 0;
    windowStartRef.current = now;

    const info = renderer.info;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heapMb = heap ? Math.round(heap.usedJSHeapSize / 1048576) : null;
    const line =
      `${fps} fps | memoria JS ${heapMb ?? "?"} MB | geometrías ${info.memory.geometries}, ` +
      `texturas ${info.memory.textures}, shaders ${info.programs?.length ?? "?"} | ` +
      `draw calls ${info.render.calls}`;
    if (baselineRef.current === null) baselineRef.current = line;

    console.log(`[Rendimiento] ${line}`);
    if (fps < LOW_FPS) {
      const msg = `[Rendimiento] BAJO: ${line} (al principio de la sesión: ${baselineRef.current})`;
      console.warn(msg);
      invoke("log_to_terminal", { msg }).catch(() => {});
    }
  }

  return { onFrame };
}
