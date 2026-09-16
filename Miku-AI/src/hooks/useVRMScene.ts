import { useEffect, useState, useRef, RefObject } from "react";
import * as THREE from "three";
import { VRMLoaderPlugin, VRM, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { load } from "@tauri-apps/plugin-store";
import { WIDTH, HEIGHT } from "../config/constants";
import { MOVEMENT_BONE_NAMES, HAND_FINGER_BONE_NAMES } from "../config/boneRanges";

type UseVRMSceneParams = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  vrmRef: RefObject<VRM | null>;
  rendererRef: RefObject<THREE.WebGLRenderer | null>;
  sceneRef: RefObject<THREE.Scene | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  controlsRef: RefObject<OrbitControls | null>;
  boneRestRotationRef: RefObject<
    Record<string, { x: number; y: number; z: number }>
  >;
  movementBonesRef: RefObject<Record<string, THREE.Object3D | null>>;
  fingerBonesRef: RefObject<Record<string, THREE.Object3D | null>>;
  chestBoneRef: RefObject<THREE.Object3D | null>;
  headBoneRef: RefObject<THREE.Object3D | null>;
  gazeTargetObjectRef: RefObject<THREE.Object3D | null>;
  onBeforeRender: (now: number, delta: number, elapsed: number) => void;
  onAfterRender: (renderer: THREE.WebGLRenderer, now: number) => void;
};

export function useVRMScene({
  canvasRef,
  vrmRef,
  rendererRef,
  sceneRef,
  cameraRef,
  controlsRef,
  boneRestRotationRef,
  movementBonesRef,
  fingerBonesRef,
  chestBoneRef,
  headBoneRef,
  gazeTargetObjectRef,
  onBeforeRender,
  onAfterRender,
}: UseVRMSceneParams) {
  const [isVrmLoaded, setIsVrmLoaded] = useState(false);

  // Los callbacks por-frame vienen de App.tsx y se recrean en cada render;
  // se guardan en un ref para que el loop (montado una sola vez) siempre
  // llame a la versión más reciente sin reiniciarse.
  const onBeforeRenderRef = useRef(onBeforeRender);
  const onAfterRenderRef = useRef(onAfterRender);
  useEffect(() => {
    onBeforeRenderRef.current = onBeforeRender;
    onAfterRenderRef.current = onAfterRender;
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, 0.1, 20);
    camera.position.set(-0.35, 1.0, 1.3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(WIDTH, HEIGHT);
    rendererRef.current = renderer;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.28, 0);
    controls.enabled = false;
    controls.update();
    controlsRef.current = controls;
    (async () => {
      try {
        const store = await load(".settings.dat", { autoSave: false });
        const saved = await store.get<{
          position: [number, number, number];
          target: [number, number, number];
        }>("cameraPosition");
        if (saved) {
          camera.position.set(...saved.position);
          controls.target.set(...saved.target);
          controls.update();
        }
      } catch (err) {
        console.error("Error cargando posición de cámara guardada:", err);
      }
    })();

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(1, 1, 1).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    let currentVrm: VRM | undefined;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      "/HatsuneMikuNT.vrm",
      (gltf) => {
        const vrm = gltf.userData.vrm as VRM;

        currentVrm = vrm;
        vrmRef.current = vrm;
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);

        const leftUpperArm =
          vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
        const rightUpperArm =
          vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");
        if (leftUpperArm) leftUpperArm.rotation.z = 1.2;
        if (rightUpperArm) rightUpperArm.rotation.z = -1.2;

        chestBoneRef.current =
          vrm.humanoid?.getNormalizedBoneNode("chest") ??
          vrm.humanoid?.getNormalizedBoneNode("upperChest") ??
          vrm.humanoid?.getNormalizedBoneNode("spine") ??
          null;

        headBoneRef.current = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;

        for (const boneName of MOVEMENT_BONE_NAMES) {
          movementBonesRef.current[boneName] =
            vrm.humanoid?.getNormalizedBoneNode(boneName as any) ?? null;
        }

        for (const boneName of HAND_FINGER_BONE_NAMES) {
          fingerBonesRef.current[boneName] =
            vrm.humanoid?.getNormalizedBoneNode(boneName as any) ?? null;
        }

        for (const boneName of [
          ...MOVEMENT_BONE_NAMES,
          ...HAND_FINGER_BONE_NAMES,
        ]) {
          const node =
            movementBonesRef.current[boneName] ??
            fingerBonesRef.current[boneName];
          if (node) {
            boneRestRotationRef.current[boneName] = {
              x: node.rotation.x,
              y: node.rotation.y,
              z: node.rotation.z,
            };
          }
        }

        const gazeTargetObject = new THREE.Object3D();
        gazeTargetObject.position.set(0, 1.4, 1);
        scene.add(gazeTargetObject);
        gazeTargetObjectRef.current = gazeTargetObject;
        vrm.lookAt!.target = gazeTargetObject;
        vrm.lookAt!.autoUpdate = true;

        setIsVrmLoaded(true);
      },
      undefined,
      (error) => console.error("Error cargando el VRM:", error),
    );

    const clock = new THREE.Clock();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      const now = performance.now();

      if (currentVrm) {
        onBeforeRenderRef.current(now, delta, elapsed);
        currentVrm.update(delta);
      }

      controls.update();
      renderer.render(scene, camera);

      onAfterRenderRef.current(renderer, now);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      renderer.dispose();
    };
  }, []);

  return { isVrmLoaded };
}
