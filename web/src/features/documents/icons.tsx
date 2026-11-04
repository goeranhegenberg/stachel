// Strich-Icons des Moduls (24er Raster, wie ui/icons.tsx).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconPrev = (p: P) => (
  <Svg {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);
export const IconNext = (p: P) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);
export const IconFullscreen = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />
  </Svg>
);
/** Seiten nebeneinander (Alle Seiten aufs Board) */
export const IconPages = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="5" height="7" rx="0.8" />
    <rect x="9.5" y="5" width="5" height="7" rx="0.8" />
    <rect x="16" y="5" width="5" height="7" rx="0.8" />
    <rect x="3" y="14" width="5" height="7" rx="0.8" />
  </Svg>
);
/** Dokument mit umgeknickter Ecke */
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 15.5h6M9 19h3" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
