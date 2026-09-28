// Iconos de la interfaz (diseño v1): SVG en línea con trazo, color por
// `currentColor`. Los trazos salen de las maquetas de docs/diseno-ui-v1; los
// que la maqueta no trae (cámara, guardar, candado, ocultar texto, agarre)
// están dibujados con el mismo estilo. Nunca emoji en la UI.

import type { ReactNode } from "react";

type IconProps = { size?: number; strokeWidth?: number };

function Svg({ size = 18, strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconApps = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <rect x="14" y="14" width="6" height="6" rx="1.5" />
  </Svg>
);

export const IconMemory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 6c-2-1.5-5-2-8-1.5V18c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5c-3-.5-6 0-8 1.5z" />
    <path d="M12 6v13.5" />
  </Svg>
);

export const IconConfig = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4h4l5 4V6L8 10H4z" />
    <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);

export const IconVolumeMuted = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10v4h4l5 4V6L8 10H4z" />
    <path d="M17 10l4 4M21 10l-4 4" />
  </Svg>
);

export const IconMinimize = ({ size = 16, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <path d="M6 12h12" />
  </Svg>
);

export const IconClose = ({ size = 16, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconAttach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </Svg>
);

export const IconMic = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
  <Svg size={size} strokeWidth={strokeWidth} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

/** Enviar: flecha hacia arriba (el botón principal cuando hay algo escrito). */
export const IconSend = ({ size = 22, strokeWidth = 2, ...p }: IconProps) => (
  <Svg size={size} strokeWidth={strokeWidth} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);

/** Detener: cuadrado relleno (el ⏹ de antes). */
export const IconStop = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

export const IconCheck = ({ size = 14, strokeWidth = 2.4, ...p }: IconProps) => (
  <Svg size={size} strokeWidth={strokeWidth} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Svg>
);

export const IconMoon = ({ size = 14, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
);

export const IconNote = ({ size = 14, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </Svg>
);

export const IconBroadcast = ({ size = 14, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="2" />
    <path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8" />
  </Svg>
);

export const IconDoNotDisturb = ({ size = 14, ...p }: IconProps) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12h8" />
  </Svg>
);

// --- No vienen en la maqueta: botones que la barra actual todavía tiene. ---

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="13" height="10" rx="2.5" />
    <path d="M16 11l5-3v8l-5-3" />
  </Svg>
);

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2" />
    <path d="M9.9 14.1a3 3 0 0 1 4.2-4.2" />
    <path d="M4 20L20 4" />
  </Svg>
);

export const IconText = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="3" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
  </Svg>
);

export const IconQuirks = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3z" />
    <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
  </Svg>
);

/** Agarre para arrastrar: seis puntos. */
export const IconGrip = ({ size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {[8, 16].map((x) =>
      [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />),
    )}
  </svg>
);
