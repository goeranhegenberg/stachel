// Einfaches In-Memory-Rate-Limit (gleitendes Fenster je Schlüssel, z. B. IP).

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Zählt einen Versuch; false, wenn das Limit erreicht ist. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Wie viele Versuche im Fenster noch frei sind (ohne zu zählen). */
  remaining(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    return Math.max(0, this.limit - (this.hits.get(key) ?? []).filter((t) => t > cutoff).length);
  }

  /** true, wenn das Limit erreicht ist (ohne zu zählen). */
  blocked(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff).length >= this.limit;
  }

  /** Zählt einen Versuch ohne Prüfung (z. B. nur Fehlversuche). */
  hit(key: string, now = Date.now()): void {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    list.push(now);
    this.hits.set(key, list);
  }

  /** Alte Einträge entfernen (periodisch aufrufen). */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, list] of this.hits) {
      const fresh = list.filter((t) => t > cutoff);
      if (fresh.length) this.hits.set(key, fresh);
      else this.hits.delete(key);
    }
  }
}

/**
 * Schlüssel für IP-basierte Limits: IPv4 (auch IPv4-mapped) unverändert, IPv6 auf das /64-Präfix gekürzt.
 * Sonst bekäme jeder IPv6-Anschluss Milliarden frische Kontingente.
 */
export function ipKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('%')[0]!.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

/**
 * IP-Adresse fürs Protokoll gekürzt (Datenschutz, docs/legal/datenschutz.md V9): IPv4 ohne letztes Oktett (`203.0.113.0`),
 * IPv6 nur das /48-Präfix (`2001:db8:1::/48`). Reicht für Fehlersuche und Missbrauchsmuster, nennt aber keinen Anschluss.
 */
export function logIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const k = ipKey(ip);
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(k);
  if (v4) return `${v4[1]}.0`;
  if (k.endsWith('::/64')) return `${k.slice(0, -5).split(':').slice(0, 3).join(':')}::/48`;
  return k;
}
