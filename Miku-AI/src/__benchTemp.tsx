// TEMPORAL: banco de la noche del 2026-09-25. Se borra al terminar.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useVRMScene } from "./hooks/useVRMScene";
import { useFace } from "./hooks/useFace";
import { useMovement, intensityToDegrees } from "./hooks/useMovement";
import { WIDTH, HEIGHT } from "./config/constants";
import { BONE_RANGES_DEG } from "./config/boneRanges";
import { captureSelfView } from "./lib/selfView";
import { solveReach } from "./lib/reach";
import { describeBodyNow } from "./lib/bodySense";

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
    shot: async (name: string, angle: any = "cuatro", framing: any = "cuerpo") => {
      const url = captureSelfView(vrmRef.current!, rendererRef.current!, sceneRef.current!, angle, framing);
      await fetch("http://127.0.0.1:8765/" + name, { method: "POST", body: url });
    },
  };

  return <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />;
}

createRoot(document.getElementById("root")!).render(<Bench />);
