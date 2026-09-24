import { ParsedMovement } from "../types";
import { SelfViewAngle, SelfViewFraming } from "./selfView";

// Las tools viven en módulos planos (no componentes de React) y no ven la
// escena 3D: App.tsx registra acá la función que captura (con acceso al
// VRM, el renderer y los huesos), y la tool `mirarme` solo la llama. Mismo
// patrón que appLauncherStore.ts.
export type SelfViewCapturer = (
  angle: SelfViewAngle,
  framing: SelfViewFraming,
  // Pose de prueba: se aplica solo para la foto y después todo vuelve a
  // como estaba (ver mirarme.ts).
  previewMovement: ParsedMovement | null,
  // true: la pose de prueba se aplica sobre el reposo, no sobre la pose
  // actual (para ver un gesto "limpio", como al diseñar una reacción al
  // tacto mientras todavía se está reproduciendo la de respaldo).
  fromRest?: boolean,
) => string;

let capturer: SelfViewCapturer | null = null;

export function registerSelfViewCapturer(fn: SelfViewCapturer | null) {
  capturer = fn;
}

export function getSelfViewCapturer(): SelfViewCapturer | null {
  return capturer;
}

// [LLEVAR_MANO] (ver lib/reach.ts) también necesita el cuerpo: App.tsx
// registra cómo resolverlo, para que `mirarme` pueda probar un lugar.
// Recibe el texto con el marcador y la pose de prueba (si hay), y devuelve
// los ángulos de brazo resueltos (o null si no había marcador).
export type ReachResolver = (text: string, base: ParsedMovement | null) => ParsedMovement | null;

let reachResolver: ReachResolver | null = null;

export function registerReachResolver(fn: ReachResolver | null) {
  reachResolver = fn;
}

export function getReachResolver(): ReachResolver | null {
  return reachResolver;
}
