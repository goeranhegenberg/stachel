// QR-Pairing wie WhatsApp Web: Browser legt Pairing an, App bestätigt, Browser löst einmalig ein.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { QR_TTL_SECONDS } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import type { Identity } from './org-identity.js';
import { randomToken, sha256 } from './sessions.js';
import { TokenCrypt } from './token-crypt.js';

interface PairingRow {
  code: string;
  secret_hash: string;
  created_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'redeemed';
  user_key: string | null;
  name: string | null;
  is_orga: number | null;
  org_token: string | null;
  user_agent: string | null;
  ip_hint: string | null;
}

/** Was die App vor dem Freigeben über den anfragenden Browser zeigt (gegen QR-Phishing). */
export interface PairingInfo {
  browser: string | null;
  os: string | null;
  createdAt: string;
  /** Grobe Herkunft, nie die volle IP (z. B. `203.0.x.x`, `2001:db8:…`). */
  ipHint: string | null;
}

/** Browser und Betriebssystem grob aus dem User-Agent (nur bekannte Namen, sonst null). */
export function parseUserAgent(ua: string | undefined | null): { browser: string | null; os: string | null } {
  const s = (ua ?? '').slice(0, 512);
  const browser =
    // die Stachel-App selbst („Mit der {Org-App} anmelden“, docs/stachel_app_konzept.md §3)
    /StachelApp\//.test(s) ? 'Stachel-App'
    : /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /SamsungBrowser\//.test(s) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(s) ? 'Firefox'
    : /Chrome\/|CriOS\/|Chromium\//.test(s) ? 'Chrome'
    : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari'
    : null;
  const os =
    /Windows/.test(s) ? 'Windows'
    : /Android|\(android\)/.test(s) ? 'Android'
    : /iPhone|iPad|iPod|\(ios\)/.test(s) ? 'iOS'
    : /CrOS/.test(s) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux'
    : null;
  return { browser, os };
}

/** Grober IP-Hinweis: IPv4 → erste zwei Blöcke, IPv6 → erste zwei Gruppen. */
export function ipHint(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  if (ip.includes(':')) {
    const groups = ip.split('%')[0]!.split(':').filter(Boolean).slice(0, 2);
    return groups.length ? `${groups.join(':')}:…` : null;
  }
  return null;
}

/** Nach Bestätigung darf der Browser noch kurz nach Ablauf einlösen (Long-Poll-Verzögerung). */
const REDEEM_GRACE_MS = 60_000;
const KEEP_ROWS_MS = 10 * 60_000;

export type ApproveCheck = 'ok' | 'unknown_code' | 'expired' | 'already_used';

