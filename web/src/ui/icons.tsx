// Eigene Strich-Icons (24er Raster), damit nichts nach Icon-Baukasten aussieht.
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSelect = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 3.5 18.5 10l-5.6 1.9-2.3 5.6z" fill="currentColor" fillOpacity={0.12} />
    <path d="m12.9 11.9 4.6 4.6" />
  </Svg>
);
export const IconHand = (p: P) => (
  <Svg {...p}>
    <path d="M8 13V6.2a1.6 1.6 0 0 1 3.2 0V11" />
    <path d="M11.2 10.6V4.8a1.6 1.6 0 0 1 3.2 0v5.8" />
    <path d="M14.4 10.8V6.4a1.6 1.6 0 0 1 3.2 0v7.4c0 4-2.6 6.7-6.2 6.7-2.5 0-4-1.1-5.3-3.1L4 14.3a1.6 1.6 0 0 1 2.6-1.8L8 14" />
  </Svg>
);
export const IconSticky = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5.5h15v9.5l-4.5 4.5H4.5z" />
    <path d="M19.5 15h-4.5v4.5" />
  </Svg>
);
export const IconText = (p: P) => (
  <Svg {...p}>
    <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />
  </Svg>
);
export const IconShapes = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="9.5" height="9.5" rx="1" />
    <circle cx="15.5" cy="15.5" r="5" />
  </Svg>
);
export const IconConnector = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="18.5" r="2" />
    <path d="M7 17 18.5 5.5M12.5 5.5h6v6" />
  </Svg>
);
export const IconPen = (p: P) => (
  <Svg {...p}>
    <path d="M15.2 4.8a2.1 2.1 0 0 1 3 3L8.4 17.6 4.5 19.5l1.9-3.9z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);
export const IconLasso = (p: P) => (
  <Svg {...p}>
    <path d="M7.2 15.6C4.6 14.5 3 12.6 3 10.5 3 6.9 7 4 12 4s9 2.9 9 6.5-4 6.5-9 6.5c-.9 0-1.8-.1-2.6-.3" strokeDasharray="2.6 2.4" />
    <path d="M9.6 15.2c-1.6.2-2.6 1.1-2.6 2.2 0 1.3 1.3 2.1 2.2 2.6" />
  </Svg>
);
export const IconMarquee = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="1.5" strokeDasharray="2.6 2.4" />
  </Svg>
);
export const IconEraser = (p: P) => (
  <Svg {...p}>
    <path d="m8.6 19.5-4-4a1.6 1.6 0 0 1 0-2.3l9.1-9.1a1.6 1.6 0 0 1 2.3 0l4 4a1.6 1.6 0 0 1 0 2.3l-8 8.1z" />
    <path d="m9.2 8.6 6.3 6.3M8.6 19.5H20" />
  </Svg>
);
export const IconFrame = (p: P) => (
  <Svg {...p}>
    <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m20.5 15.5-5-5-9 9" />
  </Svg>
);
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M9 14 4.5 9.5 9 5" />
    <path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const IconRedo = (p: P) => (
  <Svg {...p}>
    <path d="m15 14 4.5-4.5L15 5" />
    <path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconFit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6" />
  </Svg>
);
export const IconDuplicate = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 8.5v-3a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);
export const IconUnlock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" />
  </Svg>
);
export const IconFront = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="1" fill="currentColor" fillOpacity={0.9} />
    <path d="M15 5.5V4H4v11h1.5" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="11" height="11" rx="1" fill="currentColor" fillOpacity={0.9} />
    <path d="M18.5 9H20v11H9v-1.5" />
  </Svg>
);
export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14M10.5 12H20M16.5 8.5 20 12l-3.5 3.5" />
  </Svg>
);
export const IconPencilSmall = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5l4 4L9 19H5v-4z" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconArrowEnd = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h15M14 7l5 5-5 5" />
  </Svg>
);
export const IconLine = (p: P) => (
  <Svg {...p}>
    <path d="M4 12h16" />
  </Svg>
);
export const IconRect = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="12" rx="1" />
  </Svg>
);
export const IconEllipse = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
  </Svg>
);
export const IconDiamond = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
  </Svg>
);
export const IconTriangle = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5 20.5 19h-17z" />
  </Svg>
);
export const IconQr = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Svg>
);
export const IconRetry = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m7 9.5 5 5 5-5" />
  </Svg>
);
/** Oberfläche wieder einblenden (Fokus-Modus) */
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
