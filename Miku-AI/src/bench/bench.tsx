// B5 del plan: banco de pruebas permanente, solo en desarrollo. Carga el
// modelo real con los mismos hooks que la app (cara, movimiento, escena) y
// expone `window.bt` para probar desde la consola del navegador:
//
//   pnpm dev  ->  http://localhost:1420/bench.html
//
// No entra en el build (Vite solo empaqueta index.html) pero sí lo revisa
// tsc, así que sigue compilando cuando cambian los hooks. Las fotos de
// bt.shot() se guardan en Miku-AI/bench-shots/ (ver vite.config.ts).
//
// Ojo: si la pestaña está oculta, el navegador no corre requestAnimationFrame;
// por eso faceRun avanza los cuadros a mano y shot() renderiza por su cuenta.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useVRMScene } from "../hooks/useVRMScene";
import { useFace } from "../hooks/useFace";
import { useMovement, intensityToDegrees } from "../hooks/useMovement";
import { WIDTH, HEIGHT } from "../config/constants";
import { BONE_RANGES_DEG } from "../config/boneRanges";
import { captureSelfView } from "../lib/selfView";
import { solveReach } from "../lib/reach";
import { describeBodyNow } from "../lib/bodySense";

const HELP = `Banco de Miku -- en la consola, window.bt:
  bt.ready()                        modelo cargado
  bt.reset()                        todo a reposo
  bt.pose([{bone, axis, intensity}]) pose desde reposo (intensidades del prompt)
  bt.applyMore([...])               suma a la pose actual
  bt.solve(lado, lugar, palma?)     LLEVAR_MANO: {entries, missCm, palmOffDeg}
  bt.describe()                     propiocepción (lo que ella "siente")
  bt.faceRun(expr, segundos, now)   avanza la cara a 60 fps, devuelve el now final
  bt.shot(nombre, ángulo?, encuadre?) foto a bench-shots/<nombre>.jpg
  bt.movement                       el hook useMovement completo`;

function Bench() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const boneRestRotationRef = useRef<Record<string, { x: number; y: number; z: number }>>({});
  const movementBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const fingerBonesRef = useRef<Record<string, THREE.Object3D | null>>({});
  const chestBoneRef = useRef<THREE.Object3D | null>(null);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const gazeTargetObjectRef = useRef<THREE.Object3D | null>(null);
  const lowerBodyRef = useRef<Record<string, THREE.Object3D | null>>({});

  const face = useFace({ vrmRef, gazeTargetObjectRef });
  const movement = useMovement({ movementBonesRef, fingerBonesRef, boneRestRotationRef, chestBoneRef, headBoneRef, lowerBodyRef });

  useVRMScene({
    canvasRef, vrmRef, rendererRef, sceneRef, cameraRef, controlsRef, boneRestRotationRef,
    movementBonesRef, fingerBonesRef, chestBoneRef, headBoneRef, gazeTargetObjectRef,
    onBeforeRender: () => {},
    onAfterRender: () => {},
  });

  function resetAll() {
    for (const [name, node] of Object.entries({ ...movementBonesRef.current, ...fingerBonesRef.current })) {
      const r = boneRestRotationRef.current[name];
      if (node && r) node.rotation.set(r.x, r.y, r.z);
    }
  }
  function refresh() {
    vrmRef.current!.humanoid.update();
    vrmRef.current!.scene.updateMatrixWorld(true);
  }
  function applyIntensities(entries: { bone: string; axis: "x" | "y" | "z"; intensity: number }[]) {
    for (const e of entries) {
      const node = movementBonesRef.current[e.bone]!;
      const range = BONE_RANGES_DEG[e.bone][e.axis];
      node.rotation[e.axis] = boneRestRotationRef.current[e.bone][e.axis] + THREE.MathUtils.degToRad(intensityToDegrees(e.intensity, range[0], range[1]));
    }
    refresh();
  }

  (window as any).bt = {
    ready: () => !!vrmRef.current && Object.keys(boneRestRotationRef.current).length > 0,
    movement,
    // Avanza la cara `seconds` segundos simulados (60 fps) con una expresión.
    faceRun: (expression: string, seconds: number, startNow: number) => {
      const vrm = vrmRef.current!;
      face.setExpression(expression);
      let now = startNow;
      for (let i = 0; i < seconds * 60; i++) {
        now += 1000 / 60;
        face.updateFace(now, 1 / 60);
        vrm.expressionManager!.update();
      }
      return now;
    },
    reset: () => { resetAll(); refresh(); },
    pose: (entries: any[]) => { resetAll(); applyIntensities(entries); },
    applyMore: (entries: any[]) => applyIntensities(entries),
    solve: (side: "left" | "right", place: string, palm?: string) =>
      (solveReach as any)(vrmRef.current!, movementBonesRef.current, boneRestRotationRef.current, side, place, cameraRef.current!.position.clone(), palm),
    describe: () => describeBodyNow(vrmRef.current!),
    // Foto con la cámara de su autoimagen; se guarda en bench-shots/<nombre>.jpg.
    shot: async (name: string, angle: any = "cuatro", framing: any = "cuerpo") => {
      const url = captureSelfView(vrmRef.current!, rendererRef.current!, sceneRef.current!, angle, framing);
      const res = await fetch(`/__bench/shot/${encodeURIComponent(name)}`, { method: "POST", body: url });
      return res.ok ? `bench-shots/${name}.jpg` : `error ${res.status}`;
    },
  };

  return (
    <>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      <pre style={{ position: "fixed", top: 8, left: WIDTH + 16, margin: 0, color: "#ddd", font: "12px monospace" }}>
        {HELP}
      </pre>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Bench />);