export type WaitResult =
  | { status: 'pending' }
  | { status: 'approved'; identity: Identity; orgToken: string }
  | { status: 'expired' }
  | { status: 'wrong_browser' };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export class PairingStore {
  private events = new EventEmitter();

  constructor(
    private readonly db: Db,
    /** Org-Token verschlüsselt speichern (token-crypt.ts) */
    private readonly crypt: TokenCrypt = TokenCrypt.plain,
  ) {
    this.events.setMaxListeners(0);
    // ältere Datenbanken: Spalten für den Browser-Hinweis nachrüsten
    const cols = new Set((db.prepare('PRAGMA table_info(pairings)').all() as unknown as { name: string }[]).map((c) => c.name));
    if (!cols.has('user_agent')) db.exec('ALTER TABLE pairings ADD COLUMN user_agent TEXT');
    if (!cols.has('ip_hint')) db.exec('ALTER TABLE pairings ADD COLUMN ip_hint TEXT');
  }

  /** Neues Pairing; ein noch offenes Pairing desselben Browsers (altes Pair-Cookie) verfällt. */
  create(
    previousSecret?: string,
    origin: { userAgent?: string; ip?: string } = {},
  ): { code: string; secret: string; expiresAt: string } {
    if (previousSecret && previousSecret.length <= 100) {
      this.db.prepare(`DELETE FROM pairings WHERE secret_hash = ? AND status = 'pending'`).run(sha256(previousSecret));
    }
    const code = randomToken(24);
    const secret = randomToken(32);
    const now = Date.now();
    const expiresAt = new Date(now + QR_TTL_SECONDS * 1000).toISOString();
    this.db
      .prepare(
        `INSERT INTO pairings (code, secret_hash, created_at, expires_at, status, user_agent, ip_hint)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(code, sha256(secret), new Date(now).toISOString(), expiresAt, (origin.userAgent ?? '').slice(0, 512) || null, ipHint(origin.ip));
    return { code, secret, expiresAt };
  }

  private row(code: string): PairingRow | undefined {
    if (!code || code.length > 100) return undefined;
    return this.db.prepare('SELECT * FROM pairings WHERE code = ?').get(code) as PairingRow | undefined;
  }

  /** Prüft, ob ein Code bestätigt werden kann (vor der teuren Token-Prüfung bzw. danach erneut). */
  checkApprovable(code: string): ApproveCheck {
    const r = this.row(code);
    if (!r) return 'unknown_code';
    if (r.status !== 'pending') return 'already_used';
    if (r.expires_at <= nowIso()) return 'expired';
    return 'ok';
  }

  /** Hinweis zum anfragenden Browser; verbraucht den Code nicht. */
  info(code: string): { check: ApproveCheck; info?: PairingInfo } {
    const check = this.checkApprovable(code);
    if (check !== 'ok') return { check };
    const r = this.row(code)!;
    return { check, info: { ...parseUserAgent(r.user_agent), createdAt: r.created_at, ipHint: r.ip_hint } };
  }

  approve(code: string, identity: Identity, orgToken: string): ApproveCheck {
    const check = this.checkApprovable(code);
    if (check !== 'ok') return check;
    const res = this.db
      .prepare(
        `UPDATE pairings SET status = 'approved', user_key = ?, name = ?, is_orga = ?, org_token = ?, approved_at = ?
         WHERE code = ? AND status = 'pending'`,
      )
      .run(identity.userKey, identity.name, identity.isOrga ? 1 : 0, this.crypt.seal(orgToken), nowIso(), code);
    if (Number(res.changes) !== 1) return 'already_used';
    this.events.emit(code);
    return 'ok';
  }

  /** Einmaliger Zustandsblick inkl. Einlösen, falls bestätigt. */
  private poll(code: string, secret: string | undefined): WaitResult {
    const r = this.row(code);
    if (!r) return { status: 'expired' };
    if (!secret || !safeEqual(sha256(secret), r.secret_hash)) return { status: 'wrong_browser' };
    const now = Date.now();
    const expires = Date.parse(r.expires_at);
    if (r.status === 'redeemed') return { status: 'expired' };
    if (r.status === 'approved') {
      if (now > expires + REDEEM_GRACE_MS) return { status: 'expired' };
      const res = this.db
        .prepare(`UPDATE pairings SET status = 'redeemed', org_token = NULL WHERE code = ? AND status = 'approved'`)
        .run(code);
      if (Number(res.changes) !== 1) return { status: 'expired' };
      return {
        status: 'approved',
        identity: { userKey: r.user_key!, name: r.name!, isOrga: r.is_orga === 1 },
        orgToken: this.crypt.open(r.org_token!),
      };
    }
    if (now >= expires) return { status: 'expired' };
    return { status: 'pending' };
  }

  /** Long-Poll: wartet bis zur Bestätigung, zum Ablauf oder höchstens maxWaitMs. */
  async wait(code: string, secret: string | undefined, maxWaitMs: number, signal?: AbortSignal): Promise<WaitResult> {
    const first = this.poll(code, secret);
    if (first.status !== 'pending') return first;
    const r = this.row(code)!;
    const untilExpiry = Math.max(0, Date.parse(r.expires_at) - Date.now());
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.events.off(code, done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(maxWaitMs, untilExpiry + 50));
      this.events.on(code, done);
      signal?.addEventListener('abort', done);
    });
    if (signal?.aborted) return { status: 'pending' };
    return this.poll(code, secret);
  }

  purgeOld(): void {
    const cutoff = new Date(Date.now() - KEEP_ROWS_MS).toISOString();
    this.db.prepare('DELETE FROM pairings WHERE created_at < ?').run(cutoff);
  }
}
