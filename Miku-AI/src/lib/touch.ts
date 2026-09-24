import * as THREE from "three";
import { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

// Tarea 8.12: reacción al tacto -- en qué parte del cuerpo de Miku cayó un
// clic o una caricia.
//
// No se hace raycast contra la malla: medido con este modelo, tardaba ~99
// ms por consulta (malla con esqueleto: cada triángulo se deforma por los
// huesos antes de probar el choque) y además no acertaba en ningún punto.
// En su lugar, cápsulas simples pegadas a los huesos (cabeza, torso,
// brazos, manos, piernas, y las cadenas de huesos de las coletas y la
// falda, que el .vrm ya trae para la física del pelo/tela): ~20 µs por
// consulta, y siguen solas al esqueleto cuando se mueve o el pelo se
// balancea. Radios calibrados superponiendo el mapa de zonas sobre el
// render del modelo, con la cámara por defecto de useVRMScene.
export type TouchZone =
  | "cabeza"
  | "coletas"
  | "cara"
  | "mano"
  | "brazo"
  | "torso"
  | "falda"
  | "pierna";

export type TouchHit = {
  zone: TouchZone;
  // Lado del cuerpo de Miku (no de la pantalla), para mano/brazo/coletas.
  side: "left" | "right";
};

type Capsule = {
  zone: TouchZone;
  radius: number;
  // Escribe los extremos del segmento en coordenadas de mundo; false si
  // falta algún hueso.
  ends: (a: THREE.Vector3, b: THREE.Vector3) => boolean;
};

// Largo del eje de la cabeza (desde la base del cráneo hacia arriba) y
// dónde termina "la cara": por debajo de esta altura y hacia adelante.
const HEAD_AXIS_FROM = 0.06;
const HEAD_AXIS_TO = 0.12;
const FACE_MAX_LOCAL_Y = 0.1;

function nodeCapsule(
  zone: TouchZone,
  radius: number,
  from: THREE.Object3D | null | undefined,
  to: THREE.Object3D | null | undefined,
): Capsule | null {
  if (!from || !to) return null;
  return {
    zone,
    radius,
    ends: (a, b) => {
      from.getWorldPosition(a);
      to.getWorldPosition(b);
      return true;
    },
  };
}

// Una cápsula por cada tramo hueso-padre de una cadena física (todos los
// mechones de las coletas, todas las tiras de la falda), sin importar
// cuántas cadenas o huesos tenga. Ojo: el cargador de three.js le saca
// los puntos a los nombres -- "TwinTail.A.001.L" queda "TwinTailA001L".
function chainCapsules(vrm: VRM, zone: TouchZone, radius: number, namePrefix: string): Capsule[] {
  const capsules: Capsule[] = [];
  vrm.scene.traverse((node) => {
    if (node.name.startsWith(namePrefix) && node.parent?.name.startsWith(namePrefix)) {
      const c = nodeCapsule(zone, radius, node.parent, node);
      if (c) capsules.push(c);
    }
  });
  return capsules;
}

const capsuleCache = new WeakMap<VRM, Capsule[]>();

function buildCapsules(vrm: VRM): Capsule[] {
  const bone = (name: VRMHumanBoneName) => vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  const head = bone("head");
  const up = new THREE.Vector3();
  const capsules: (Capsule | null)[] = [
    head && {
      zone: "cabeza",
      radius: 0.105,
      ends: (a, b) => {
        head.getWorldPosition(a);
        up.set(0, 1, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
        b.copy(a).addScaledVector(up, HEAD_AXIS_TO);
        a.addScaledVector(up, HEAD_AXIS_FROM);
        return true;
      },
    },
    nodeCapsule("torso", 0.075, bone("neck"), bone("head")),
    nodeCapsule("torso", 0.1, bone("chest"), bone("neck")),
    nodeCapsule("torso", 0.095, bone("spine"), bone("chest")),
    nodeCapsule("falda", 0.12, bone("hips"), bone("spine")),
  ];

  for (const side of ["left", "right"] as const) {
    const hand = bone(`${side}Hand`);
    const middle = bone(`${side}MiddleProximal`);
    capsules.push(
      nodeCapsule("brazo", 0.04, bone(`${side}UpperArm`), bone(`${side}LowerArm`)),
      nodeCapsule("brazo", 0.035, bone(`${side}LowerArm`), hand),
      hand && middle
        ? {
            zone: "mano",
            radius: 0.04,
            ends: (a, b) => {
              hand.getWorldPosition(a);
              middle.getWorldPosition(b);
              // Hasta la punta de los dedos, no solo el nudillo.
              b.sub(a).multiplyScalar(1.8).add(a);
              return true;
            },
          }
        : null,
      nodeCapsule("pierna", 0.065, bone(`${side}UpperLeg`), bone(`${side}LowerLeg`)),
      nodeCapsule("pierna", 0.05, bone(`${side}LowerLeg`), bone(`${side}Foot`)),
    );
  }
  capsules.push(
    ...chainCapsules(vrm, "coletas", 0.035, "TwinTail"),
    ...chainCapsules(vrm, "falda", 0.04, "Skirt"),
  );

  return capsules.filter((c): c is Capsule => c !== null);
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const segA = new THREE.Vector3();
const segB = new THREE.Vector3();
const onRay = new THREE.Vector3();
const onSeg = new THREE.Vector3();

export function detectTouchZone(
  vrm: VRM,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): TouchHit | null {
  let capsules = capsuleCache.get(vrm);
  if (!capsules) {
    capsules = buildCapsules(vrm);
    capsuleCache.set(vrm, capsules);
  }

  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const ray = raycaster.ray;

  // La cápsula que el rayo toca primero (la más cercana a la cámara).
  let best: { zone: TouchZone; depth: number; point: THREE.Vector3 } | null = null;
  for (const capsule of capsules) {
    if (!capsule.ends(segA, segB)) continue;
    const distSq = ray.distanceSqToSegment(segA, segB, onRay, onSeg);
    const r2 = capsule.radius * capsule.radius;
    if (distSq > r2) continue;
    const depth = onRay.distanceTo(ray.origin) - Math.sqrt(r2 - distSq);
    if (!best || depth < best.depth) {
      best = { zone: capsule.zone, depth, point: ray.at(depth, new THREE.Vector3()) };
    }
  }
  if (!best) return null;

  // Miku mira hacia +z: su izquierda es +x del mundo.
  const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
  const hipsX = hips ? hips.getWorldPosition(segA).x : 0;
  const side: "left" | "right" = best.point.x >= hipsX ? "left" : "right";

  let zone = best.zone;
  if (zone === "cabeza") {
    // Parte baja y delantera de la cabeza = la cara. "Adelante" es -z en
    // el espacio del hueso: los huesos normalizados de un VRM0 miran hacia
    // -z (la escena entera está girada 180° para mirar a la cámara).
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (head) {
      const local = head.worldToLocal(best.point.clone());
      if (local.z < 0 && local.y < FACE_MAX_LOCAL_Y) zone = "cara";
    }
  }
  return { zone, side };
}
