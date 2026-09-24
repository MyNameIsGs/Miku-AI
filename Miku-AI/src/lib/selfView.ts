import * as THREE from "three";
import { VRM } from "@pixiv/three-vrm";

// Miku se mira a sí misma desde cualquier ángulo (tool `mirarme`, ver
// lib/tools/mirarme.ts), sin depender de la cámara de la ventana ni de
// capturas de la pantalla: su cuerpo ya es una escena 3D, así que se dibuja
// con una cámara virtual a una imagen FUERA de pantalla (render target) --
// Sebastián no ve nada distinto, la cámara de la ventana no se mueve, y
// funciona aunque la ventana esté tapada.
//
// Sirve sobre todo para lo que Miku hace sola: revisar poses, quirks y
// gestos. Hasta ahora solo se veía de frente -- p. ej. el eje Y de los
// brazos (adelante/atrás) de frente casi no se nota, de costado sí.

export type SelfViewAngle = "frente" | "espalda" | "izquierda" | "derecha" | "arriba" | "cuatro";
export type SelfViewFraming = "cuerpo" | "torso" | "cara" | "mano_izquierda" | "mano_derecha";

export const SELF_VIEW_ANGLES: SelfViewAngle[] = ["frente", "espalda", "izquierda", "derecha", "arriba", "cuatro"];
export const SELF_VIEW_FRAMINGS: SelfViewFraming[] = ["cuerpo", "torso", "cara", "mano_izquierda", "mano_derecha"];

// Una sola vista: lado del cuadrado en píxeles. "cuatro" arma una grilla
// 2x2 del mismo tamaño total (cada vista a la mitad): 4 ángulos por el
// costo en tokens de una imagen.
const IMAGE_SIZE = 640;
const FOV_DEG = 30;
// Fondo gris neutro: con el fondo transparente de la ventana, la silueta
// (y el pelo celeste) se perdía contra el blanco/negro de la imagen.
const BACKGROUND = 0x8a8f99;

type Framing = { center: THREE.Vector3; height: number };

function bonePos(vrm: VRM, name: Parameters<NonNullable<VRM["humanoid"]>["getNormalizedBoneNode"]>[0]) {
  const node = vrm.humanoid?.getNormalizedBoneNode(name);
  return node ? node.getWorldPosition(new THREE.Vector3()) : null;
}

function computeFraming(vrm: VRM, framing: SelfViewFraming): Framing {
  const head = bonePos(vrm, "head") ?? new THREE.Vector3(0, 1.4, 0);
  const hips = bonePos(vrm, "hips") ?? new THREE.Vector3(0, 0.9, 0);
  const headTop = head.y + 0.22; // coronilla + coletas atadas arriba
  switch (framing) {
    case "cara":
      return { center: new THREE.Vector3(head.x, head.y + 0.08, head.z), height: 0.42 };
    case "torso": {
      const bottom = hips.y - 0.15;
      return { center: new THREE.Vector3(hips.x, (bottom + headTop) / 2, hips.z), height: headTop - bottom + 0.1 };
    }
    case "mano_izquierda":
    case "mano_derecha": {
      const hand = bonePos(vrm, framing === "mano_izquierda" ? "leftHand" : "rightHand") ?? hips;
      const middle = bonePos(vrm, framing === "mano_izquierda" ? "leftMiddleProximal" : "rightMiddleProximal");
      // Centro entre la muñeca y los nudillos, para que entren los dedos.
      const center = middle ? hand.clone().lerp(middle, 0.6) : hand;
      return { center, height: 0.32 };
    }
    case "cuerpo":
    default:
      return { center: new THREE.Vector3(hips.x, headTop / 2, hips.z), height: headTop + 0.12 };
  }
}

// Miku mira hacia +z del mundo; su izquierda es +x.
function directionFor(angle: Exclude<SelfViewAngle, "cuatro">): THREE.Vector3 {
  switch (angle) {
    case "espalda":
      return new THREE.Vector3(0, 0, -1);
    case "izquierda":
      return new THREE.Vector3(1, 0, 0);
    case "derecha":
      return new THREE.Vector3(-1, 0, 0);
    case "arriba":
      return new THREE.Vector3(0, 0.75, 0.66).normalize();
    case "frente":
    default:
      return new THREE.Vector3(0, 0, 1);
  }
}

function renderView(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  target: THREE.WebGLRenderTarget,
  framing: Framing,
  angle: Exclude<SelfViewAngle, "cuatro">,
  size: number,
): Uint8Array {
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 20);
  const distance = (framing.height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2))) * 1.08;
  camera.position.copy(framing.center).addScaledVector(directionFor(angle), distance);
  camera.lookAt(framing.center);

  // Luz "de linterna" desde la cámara: la escena se ilumina de frente, así
  // que de espaldas o de costado se vería oscura.
  const lamp = new THREE.DirectionalLight(0xffffff, 0.9);
  lamp.position.copy(camera.position);
  lamp.target.position.copy(framing.center);
  scene.add(lamp, lamp.target);

  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  renderer.setRenderTarget(null);

  scene.remove(lamp, lamp.target);
  lamp.dispose();
  return pixels;
}

// Devuelve un data URL JPEG. Deja todo como estaba (render target, fondo,
// luces): la ventana no se entera.
export function captureSelfView(
  vrm: VRM,
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  angle: SelfViewAngle,
  framing: SelfViewFraming,
): string {
  const frame = computeFraming(vrm, framing);
  const angles: Exclude<SelfViewAngle, "cuatro">[] =
    angle === "cuatro" ? ["frente", "izquierda", "espalda", "derecha"] : [angle];
  const tile = angle === "cuatro" ? IMAGE_SIZE / 2 : IMAGE_SIZE;

  const target = new THREE.WebGLRenderTarget(tile, tile, { samples: 4 });
  // Mismo espacio de color que la ventana: sin esto los píxeles salen en
  // espacio lineal (más oscuros de lo que se ven en pantalla).
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const previousBackground = scene.background;
  const previousTarget = renderer.getRenderTarget();
  scene.background = new THREE.Color(BACKGROUND);

  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d")!;

  try {
    angles.forEach((a, i) => {
      const pixels = renderView(renderer, scene, target, frame, a, tile);
      // WebGL entrega las filas de abajo hacia arriba: se dan vuelta.
      const image = ctx.createImageData(tile, tile);
      const rowBytes = tile * 4;
      for (let y = 0; y < tile; y++) {
        image.data.set(pixels.subarray((tile - 1 - y) * rowBytes, (tile - y) * rowBytes), y * rowBytes);
      }
      const x = angle === "cuatro" ? (i % 2) * tile : 0;
      const y = angle === "cuatro" ? Math.floor(i / 2) * tile : 0;
      ctx.putImageData(image, x, y);
      if (angle === "cuatro") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x, y, 96, 22);
        ctx.fillStyle = "#fff";
        ctx.font = "14px sans-serif";
        ctx.fillText(a, x + 6, y + 16);
      }
    });
  } finally {
    scene.background = previousBackground;
    renderer.setRenderTarget(previousTarget);
    target.dispose();
  }
  return canvas.toDataURL("image/jpeg", 0.85);
}
