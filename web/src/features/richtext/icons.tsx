// Strich-Icons der Format-Leiste (24er Raster wie ui/icons).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
  </Svg>
);

export const IconUnlink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    <path d="M4 4l16 16" />
  </Svg>
);

export const IconBullets = (p: P) => (
  <Svg {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconNumbers = (p: P) => (
  <Svg {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 4.5l1.5-1v5" strokeWidth={1.5} />
    <path d="M3.8 13.2c.3-.9 2.6-1 2.6.4 0 1-2.6 1.8-2.6 2.9h2.7" strokeWidth={1.5} />
  </Svg>
);

export const IconChecklist = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="5" rx="1.2" />
    <path d="M4.3 6.6l1.1 1 1.8-2.2" strokeWidth={1.5} />
    <rect x="3" y="14" width="5" height="5" rx="1.2" />
    <path d="M11 6.5h9M11 16.5h9" />
  </Svg>
);

/** „A“ mit Farbbalken darunter (Textfarbe) */
export const IconTextColor = ({ color, ...p }: P & { color: string }) => (
  <Svg {...p}>
    <path d="M7 16l5-12 5 12M8.8 11.5h6.4" />
    <rect x="4" y="18.5" width="16" height="3.2" rx="1" fill={color} stroke="rgba(255,255,255,.55)" strokeWidth={0.8} />
  </Svg>
);

/** Textmarker mit Farbbalken (Markierung) */
export const IconHighlight = ({ color, ...p }: P & { color: string }) => (
  <Svg {...p}>
    <path d="M14.5 3.5l4 4-7.5 7.5H7v-4z" />
    <path d="M7 15l-2 2h4" />
    <rect x="4" y="18.5" width="16" height="3.2" rx="1" fill={color} stroke="rgba(255,255,255,.55)" strokeWidth={0.8} />
  </Svg>
);

export const IconCaret = (p: P) => (
  <Svg size={12} {...p}>
    <path d="M6 9l6 6 6-6" strokeWidth={2.4} />
  </Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);

/** Drei Punkte („Mehr“) */
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);
