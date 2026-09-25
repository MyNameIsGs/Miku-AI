import { RefObject, useEffect, useRef } from "react";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Punto 6 del plan: al arrastrar la ventana, el pelo y la falda reaccionan
// como si el cuerpo se moviera de verdad (quedan un poco atrás del
// movimiento). La escena 3D no se mueve cuando se mueve la ventana, así que
// se simula: un "viento" en sentido contrario a la velocidad de la ventana,
// sumado a la gravedad de cada articulación de pelo y falda, que se apaga
// solo en unas décimas de segundo.

// Cuánto viento por cada px/s de la ventana, y el máximo.
const WIND_PER_PX_PER_S = 0.0012;
const WIND_MAX = 1.6;
// Se apaga a la mitad en este tiempo.
const WIND_HALF_LIFE_S = 0.18;
// Por debajo de esto se deja la gravedad original tal cual.
const WIND_EPSILON = 0.01;

type JointOriginal = { dir: THREE.Vector3; power: number };

// Aplica `wind` a todas las articulaciones (exportada para el banco).
export function applyWind(
  vrm: VRM,
  originals: Map<object, JointOriginal>,
  wind: THREE.Vector3,
) {
  const manager = vrm.springBoneManager;
  if (!manager) return;
  const combined = new THREE.Vector3();
  for (const joint of manager.joints) {
    let original = originals.get(joint);
    if (!original) {
      original = { dir: joint.settings.gravityDir.clone(), power: joint.settings.gravityPower };
      originals.set(joint, original);
    }
    if (wind.lengthSq() < WIND_EPSILON * WIND_EPSILON) {
      joint.settings.gravityDir.copy(original.dir);
      joint.settings.gravityPower = original.power;
      continue;
    }
    combined.copy(original.dir).multiplyScalar(original.power).add(wind);
    const power = combined.length();
    joint.settings.gravityPower = power;
    if (power > 1e-6) joint.settings.gravityDir.copy(combined.divideScalar(power));
  }
}

export function useWindowWind(vrmRef: RefObject<VRM | null>) {
  const windRef = useRef(new THREE.Vector3());
  const lastPosRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const originalsRef = useRef(new Map<object, JointOriginal>());
  const activeRef = useRef(false);

  useEffect(() => {
    const unlisten = getCurrentWindow().onMoved(({ payload }) => {
      const t = performance.now();
      const last = lastPosRef.current;
      lastPosRef.current = { x: payload.x, y: payload.y, t };
      if (!last) return;
      const dt = (t - last.t) / 1000;
      if (dt <= 0 || dt > 0.25) return;
      const vx = (payload.x - last.x) / dt;
      const vy = (payload.y - last.y) / dt;
      // La cámara mira a Miku de frente: derecha de la pantalla = +x del
      // mundo, abajo = -y. El pelo queda atrás del movimiento: al revés.
      const target = new THREE.Vector3(-vx, vy, 0).multiplyScalar(WIND_PER_PX_PER_S);
      if (target.length() > WIND_MAX) target.setLength(WIND_MAX);
      // Se queda con el más fuerte entre lo que ya soplaba y lo nuevo.
      if (target.length() > windRef.current.length()) windRef.current.copy(target);
      else windRef.current.lerp(target, 0.5);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // En cada cuadro, antes de vrm.update (que mueve los spring bones).
  function update(delta: number) {
    const vrm = vrmRef.current;
    if (!vrm) return;
    const wind = windRef.current;
    if (wind.lengthSq() < WIND_EPSILON * WIND_EPSILON) {
      if (activeRef.current) {
        wind.set(0, 0, 0);
        applyWind(vrm, originalsRef.current, wind);
        activeRef.current = false;
      }
      return;
    }
    activeRef.current = true;
    applyWind(vrm, originalsRef.current, wind);
    wind.multiplyScalar(Math.pow(0.5, delta / WIND_HALF_LIFE_S));
  }

  return { update };
}
