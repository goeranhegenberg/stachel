// Symbole des Moduls (gleicher Strich wie ui/icons.tsx).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const Svg = ({ size = 20, children, ...rest }: P & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const IconComment = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H11l-4.5 3.5V17h-2a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
    <path d="M8 10h8M8 13.2h5" />
  </Svg>
);
export const IconTimer = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13.5" r="7" />
    <path d="M12 13.5V9.5M9.5 2.8h5M18.4 6.6l1.4-1.4" />
  </Svg>
);
export const IconVote = (p: P) => (
  <Svg {...p}>
    <path d="M4 14.5h16v5.5H4z" />
    <path d="M8 14.5 6.5 9l7.8-4.3 3.4 6.4-6 3.4" />
    <path d="m10.2 9.6 1.7 1.6 3-2.4" />
  </Svg>
);
export const IconLaser = (p: P) => (
  <Svg {...p}>
    <path d="M4 20 13 11" />
    <circle cx="16.5" cy="7.5" r="2.6" fill="currentColor" stroke="none" />
    <path d="M16.5 2.2v1.4M21.8 7.5h-1.4M20.3 3.7l-1 1M20.3 11.3l-1-1M12.7 3.7l1 1" />
  </Svg>
);
export const IconReact = (p: P) => (
  <Svg {...p}>
    <path d="M20.4 11.4A8.5 8.5 0 1 1 12.6 3.5" />
    <path d="M8.6 14.2c.9 1.3 2 1.9 3.4 1.9s2.5-.6 3.4-1.9M9 9.8h.01M15 9.8h.01" strokeWidth={2.4} />
    <path d="M19 2.5v5M16.5 5h5" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
export const IconSummon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M3 3l4.5 4.5M21 3l-4.5 4.5M3 21l4.5-4.5M21 21l-4.5-4.5" />
    <path d="M3 7.5V3h4.5M21 7.5V3h-4.5M3 16.5V21h4.5M21 16.5V21h-4.5" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconCheckCircle = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.3 12.3 2.6 2.6 5-5.2" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M4 12 20 4l-5 16-3.4-6.6Z" />
    <path d="M11.6 13.4 20 4" />
  </Svg>
);
export const IconDots = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={3} />
  </Svg>
);
export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />
  </Svg>
);
export const IconSound = ({ off, ...p }: P & { off?: boolean }) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {off ? <path d="m16 9.5 5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11" />}
  </Svg>
);
export const IconPeople = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.8 14.6c1.7.6 2.9 2.2 3.2 4.9" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m7 10 5 5 5-5" />
  </Svg>
);
export const IconTrophy = (p: P) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0Z" />
    <path d="M8 6H4.5v1.5A3 3 0 0 0 8 10.4M16 6h3.5v1.5a3 3 0 0 1-3.5 2.9M12 13v3.5M8.5 20h7M9.8 16.5h4.4L15 20H9z" />
  </Svg>
);

/** Mauszeiger für das Kommentar-Werkzeug (Sprechblase, Spitze unten links) */
export const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2 26V13C2 7 6.5 2.5 12.5 2.5h3C21.5 2.5 26 7 26 13s-4.5 10.5-10.5 10.5H8Z" fill="#c9e14a" stroke="#0a0a0a" stroke-width="2" stroke-linejoin="round"/><path d="M9 11h10M9 15h6" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round"/></svg>',
)}") 2 26, crosshair`;

/** Mauszeiger für den Laserpointer (roter Punkt) */
export const LASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="#ff2d55" fill-opacity=".25"/><circle cx="10" cy="10" r="3.6" fill="#ff2d55" stroke="#fff" stroke-width="1.4"/></svg>',
)}") 10 10, crosshair`;
