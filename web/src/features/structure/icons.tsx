// Strich-Icons des Moduls (24er Raster wie ui/icons).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconTemplates = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7.5" height="9" rx="1.5" />
    <rect x="13" y="3.5" width="7.5" height="5" rx="1.5" />
    <rect x="13" y="10.5" width="7.5" height="10" rx="1.5" />
    <rect x="3.5" y="14.5" width="7.5" height="6" rx="1.5" />
  </Svg>
);

export const IconMindmap = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="9.5" width="8" height="5" rx="2.5" />
    <path d="M16 12c2 0 2-5 4.5-5M16 12c2 0 2 5 4.5 5M8 12c-2 0-2-5-4.5-5M8 12c-2 0-2 5-4.5 5" />
  </Svg>
);

export const IconCard = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M3.5 5v14" strokeWidth={3.2} />
    <path d="M8 9.5h8M8 13h5" />
    <circle cx="17" cy="16" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconTable = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" />
  </Svg>
);

export const IconRowAdd = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="8" rx="1.5" />
    <path d="M12 15v6M9 18h6" />
  </Svg>
);
export const IconColAdd = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="8" height="17" rx="1.5" />
    <path d="M15 12h6M18 9v6" />
  </Svg>
);
export const IconRowDel = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="8" rx="1.5" />
    <path d="M9 18h6" />
  </Svg>
);
export const IconColDel = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="8" height="17" rx="1.5" />
    <path d="M15 12h6" />
  </Svg>
);
export const IconHead = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <rect x="3.5" y="4.5" width="17" height="5" rx="2" fill="currentColor" fillOpacity={0.5} />
    <path d="M9.5 9.5v10M15 9.5v10M3.5 14.5h17" />
  </Svg>
);

export const IconGrip = (p: P) => (
  <Svg {...p} strokeWidth={0}>
    {[7, 12, 17].map((y) => (
      <g key={y}>
        <circle cx="9" cy={y} r="1.5" fill="currentColor" />
        <circle cx="15" cy={y} r="1.5" fill="currentColor" />
      </g>
    ))}
  </Svg>
);

export const IconChild = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="9" width="7" height="6" rx="2" />
    <path d="M9.5 12h4M17.5 9v6M14.5 12h6" />
  </Svg>
);
export const IconSibling = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="3" width="12" height="6" rx="2" />
    <path d="M12 12.5v8M8 16.5h8" />
  </Svg>
);
export const IconCollapse = ({ open, ...p }: P & { open: boolean }) => (
  <Svg {...p}>
    <rect x="3" y="9" width="7" height="6" rx="2" />
    <path d="M10 12h3" />
    {open ? <path d="M15 12h6" /> : <path d="M15 12h6M18 9v6" />}
  </Svg>
);

export const IconDetails = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-7 7M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" />
  </Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const IconPerson = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2" />
  </Svg>
);
export const IconTag = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8.5" cy="8.5" r="1.4" />
  </Svg>
);
export const IconStatus = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.3 12.3l2.5 2.5 5-5.3" />
  </Svg>
);
export const IconAspect = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="13" height="9" rx="1.5" />
    <rect x="17" y="4" width="4.5" height="9" rx="1.2" />
    <path d="M5 19h16" strokeDasharray="2 2.5" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconFullscreen = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconBroadcast = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
  </Svg>
);

/** Sprechernotizen (Notizblatt mit Zeilen) */
export const IconNotes = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
    <path d="M15 3.5V7h3.5M9 11h6.5M9 14.5h6.5M9 18h4" />
  </Svg>
);

/** Präsentation übergeben (Pfeil zur Person) */
export const IconHandover = (p: P) => (
  <Svg {...p}>
    <circle cx="17" cy="7.5" r="3" />
    <path d="M12.5 20c.4-3.4 2-5.5 4.5-5.5s4.1 2.1 4.5 5.5M3 12h8M8 8.5 11.5 12 8 15.5" />
  </Svg>
);
