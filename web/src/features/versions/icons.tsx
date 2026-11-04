// Symbol „Versionsverlauf“ (Uhr mit Rückwärtspfeil), im Strich-Stil von ui/icons.
type P = { size?: number };

export const IconHistory = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5v4h4" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
