// Links: nur sichere Ziele (http/https/mailto/tel), Eingaben ohne Schema werden zu https.

const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Sicheres Linkziel oder null (z. B. `javascript:`). */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return ALLOWED.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Eingabe aus dem Link-Feld: `example.org` → `https://example.org/`, E-Mail-Adresse → mailto. */
export function normalizeHref(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return safeHref(`mailto:${s}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return safeHref(s);
  return safeHref(`https://${s}`);
}

/** Kurze Anzeige eines Links (ohne https://, gekürzt). */
export function shortHref(href: string, max = 48): string {
  const s = href.replace(/^https?:\/\//, '').replace(/^mailto:/, '').replace(/\/$/, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
