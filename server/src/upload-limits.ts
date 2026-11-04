// Speicherquote, Upload-Größe und -Rate, Boards je Person (Sicherheits-Review 2026-11-02 UPL-2, Grenzen in limits.ts).
// Ein preHandler im Sitzungs-Bereich prüft vor dem Lesen des Bodys: Uploads (Bild, PDF) zählen gegen das Stundenlimit
// der Person, `Content-Length` gegen die Größe je Upload und gegen den freien Speicher; Board anlegen, duplizieren und
// eine Version als Kopie gegen die Zahl der Boards (und den Speicher, die Kopie dupliziert Bilder).
// Die Quote ist eine weiche Grenze: Kopien beim Einfügen über Boards hinweg (image-binding.ts) und Duplikate werden
// mitgezählt, aber nicht mittendrin abgebrochen – danach geht nichts Neues mehr, bis wieder Platz ist.
// Antworten: 413 `too_large` / `quota_exceeded`, 429 `rate_limited`, 403 `board_limit`, jeweils mit deutschem Text
// (Web: api.ts zeigt den Text des Servers, Apps: stachel_client).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { sendError } from './http-util.js';
import { formatBytes, type Limits } from './limits.js';
import { RateLimiter } from './rate-limit.js';

const UPLOAD_ROUTES = new Set(['/api/boards/:id/images', '/api/boards/:id/files']);
/** legen ein neues Board an (dem Fragenden gehört es) */
const BOARD_ROUTES = new Set(['/api/boards', '/api/boards/:id/duplicate', '/api/boards/:id/versions/:vid/copy']);
/** Multipart-Rahmen (Grenzen, Kopfzeilen) über der Dateigröße */
const MULTIPART_SLACK = 64 * 1024;

export class UploadLimits {
  private readonly rate: RateLimiter;

  constructor(
    private readonly db: Db,
    readonly limits: Limits,
  ) {
    db.exec('CREATE INDEX IF NOT EXISTS images_created_by ON images(created_by)');
    this.rate = new RateLimiter(Math.max(1, limits.uploadsPerHour), 3600_000);
  }

  /** belegter Speicher einer Person (Bilder, PDF-Originale und -Seiten, Kopien), in Bytes */
  usage(userKey: string): number {
    const r = this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM images WHERE created_by = ?').get(userKey) as { n: number };
    return Number(r.n);
  }

  /** Boards, die der Person gehören (auch im Papierkorb – sie belegen weiter Platz) */
  boards(userKey: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM boards WHERE created_by = ?').get(userKey) as { n: number }).n);
  }

  tooLargeText(kind: 'image' | 'pdf' | 'file' = 'file'): string {
    const what = kind === 'image' ? 'Das Bild' : kind === 'pdf' ? 'Die PDF' : 'Die Datei';
    return `${what} ist zu groß (höchstens ${formatBytes(this.limits.uploadMaxBytes)}).`;
  }

  quotaText(used: number): string {
    return (
      `Dein Speicherplatz ist voll (${formatBytes(used)} von ${formatBytes(this.limits.userQuotaBytes)} belegt). ` +
      'Lösche Boards, die du nicht mehr brauchst, und leere den Papierkorb, um Platz zu schaffen.'
    );
  }

  /** Passt `add` Bytes noch in die Quote der Person? (0 = ohne Quote) */
  fits(userKey: string, add: number): { ok: true } | { ok: false; used: number } {
    if (!this.limits.userQuotaBytes) return { ok: true };
    const used = this.usage(userKey);
    return used + add > this.limits.userQuotaBytes ? { ok: false, used } : { ok: true };
  }

  prune() {
    this.rate.prune();
  }

  /** preHandler (Sitzungs-Bereich, nach dem Guard): Prüfungen vor dem Lesen des Bodys */
  check = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method !== 'POST' || !req.session) return;
    const route = req.routeOptions?.url ?? '';
    const user = req.session.userKey;
    const length = Number(req.headers['content-length'] ?? 0) || 0;
    if (UPLOAD_ROUTES.has(route)) {
      const kind = route.endsWith('/files') ? 'pdf' : 'image';
      if (length > this.limits.uploadMaxBytes + MULTIPART_SLACK) return sendError(reply, 413, 'too_large', this.tooLargeText(kind));
      const fit = this.fits(user, Math.max(0, length - MULTIPART_SLACK));
      if (!fit.ok) return sendError(reply, 413, 'quota_exceeded', this.quotaText(fit.used));
      if (this.limits.uploadsPerHour && !this.rate.allow(user)) {
        return sendError(reply, 429, 'rate_limited', 'Zu viele Uploads in kurzer Zeit. Bitte warte ein paar Minuten und versuch es dann noch einmal.');
      }
      return;
    }
    if (BOARD_ROUTES.has(route)) {
      const max = this.limits.maxBoardsPerUser;
      if (max && this.boards(user) >= max) {
        return sendError(reply, 403, 'board_limit', `Du hast schon ${max} Boards (auch im Papierkorb). Lösche alte Boards und leere den Papierkorb, um neue anzulegen.`);
      }
      // Duplikate kopieren Bilder: nur mit freiem Speicher
      if (route !== '/api/boards' && this.limits.userQuotaBytes) {
        const used = this.usage(user);
        if (used >= this.limits.userQuotaBytes) return sendError(reply, 413, 'quota_exceeded', this.quotaText(used));
      }
    }
  };
}

/** Prüfungen im Sitzungs-Bereich einhängen (nach registerAccessGuard registrieren: 404/403 vor Quote). */
export function registerUploadLimits(scope: FastifyInstance, limits: UploadLimits) {
  scope.addHook('preHandler', limits.check);
  const timer = setInterval(() => limits.prune(), 10 * 60_000);
  timer.unref();
  scope.addHook('onClose', async () => clearInterval(timer));
}
