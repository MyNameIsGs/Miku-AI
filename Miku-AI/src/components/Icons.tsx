// Iconos de la interfaz: SVG en línea con trazo, color por `currentColor`.
// Los trazos salen de las maquetas (docs/diseno-ui-v1 y v2). Nunca emoji
// en la UI.

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
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.4 6.5A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4.2-1" />
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

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

/** Guardar: disquete. */
export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
  </Svg>
);

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h6l2 2h10v10H3z" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const IconChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 15l-6-6-6 6" />
  </Svg>
);

export const IconReload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M4 17l5-4.5 4 3.5 3-2.5 4.5 4" />
  </Svg>
);

/** Archivo con flecha hacia adentro (soltar un archivo). */
export const IconFileDrop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
    <path d="M13 11v6M10 14l3 3 3-3" />
  </Svg>
);

/** Agarre para arrastrar: seis puntos rellenos. */
export const IconGrip = ({ size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {[9, 15].map((x) =>
      [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />),
    )}
  </svg>
);

/** El cebollín de Miku (ícono de la app, a color). */
export const IconLeek = ({ size = 56 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 108 108" aria-hidden="true" focusable="false">
    <g transform="translate(54 54) rotate(-30) scale(1.15) translate(-54 -54)">
      <rect x="47" y="26" width="9" height="32" rx="4.5" fill="#2A9D95" transform="rotate(-16 54 56)" />
      <rect x="52" y="26" width="9" height="32" rx="4.5" fill="#2A9D95" transform="rotate(16 54 56)" />
      <rect x="49" y="20" width="10" height="38" rx="5" fill="#39C5BB" />
      <rect x="48" y="54" width="12" height="30" rx="6" fill="#EAF4F3" />
      <rect x="46.5" y="52" width="15" height="6" rx="3" fill="#F0508F" />
    </g>
  </svg>
);
