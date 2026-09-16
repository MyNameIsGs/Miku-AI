import { ParsedMovement, ParsedHandGesture } from "../types";

export function describeSelfMovement(
  movement: ParsedMovement | null,
  handGesture: ParsedHandGesture | null,
): string | null {
  const lines: string[] = [];

  if (movement) {
    lines.push(
      "Último movimiento -- cada valor es el % del rango que pediste hacia ese lado:",
    );
    for (const { bone, axis, intensity } of movement.entries) {
      const pct = Math.abs(Math.round(intensity));
      const nearLimit = pct >= 95 ? " -- casi sin margen en esa dirección" : "";
      const animatedLabel = movement.animated ? " (oscilando)" : "";
      lines.push(
        `${bone}.${axis}: ${intensity}${animatedLabel} (${pct}% del límite hacia ese lado${nearLimit})`,
      );
    }
  }

  if (handGesture?.left) {
    lines.push(`Mano izquierda: gesto "${handGesture.left}"`);
  }
  if (handGesture?.right) {
    lines.push(`Mano derecha: gesto "${handGesture.right}"`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
