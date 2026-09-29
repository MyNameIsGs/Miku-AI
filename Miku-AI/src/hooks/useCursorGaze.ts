import { RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";

// Miku sigue el mouse con los ojos cuando Sebastián lo pasa cerca de ella.
// Si el cursor se aleja o se queda quieto un rato, vuelve a su mirada de
// siempre. Solo los ojos, a propósito: al principio la cabeza también lo
// acompañaba, pero dejaba de hacerlo en cuanto ella tenía una pose puesta en
// la cabeza (y las poses de una respuesta se mantienen), así que el
// comportamiento cambiaba después de hablarle -- y a Sebastián le gustó
// más solo con los ojos.
//
// La posición del cursor la da Rust (cursor_position en click_through.rs):
// con click-through el navegador no recibe eventos del mouse, y fuera de la
// ventana nunca los recibe.

const POLL_MS = 100;
// "Cerca": dentro de la ventana o a menos de esto de sus bordes.
const NEAR_MARGIN_PX = 150;
// Con el cursor quieto más que esto, deja de mirarlo (no se queda clavada
// mirando un cursor olvidado mientras él escribe o lee).
const STILL_RELEASE_MS = 2500;
const MOVED_THRESHOLD_PX = 2;
// El punto se proyecta en un plano a esta distancia de la cara, hacia la
// cámara: los ojos convergen a una distancia creíble.
const PLANE_DISTANCE_M = 0.6;
// D3 (2026-09-28): cuando Sebastián cambia de ventana, mira un momento
// hacia donde quedó la nueva (solo los ojos, como con el cursor). Si él
// mueve el mouse cerca, manda el cursor.
const WINDOW_POLL_MS = 500;
const GLANCE_MS = 1500;
// Entre una mirada y la siguiente, para que no mire para todos lados si
// cambia de ventana muy seguido.
const GLANCE_MIN_GAP_MS = 4000;

// Rayo desde la cámara por el punto del cursor (px relativos a la ventana),
// cortado con un plano frente a la cara (perpendicular a la línea
// cara-cámara). Sirve también con el cursor fuera del canvas.
export function cursorToWorldPoint(
  x: number,
  y: number,
  camera: THREE.PerspectiveCamera,
  canvasRect: { left: number; top: number; width: number; height: number },
  head: THREE.Object3D,
): THREE.Vector3 | null {
  if (canvasRect.width === 0 || canvasRect.height === 0) return null;
  const ndc = new THREE.Vector3(
    ((x - canvasRect.left) / canvasRect.width) * 2 - 1,
    -((y - canvasRect.top) / canvasRect.height) * 2 + 1,
    0.5,
  );
  const rayDir = ndc.unproject(camera).sub(camera.position).normalize();
  const headPos = head.getWorldPosition(new THREE.Vector3());
  const normal = camera.position.clone().sub(headPos).normalize();
  const planePoint = headPos.clone().addScaledVector(normal, PLANE_DISTANCE_M);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
  return new THREE.Ray(camera.position.clone(), rayDir).intersectPlane(plane, new THREE.Vector3());
}

type UseCursorGazeParams = {
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  headBoneRef: RefObject<THREE.Object3D | null>;
  gazeOverrideRef: RefObject<THREE.Vector3 | null>;
};

export function useCursorGaze({ cameraRef, canvasRef, headBoneRef, gazeOverrideRef }: UseCursorGazeParams) {
  const targetRef = useRef<THREE.Vector3 | null>(null);
  const lastPosRef = useRef<[number, number] | null>(null);
  const lastMoveRef = useRef(0);
  // Mirada hacia la ventana nueva: dónde (px relativos a la ventana de Miku) y hasta cuándo.
  const glanceRef = useRef<{ x: number; y: number; until: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const pos = await invoke<[number, number] | null>("cursor_position").catch(() => null);
      if (cancelled) return;
      const now = performance.now();
      if (!pos) {
        targetRef.current = null;
        return;
      }
      const last = lastPosRef.current;
      if (!last || Math.hypot(pos[0] - last[0], pos[1] - last[1]) > MOVED_THRESHOLD_PX) {
        lastMoveRef.current = now;
      }
      lastPosRef.current = pos;

      const [x, y] = pos;
      const near =
        x >= -NEAR_MARGIN_PX &&
        y >= -NEAR_MARGIN_PX &&
        x <= window.innerWidth + NEAR_MARGIN_PX &&
        y <= window.innerHeight + NEAR_MARGIN_PX;
      const moving = now - lastMoveRef.current < STILL_RELEASE_MS;
      const glance = glanceRef.current && now < glanceRef.current.until ? glanceRef.current : null;
      targetRef.current = near && moving ? cursorToWorld(x, y) : glance ? cursorToWorld(glance.x, glance.y) : null;
    };
    const id = window.setInterval(poll, POLL_MS);

    // D3: ¿cambió la ventana en primer plano? (la de Miku no cuenta)
    let lastWindowId: number | null = null;
    let lastGlanceAt = -Infinity;
    const pollWindow = async () => {
      const spot = await invoke<{ id: number; x: number; y: number } | null>("ventana_activa_lugar").catch(() => null);
      if (cancelled || !spot) return;
      const changed = lastWindowId !== null && spot.id !== lastWindowId;
      lastWindowId = spot.id;
      const now = performance.now();
      if (changed && now - lastGlanceAt >= GLANCE_MIN_GAP_MS) {
        lastGlanceAt = now;
        glanceRef.current = { x: spot.x, y: spot.y, until: now + GLANCE_MS };
      }
    };
    const windowId = window.setInterval(pollWindow, WINDOW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearInterval(windowId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cursorToWorld(x: number, y: number): THREE.Vector3 | null {
    const camera = cameraRef.current;
    const canvas = canvasRef.current;
    const head = headBoneRef.current;
    if (!camera || !canvas || !head) return null;
    return cursorToWorldPoint(x, y, camera, canvas.getBoundingClientRect(), head);
  }

  // Cada cuadro, antes de updateFace: a dónde miran los ojos.
  function update() {
    gazeOverrideRef.current = targetRef.current;
  }

  return { update, targetRef };
}
