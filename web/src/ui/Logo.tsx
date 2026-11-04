// Stachel-Marke: ein schlanker Dorn mit Pin-Kopf.
export function StachelMark({ size = 28, head = '#c9e14a', body = 'currentColor' }: { size?: number; head?: string; body?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="stachel-mark">
      <path d="M16 30.5 13.1 12.2a2.95 2.95 0 0 1 5.8 0Z" fill={body} />
      <circle cx="16" cy="8" r="5.4" fill={head} />
      <circle cx="14.4" cy="6.5" r="1.4" fill="#fff" opacity={0.55} />
    </svg>
  );
}

export function Wordmark({ size = 28, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <span className={`wordmark${inverted ? ' wordmark--inv' : ''}`} style={{ fontSize: size }}>
      <StachelMark size={size * 1.05} body={inverted ? '#fff' : '#0a0a0a'} />
      <span>Stachel</span>
    </span>
  );
}
