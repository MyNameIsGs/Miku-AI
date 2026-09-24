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
) => string;

let capturer: SelfViewCapturer | null = null;

export function registerSelfViewCapturer(fn: SelfViewCapturer | null) {
  capturer = fn;
}

export function getSelfViewCapturer(): SelfViewCapturer | null {
  return capturer;
}
