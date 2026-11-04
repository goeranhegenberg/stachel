// Strich-Icons des Moduls tools (24er Raster, wie ui/icons.tsx).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconArrowUp = (p: P) => (
  <Svg {...p}>
    <path d="m6 14 6-6 6 6" />
  </Svg>
);
export const IconArrowDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 10 6 6 6-6" />
  </Svg>
);
export const IconExport = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5v11" />
    <path d="m7.5 10 4.5 4.5 4.5-4.5" />
    <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </Svg>
);
/** Format übertragen (Pinsel) */
export const IconBrush = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="14" height="6" rx="1.6" fill="currentColor" fillOpacity={0.14} />
    <path d="M18 6.5h1.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H12v2.5" />
    <path d="M10.6 14.5h2.8v5.2a1.4 1.4 0 0 1-2.8 0z" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M9.6 6A9.6 9.6 0 0 1 12 5.5C17.8 5.5 21.2 12 21.2 12a17 17 0 0 1-2.6 3.4M6.2 7.4A16.6 16.6 0 0 0 2.8 12S6.2 18.5 12 18.5a8.8 8.8 0 0 0 4.3-1.1" />
    <path d="M10 10.2a2.8 2.8 0 0 0 3.8 3.8" />
    <path d="m3.5 3.5 17 17" />
  </Svg>
);
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </Svg>
);
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" strokeWidth={1.3} />
  </Svg>
);
export const IconMagnet = (p: P) => (
  <Svg {...p}>
    <path d="M6 4h4v8a2 2 0 0 0 4 0V4h4v8a6 6 0 0 1-12 0z" />
    <path d="M6 8h4M14 8h4" />
  </Svg>
);
export const IconForward = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3.5" width="11.5" height="11.5" rx="2" fill="currentColor" fillOpacity={0.18} />
    <path d="M6 9H5.5a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2H13a2 2 0 0 0 2-2V18" />
  </Svg>
);
export const IconTemplate = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M3.5 9h17M9 9v11.5" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
  </Svg>
);
/** Handy mit Pfeil (in der App öffnen) */
export const IconOpenApp = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10 18.5h2" />
    <path d="M13 9.5h7.5M17.5 6.5l3 3-3 3" />
  </Svg>
);
export const IconImageFile = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="9.8" r="1.6" />
    <path d="m20.5 15.5-4.8-4.8-8.6 8.8" />
  </Svg>
);
export const IconPdf = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 2.5h8l4 4v13a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" />
    <path d="M14.5 2.5v4h4" />
    <path d="M8 13.5h8M8 17h5" />
  </Svg>
);

/** Textmarker (Stift-Werkzeug, Modus „Textmarker“) mit Farbbalken */
export const IconMarker = ({ color, ...p }: P & { color?: string }) => (
  <Svg {...p}>
    <path d="m14.5 4.5 5 5-7.5 7.5h-5v-5z" />
    <path d="m7 12 5 5" />
    <path d="M7 17 5 19" />
    {color && <path d="M4 21.2h16" stroke={color} strokeWidth={2.6} strokeOpacity={0.85} />}
  </Svg>
);
export const IconPenMode = (p: P) => (
  <Svg {...p}>
    <path d="M15.2 4.8a2.1 2.1 0 0 1 3 3L8.4 17.6 4.5 19.5l1.9-3.9z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);
/** Tag (Notiz-Tags) */
export const IconTag = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12.3V5a1.5 1.5 0 0 1 1.5-1.5h7.3a1.5 1.5 0 0 1 1 .4l7.3 7.3a1.5 1.5 0 0 1 0 2.1l-7.3 7.3a1.5 1.5 0 0 1-2.1 0l-7.3-7.3a1.5 1.5 0 0 1-.4-1z" />
    <circle cx="8.2" cy="8.2" r="1.4" />
  </Svg>
);
/** Sprung zu einem verlinkten Objekt/Rahmen */
export const IconJump = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10.5 13.5" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
);
export const IconReplace = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h11.5" />
    <path d="m12.5 4 3 3-3 3" />
    <path d="M20 17H8.5" />
    <path d="m11.5 14-3 3 3 3" />
  </Svg>
);
