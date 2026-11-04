// Zusätzliche Strich-Icons für Ausrichten, Format, Verbinder und Navigation (24er Raster wie ui/icons).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
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

const box = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx={1.5} fill="currentColor" fillOpacity={0.14} />;

export const IconAlignLeft = (p: P) => (
  <Svg {...p}>
    <path d="M4 3v18" />
    {box(7, 6, 12, 4)}
    {box(7, 14, 7, 4)}
  </Svg>
);
export const IconAlignHCenter = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18" />
    {box(5, 6, 14, 4)}
    {box(8, 14, 8, 4)}
  </Svg>
);
export const IconAlignRight = (p: P) => (
  <Svg {...p}>
    <path d="M20 3v18" />
    {box(5, 6, 12, 4)}
    {box(10, 14, 7, 4)}
  </Svg>
);
export const IconAlignTop = (p: P) => (
  <Svg {...p}>
    <path d="M3 4h18" />
    {box(6, 7, 4, 12)}
    {box(14, 7, 4, 7)}
  </Svg>
);
export const IconAlignVCenter = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h18" />
    {box(6, 5, 4, 14)}
    {box(14, 8, 4, 8)}
  </Svg>
);
export const IconAlignBottom = (p: P) => (
  <Svg {...p}>
    <path d="M3 20h18" />
    {box(6, 5, 4, 12)}
    {box(14, 10, 4, 7)}
  </Svg>
);
export const IconDistH = (p: P) => (
  <Svg {...p}>
    <path d="M3 4v16M21 4v16" />
    {box(9.5, 7, 5, 10)}
  </Svg>
);
export const IconDistV = (p: P) => (
  <Svg {...p}>
    <path d="M4 3h16M4 21h16" />
    {box(7, 9.5, 10, 5)}
  </Svg>
);
export const IconAlignMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 3v18" />
    {box(7, 5, 13, 5)}
    {box(7, 14, 8, 5)}
  </Svg>
);
export const IconGroup = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
    {box(6.5, 6.5, 6, 6)}
    {box(11.5, 11.5, 6, 6)}
  </Svg>
);
export const IconUngroup = (p: P) => (
  <Svg {...p}>
    {box(3.5, 3.5, 8, 8)}
    {box(12.5, 12.5, 8, 8)}
    <path d="M15 4.5h4.5V9M9 19.5H4.5V15" />
  </Svg>
);
export const IconTextAlign = ({ align, ...p }: P & { align: 'left' | 'center' | 'right' }) => {
  const short = align === 'left' ? 'M4 12h10' : align === 'right' ? 'M10 12h10' : 'M7 12h10';
  const shorter = align === 'left' ? 'M4 18h13' : align === 'right' ? 'M7 18h13' : 'M5.5 18h13';
  return (
    <Svg {...p}>
      <path d={`M4 6h16${short}${shorter}`} />
    </Svg>
  );
};
export const IconVAlign = ({ valign, ...p }: P & { valign: 'top' | 'middle' | 'bottom' }) => {
  const y = valign === 'top' ? 7 : valign === 'bottom' ? 15 : 11;
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d={`M8 ${y}h8M9.5 ${y + 3}h5`} />
    </Svg>
  );
};
export const IconLineStraight = (p: P) => (
  <Svg {...p}>
    <path d="M4 19 20 5" />
  </Svg>
);
export const IconLineElbow = (p: P) => (
  <Svg {...p}>
    <path d="M4 19h8V5h8" />
  </Svg>
);
export const IconLineCurved = (p: P) => (
  <Svg {...p}>
    <path d="M4 19C12 19 12 5 20 5" />
  </Svg>
);
export const IconArrowStart = (p: P) => (
  <Svg {...p}>
    <path d="M20 12H5M10 7l-5 5 5 5" />
  </Svg>
);
export const IconDash = ({ dash, ...p }: P & { dash: 'solid' | 'dashed' | 'dotted' }) => (
  <Svg {...p}>
    <path d="M3 12h18" strokeDasharray={dash === 'dashed' ? '5 3.5' : dash === 'dotted' ? '0.1 4' : undefined} strokeWidth={dash === 'dotted' ? 2.6 : 2} />
  </Svg>
);
export const IconBorder = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" strokeWidth={2.4} />
  </Svg>
);
export const IconFrames = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="11" height="8" rx="1" />
    <rect x="10" y="11" width="11" height="8" rx="1" fill="currentColor" fillOpacity={0.14} />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" fillOpacity={0.2} />
  </Svg>
);
export const IconChevron = ({ dir, ...p }: P & { dir: 'left' | 'right' }) => (
  <Svg {...p}>
    <path d={dir === 'left' ? 'M14.5 5 7.5 12l7 7' : 'M9.5 5l7 7-7 7'} />
  </Svg>
);
export const IconKeyboard = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9" />
  </Svg>
);
export const IconZoomSel = (p: P) => (
  <Svg {...p}>
    <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="currentColor" fillOpacity={0.14} />
  </Svg>
);
