// Personen blockieren (Google Play UGC: @-Erwähnungen und Einladungen → Blockieren nötig; docs/features/moderation.md).
// Wer jemanden blockiert, bekommt von dieser Person keine Einladungen/Teilen mehr (access-routes.ts) und keine
// @Erwähnungen bzw. Zuweisungen im Posteingang (native/inbox.ts, Web: collab/comments.ts unreadMentions). Die blockierte
// Person erfährt davon nichts. Beide Modi (org und local).
import type { FastifyInstance } from 'fastify';
import { BLOCKS_PATH, type BlockedPerson } from '../../shared/moderation.js';
import { nowIso, type Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import { RateLimiter } from './rate-limit.js';

/** Auch von native/inbox.ts angelegt (Posteingang filtert Blockierte, unabhängig von der Reihenfolge beim Start). */
export const BLOCKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_blocks (
  user_key TEXT NOT NULL,          -- wer blockiert
  blocked_key TEXT NOT NULL,       -- wen
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_key, blocked_key)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked ON user_blocks(blocked_key);
`;

/** user_key: `u:<id>` (local), Kennung des Identitätsdienstes (org); keine Steuerzeichen */
export const USER_KEY_RE = /^[^\s\x00-\x1f\x7f]{1,200}$/;
const MAX_BLOCKS = 500;

export class Blocks {
  constructor(private readonly db: Db) {
    db.exec(BLOCKS_SCHEMA);
  }

  /** Hat `userKey` die Person `byKey` blockiert? */
  isBlocked(userKey: string, byKey: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM user_blocks WHERE user_key = ? AND blocked_key = ?').get(userKey, byKey));
  }

  list(userKey: string): BlockedPerson[] {
    return (
      this.db
        .prepare(
          `SELECT b.blocked_key AS key, COALESCE(u.name, '') AS name, b.created_at AS at FROM user_blocks b
           LEFT JOIN users u ON u.key = b.blocked_key WHERE b.user_key = ? ORDER BY b.created_at`,
        )
        .all(userKey) as unknown as BlockedPerson[]
    ).map((r) => ({ key: r.key, name: r.name || 'Unbekannt', at: r.at }));
  }

  add(userKey: string, blockedKey: string): boolean {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM user_blocks WHERE user_key = ?').get(userKey) as { n: number }).n;
    if (n >= MAX_BLOCKS) return false;
    this.db.prepare('INSERT OR IGNORE INTO user_blocks (user_key, blocked_key, created_at) VALUES (?, ?, ?)').run(userKey, blockedKey, nowIso());
    return true;
  }

  remove(userKey: string, blockedKey: string) {
    this.db.prepare('DELETE FROM user_blocks WHERE user_key = ? AND blocked_key = ?').run(userKey, blockedKey);
  }

  /** Konto gelöscht: eigene Blockierungen weg (die anderer auf diese Person bleiben, der Schlüssel ist zufällig). */
  forgetUser(userKey: string) {
    this.db.prepare('DELETE FROM user_blocks WHERE user_key = ?').run(userKey);
  }
}

/**
 * `GET /api/blocks` → `{ok, blocked:[{key,name,at}]}`, `PUT /api/blocks/:key` blockieren, `DELETE /api/blocks/:key`
 * aufheben (jeweils mit der neuen Liste). Im Sitzungs-Scope registrieren.
 */
export function registerBlockRoutes(scope: FastifyInstance, blocks: Blocks) {
  const limiter = new RateLimiter(60, 3600_000);
  const timer = setInterval(() => limiter.prune(), 60_000);
  timer.unref();
  scope.addHook('onClose', async () => clearInterval(timer));
  const ok = (key: string) => ({ ok: true, blocked: blocks.list(key) });

  scope.get(BLOCKS_PATH, async (req) => ok(req.session!.userKey));

  scope.put<{ Params: { key: string } }>(`${BLOCKS_PATH}/:key`, async (req, reply) => {
    const me = req.session!.userKey;
    const key = req.params.key;
    if (!USER_KEY_RE.test(key) || key === me) return sendError(reply, 400, 'invalid_input', 'Dich selbst kannst du nicht blockieren.');
    if (!limiter.allow(me)) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    if (!blocks.add(me, key)) return sendError(reply, 400, 'invalid_input', 'Du hast schon sehr viele Personen blockiert.');
    return ok(me);
  });

  scope.delete<{ Params: { key: string } }>(`${BLOCKS_PATH}/:key`, async (req, reply) => {
    const me = req.session!.userKey;
    if (!USER_KEY_RE.test(req.params.key)) return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
    blocks.remove(me, req.params.key);
    return ok(me);
  });
}
