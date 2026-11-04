// Strich-Icons der Zeitleiste (24er Raster wie ../icons.tsx).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconTimeline = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 5.5h17" />
    <path d="M7 3.5v4M12 3.5v4M17 3.5v4" strokeWidth={1.4} />
    <rect x="4" y="10" width="9" height="3.6" rx="1.4" fill="currentColor" stroke="none" />
    <rect x="9" y="16" width="11" height="3.6" rx="1.4" />
  </Svg>
);

export const IconLaneAdd = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 6h12M3.5 11h12M3.5 16h7" />
    <path d="M17.5 14v6M14.5 17h6" />
  </Svg>
);

export const IconItemAdd = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="8.5" width="11" height="6" rx="2" />
    <path d="M18.5 8.5v6M15.5 11.5h6" />
  </Svg>
);

export const IconMilestone = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5 19.5 12 12 19.5 4.5 12z" />
  </Svg>
);

export const IconDates = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="M7.5 14h4" strokeWidth={2.4} />
  </Svg>
);

export const IconItemDel = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="8.5" width="11" height="6" rx="2" />
    <path d="M16.5 9l4.5 4.5M21 9l-4.5 4.5" />
  </Svg>
);
