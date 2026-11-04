// Moderation (Google Play UGC, DSA Art. 16/17; docs/features/moderation.md, Betrieb: docs/ops/moderation.md).
// - Konto-Sperre (`account_locks`): Hooks an der Wurzel der App sperren Anfragen und neue Anmeldungen gesperrter Konten
//   (403 `account_locked`), Sitzungen, API-Tokens und Verbindungen werden beim Sperren entfernt.
// - Board-Sperre (`board_locks` in access.ts): readonly = alle nur ansehen, hidden = für alle ausgeblendet. Modus local
//   über access.roleOf; Modus org über den Sperr-Guard hier und access.connectRole (Sync, Native-API).
// - `GET /api/boards/:id/moderation` (Hinweis im Editor) und die Admin-API `/api/admin/…` für tools/admin.mts
//   (Bearer STACHEL_ADMIN_TOKEN): Meldungen ansehen und entscheiden (mit Begründung, Benachrichtigung beider Seiten),
//   Boards sperren/löschen, Konten sperren, Inhalte entfernen.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS, SESSION_COOKIE } from '../../shared/protocol.js';
import type { BoardLockMode } from '../../shared/moderation.js';
import { requiredRole, ROLE_RANK, type BoardAccess } from './access.js';
import { Blocks, registerBlockRoutes, USER_KEY_RE } from './blocks.js';
import { nowIso, type Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import type { MailMessage, Mailer } from './mailer.js';
import { appSessionToken } from './native/auth.js';
import { ipKey, RateLimiter } from './rate-limit.js';
import { DECISION_LABEL, isDecision, moderatorAddress, registerReports, reportJson, reportMails, Reports, type Decision, type ReportRow } from './reports.js';
import type { SessionStore } from './sessions.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const REPORT_ID_RE = /^R-[A-Z0-9]{8}$/;
const MIN_ADMIN_TOKEN = 32;
const STATEMENT_MIN = 10;
const STATEMENT_MAX = 4000;

const LOCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_locks (
  user_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  report_id TEXT,
  created_at TEXT NOT NULL
);
`;

export const ACCOUNT_LOCKED_MESSAGE = 'Dieses Konto ist gesperrt.';

/** Gesperrte Konten; Schlüssel im Speicher (die Hooks prüfen jede Anfrage, ohne Sperren kostet das nichts). */
export class AccountLocks {
  private keys = new Set<string>();

  constructor(private readonly db: Db) {
    db.exec(LOCK_SCHEMA);
    this.reload();
  }

  private reload() {
    this.keys = new Set((this.db.prepare('SELECT user_key FROM account_locks').all() as unknown as { user_key: string }[]).map((r) => r.user_key));
  }

  get size() {
    return this.keys.size;
  }

  has(key: string) {
    return this.keys.has(key);
  }

  lock(key: string, reason: string, reportId: string | null = null) {
    this.db
      .prepare(
        `INSERT INTO account_locks (user_key, reason, report_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_key) DO UPDATE SET reason = excluded.reason, report_id = excluded.report_id, created_at = excluded.created_at`,
      )
      .run(key, reason, reportId, nowIso());
    // alle Sitzungen (Browser, Apps) weg
    this.db.prepare('DELETE FROM sessions WHERE user_key = ?').run(key);
    this.reload();
  }

  unlock(key: string): boolean {
    const n = this.db.prepare('DELETE FROM account_locks WHERE user_key = ?').run(key).changes;
    this.reload();
    return n > 0;
  }

  list(): { key: string; name: string | null; reason: string; reportId: string | null; at: string }[] {
    return (
      this.db
        .prepare('SELECT l.user_key, l.reason, l.report_id, l.created_at, u.name FROM account_locks l LEFT JOIN users u ON u.key = l.user_key ORDER BY l.created_at')
        .all() as unknown as { user_key: string; reason: string; report_id: string | null; created_at: string; name: string | null }[]
    ).map((r) => ({ key: r.user_key, name: r.name, reason: r.reason, reportId: r.report_id, at: r.created_at }));
  }
}

/**
 * An der Wurzel der App registrieren (vor den Routen): Anfragen mit Sitzung (Cookie, Bearer sts_) einer gesperrten
 * Person → Sitzung löschen, 403 `account_locked`; Antworten auf Anmeldungen (`/api/auth/…` mit `user`) für gesperrte
 * Konten → Sitzungen löschen, 403 statt Anmeldung (alle Wege: Passwort, QR, App-Sitzung, Modus local).
 */
export function registerAccountLockHooks(app: FastifyInstance, deps: { locks: AccountLocks; sessions: SessionStore; db: Db; contact: () => string }) {
  const { locks, sessions, db } = deps;
  const message = () => {
    const c = deps.contact();
    return c ? `${ACCOUNT_LOCKED_MESSAGE} Bei Fragen: ${c}` : ACCOUNT_LOCKED_MESSAGE;
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!locks.size || !req.url.startsWith('/api/') || req.url.startsWith('/api/admin/')) return;
    for (const token of [req.cookies?.[SESSION_COOKIE], appSessionToken(req.headers.authorization)]) {
      const s = token ? sessions.get(token) : null;
      if (s && locks.has(s.userKey)) {
        sessions.delete(token);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return sendError(reply, 403, 'account_locked', message());
      }
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (!locks.size || reply.statusCode !== 200 || typeof payload !== 'string' || !req.url.startsWith('/api/auth/') || !payload.includes('"user"')) return payload;
    let key: unknown;
    try {
      key = (JSON.parse(payload) as { user?: { key?: unknown } }).user?.key;
    } catch {
      return payload;
    }
    if (typeof key !== 'string' || !locks.has(key)) return payload;
    db.prepare('DELETE FROM sessions WHERE user_key = ?').run(key);
    reply.code(403).header('content-type', 'application/json; charset=utf-8');
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return JSON.stringify({ ok: false, error: 'account_locked', message: message() });
  });
}

/**
 * Modus org: Moderations-Sperre für REST-Routen mit Board-ID (im Modus local deckt registerAccessGuard das über
 * access.roleOf ab). Im Sitzungs-Scope registrieren.
 */
export function registerLockGuard(scope: FastifyInstance, access: BoardAccess) {
  if (access.local) return;
  scope.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions?.url ?? '';
    if (!route.startsWith('/api/boards/:id') && !route.startsWith('/api/native/v1/boards/:id')) return;
    const id = (req.params as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string' || !ID_RE.test(id) || !access.lockOf(id)) return;
    const role = access.connectRole({ key: req.session!.userKey, isOrga: req.session!.isOrga }, id);
    if (!role) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    if (ROLE_RANK[role] < ROLE_RANK[requiredRole(route, req.method)]) {
      return sendError(reply, 403, 'board_locked', 'Dieses Board wurde von der Moderation gesperrt und lässt sich nur ansehen.');
    }
  });
}

export interface ModerationSetup {
  db: Db;
  sessions: SessionStore;
  access: BoardAccess;
  hocuspocus: Hocuspocus<any>;
  /** Mailer der Instanz (wird in app.ts erst später angelegt) */
  mailer: () => Mailer;
  instance: InstanceConfig;
  appUrl: string;
  /** Mail-Adresse und Name einer Person (Modus local: Konto), sonst null */
  emailOf: (userKey: string) => string | null;
  /** Verbindungen einer Person trennen (Sync + Native), mit boardId nur dort */
  dropUser: (userKey: string, opts?: { boardId?: string }) => void;
  /** persönliche API-Tokens einer Person löschen (Konto-Sperre) */
  forgetTokens: (userKey: string) => void;
  /** Board in den Papierkorb und endgültig löschen (trash.ts) */
  deleteBoard: (boardId: string) => Promise<boolean>;
  log: (msg: string) => void;
}

interface ModerationDeps extends Omit<ModerationSetup, 'mailer'> {
  mailer: Mailer;
  reports: Reports;
  locks: AccountLocks;
}

/**
 * Alles zur Moderation an die App hängen (app.ts, an der Wurzel vor den Routen): Konto-Sperre (Hooks), Admin-API.
 * `routes(scope)` im Sitzungs-Scope: Melden, Blockieren, Moderations-Hinweis je Board, Sperr-Guard (Modus org).
 */
export async function setupModeration(app: FastifyInstance, setup: ModerationSetup) {
  const { db, access } = setup;
  const blocks = new Blocks(db);
  const reports = new Reports(db);
  const locks = new AccountLocks(db);
  const mailer: Mailer = {
    queue: (m: MailMessage) => setup.mailer().queue(m),
    send: (m: MailMessage) => setup.mailer().send(m),
    idle: () => setup.mailer().idle(),
  };
  const deps: ModerationDeps = { ...setup, mailer, reports, locks };
  registerAccountLockHooks(app, { locks, sessions: setup.sessions, db, contact: () => moderatorAddress(setup.instance) });
  await registerAdminApi(app, deps);
  return {
    blocks,
    reports,
    locks,
    routes(scope: FastifyInstance) {
      registerReports(scope, { ...deps, reports, mailer });
      registerBlockRoutes(scope, blocks);
      registerBoardModerationInfo(scope, access);
      registerLockGuard(scope, access);
    },
  };
}

/** `GET /api/boards/:id/moderation` – im Sitzungs-Scope (Zugriff prüft der Guard; hidden = 404). */
export function registerBoardModerationInfo(scope: FastifyInstance, access: BoardAccess) {
  scope.get<{ Params: { id: string } }>('/api/boards/:id/moderation', async (req, reply) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    const lock = access.lockOf(id);
    if (lock?.mode === 'hidden') return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    return { ok: true, lock: lock ? { mode: lock.mode, reason: lock.reason } : null };
  });
}

/** Admin-API (tools/admin.mts). Nur mit STACHEL_ADMIN_TOKEN (≥ 32 Zeichen), sonst gibt es sie nicht (404). */
async function registerAdminApi(app: FastifyInstance, deps: ModerationDeps) {
  const token = deps.instance.adminToken;
  if (token.length < MIN_ADMIN_TOKEN) {
    if (token) deps.log(`STACHEL_ADMIN_TOKEN ist kürzer als ${MIN_ADMIN_TOKEN} Zeichen – Admin-API aus`);
    return;
  }
  const want = crypto.createHash('sha256').update(token).digest();
  const failLimiter = new RateLimiter(20, 15 * 60_000);
  const { db, access, reports, locks } = deps;

  const boardRow = (id: string) =>
    ID_RE.test(id)
      ? ((db.prepare('SELECT id, title, created_by, created_by_name, deleted_at FROM boards WHERE id = ?').get(id) as
          | { id: string; title: string; created_by: string; created_by_name: string; deleted_at: string | null }
          | undefined) ?? null)
      : null;
  const nameOf = (key: string) => (db.prepare('SELECT name FROM users WHERE key = ?').get(key) as { name: string } | undefined)?.name ?? null;
  const readText = (v: unknown, min: number) => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= STATEMENT_MAX ? v.trim() : null);

  /** alle Verbindungen zu einem Board trennen (neue Rolle bzw. kein Zugriff gilt beim Wiederverbinden) */
  const dropBoard = (boardId: string) => {
    const keys = new Set<string>();
    for (const r of db.prepare('SELECT key FROM users').all() as unknown as { key: string }[]) keys.add(r.key);
    for (const r of db.prepare('SELECT DISTINCT user_key FROM sessions').all() as unknown as { user_key: string }[]) keys.add(r.user_key);
    for (const k of keys) deps.dropUser(k, { boardId });
  };

  const lockBoard = (boardId: string, mode: BoardLockMode, reason: string, reportId: string | null) => {
    access.setLock(boardId, mode, reason, reportId);
    dropBoard(boardId);
    deps.log(`Moderation: Board ${boardId} gesperrt (${mode})`);
  };

  const lockAccount = (key: string, reason: string, reportId: string | null) => {
    locks.lock(key, reason, reportId);
    deps.forgetTokens(key);
    deps.dropUser(key);
    deps.log(`Moderation: Konto ${key} gesperrt`);
  };

  /** Gemeldetes Objekt bzw. Kommentar aus dem Board-Dokument entfernen; false = nicht (mehr) da. */
  const removeContent = async (r: ReportRow): Promise<boolean> => {
    if (!r.object_id && !r.comment_id) return false;
    const conn = await deps.hocuspocus.openDirectConnection(boardDocName(r.board_id), { system: 'moderation' });
    let removed = false;
    try {
      await conn.transact((doc) => {
        if (r.object_id) {
          const objects = doc.getMap<unknown>(DOC_OBJECTS);
          if (objects.has(r.object_id)) {
            objects.delete(r.object_id);
            removed = true;
          }
          return;
        }
        const comments = doc.getMap<unknown>('collab.comments');
        const t = comments.get(r.comment_id!);
        const msgs = t instanceof Y.Map ? t.get('messages') : null;
        if (!(msgs instanceof Y.Array)) return;
        const list = msgs.toArray() as { id?: unknown }[];
        const i = r.message_id ? list.findIndex((m) => m?.id === r.message_id) : 0;
        if (i < 0) return;
        // erste Nachricht = der ganze Thread (wie „Thread löschen“ im Web)
        if (i === 0) comments.delete(r.comment_id!);
        else msgs.delete(i, 1);
        removed = true;
      });
    } finally {
      await conn.disconnect();
    }
    return removed;
  };

  /** Entscheidung an meldende und betroffene Person (DSA Art. 16 Abs. 5, Art. 17); was ging raus, wer hat keine Adresse */
  const notify = (r: ReportRow) => {
    const res = { reporter: false, affected: false, missing: [] as string[] };
    if (r.reporter_email) {
      deps.mailer.queue(reportMails.decisionReporter(deps, r.reporter_email, r));
      res.reporter = true;
    } else res.missing.push(`meldende Person ${r.reporter_name} (${r.reporter_key})`);
    if (r.decision && r.decision !== 'no_action' && r.affected_key) {
      const mail = deps.emailOf(r.affected_key);
      if (mail) {
        deps.mailer.queue(reportMails.decisionAffected(deps, mail, nameOf(r.affected_key) ?? r.target_name ?? '', r));
        res.affected = true;
      } else res.missing.push(`betroffene Person ${nameOf(r.affected_key) ?? ''} (${r.affected_key})`);
    }
    if (res.reporter || res.affected) reports.markNotified(r.id);
    return res;
  };

  await app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      const ip = ipKey(req.ip);
      if (failLimiter.blocked(ip)) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
      const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '');
      const got = crypto.createHash('sha256').update(m?.[1] ?? '').digest();
      if (!m || !crypto.timingSafeEqual(got, want)) {
        failLimiter.hit(ip);
        return sendError(reply, 401, 'not_logged_in', 'Admin-Token fehlt oder ist falsch.');
      }
    });

    admin.get<{ Querystring: { status?: string } }>('/api/admin/reports', async (req) => {
      const status = req.query.status === 'all' || req.query.status === 'closed' ? req.query.status : 'open';
      return { ok: true, reports: reports.list(status).map(reportJson) };
    });

    admin.get<{ Params: { id: string } }>('/api/admin/reports/:id', async (req, reply) => {
      const r = REPORT_ID_RE.test(req.params.id) ? reports.get(req.params.id) : null;
      if (!r) return sendError(reply, 404, 'not_found', 'Diese Meldung gibt es nicht.');
      const board = boardRow(r.board_id);
      return { ok: true, report: reportJson(r), board: board ? { id: board.id, title: board.title, deleted: !!board.deleted_at, lock: access.lockOf(board.id) } : null };
    });

    // Entscheiden: {decision, statement, ground?, affectedKey?, apply? = true, notify? = true}
    admin.post<{ Params: { id: string } }>('/api/admin/reports/:id/decision', async (req, reply) => {
      const r = REPORT_ID_RE.test(req.params.id) ? reports.get(req.params.id) : null;
      if (!r) return sendError(reply, 404, 'not_found', 'Diese Meldung gibt es nicht.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (!isDecision(b.decision)) return sendError(reply, 400, 'invalid_input', `decision: ${Object.keys(DECISION_LABEL).join(' | ')}`);
      const decision: Decision = b.decision;
      const statement = readText(b.statement, STATEMENT_MIN);
      if (!statement) return sendError(reply, 400, 'invalid_input', `statement: Begründung mit ${STATEMENT_MIN}–${STATEMENT_MAX} Zeichen (DSA Art. 17).`);
      const ground = typeof b.ground === 'string' && b.ground.trim() ? b.ground.trim().slice(0, 500) : null;
      const affectedKey = typeof b.affectedKey === 'string' && USER_KEY_RE.test(b.affectedKey) ? b.affectedKey : r.target_key;
      const apply = b.apply !== false;
      let applied = 'nichts (apply=false)';
      if (apply) {
        switch (decision) {
          case 'no_action':
            applied = 'keine Maßnahme';
            break;
          case 'content_removed':
            if (!r.object_id && !r.comment_id) return sendError(reply, 400, 'invalid_input', 'Die Meldung betrifft kein Objekt und keinen Kommentar.');
            if (!boardRow(r.board_id)) return sendError(reply, 404, 'not_found', 'Das Board gibt es nicht mehr.');
            applied = (await removeContent(r)) ? (r.object_id ? `Objekt ${r.object_id} entfernt` : 'Kommentar entfernt') : 'war schon entfernt';
            break;
          case 'board_readonly':
          case 'board_hidden':
            if (!boardRow(r.board_id)) return sendError(reply, 404, 'not_found', 'Das Board gibt es nicht mehr.');
            lockBoard(r.board_id, decision === 'board_readonly' ? 'readonly' : 'hidden', statement, r.id);
            applied = `Board ${r.board_id} gesperrt (${decision === 'board_readonly' ? 'nur ansehen' : 'ausgeblendet'})`;
            break;
          case 'board_deleted':
            applied = (await deps.deleteBoard(r.board_id)) ? `Board ${r.board_id} gelöscht` : 'Board war schon gelöscht';
            break;
          case 'account_locked':
            if (!affectedKey) return sendError(reply, 400, 'invalid_input', 'affectedKey: Wessen Konto? (die Meldung nennt keine Person)');
            lockAccount(affectedKey, statement, r.id);
            applied = `Konto ${affectedKey} gesperrt`;
            break;
        }
      }
      reports.decide(r.id, { decision, statement, ground, affectedKey: affectedKey ?? null });
      const after = reports.get(r.id)!;
      const notified = b.notify === false ? null : notify(after);
      deps.log(`Moderation: Meldung ${r.id} entschieden (${decision})`);
      return { ok: true, report: reportJson(reports.get(r.id)!), applied, notified };
    });

    admin.post<{ Params: { id: string } }>('/api/admin/reports/:id/notify', async (req, reply) => {
      const r = REPORT_ID_RE.test(req.params.id) ? reports.get(req.params.id) : null;
      if (!r) return sendError(reply, 404, 'not_found', 'Diese Meldung gibt es nicht.');
      if (!r.decision) return sendError(reply, 400, 'invalid_input', 'Die Meldung ist noch nicht entschieden.');
      return { ok: true, notified: notify(r) };
    });

    admin.post<{ Params: { id: string } }>('/api/admin/reports/:id/reopen', async (req, reply) => {
      const r = REPORT_ID_RE.test(req.params.id) ? reports.get(req.params.id) : null;
      if (!r) return sendError(reply, 404, 'not_found', 'Diese Meldung gibt es nicht.');
      reports.reopen(r.id);
      return { ok: true, report: reportJson(reports.get(r.id)!) };
    });

    admin.get<{ Params: { id: string } }>('/api/admin/boards/:id', async (req, reply) => {
      const board = boardRow(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      return {
        ok: true,
        board: { id: board.id, title: board.title, owner: { key: board.created_by, name: nameOf(board.created_by) ?? board.created_by_name }, deleted: !!board.deleted_at, lock: access.lockOf(board.id) },
        people: access.local ? access.people(board.id).map((p) => ({ key: p.key, name: p.name, role: p.role })) : [],
      };
    });

    // Board sperren: {mode: 'readonly'|'hidden', reason}
    admin.put<{ Params: { id: string } }>('/api/admin/boards/:id/lock', async (req, reply) => {
      const board = boardRow(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const b = (req.body ?? {}) as Record<string, unknown>;
      const mode = b.mode === 'hidden' ? 'hidden' : b.mode === 'readonly' ? 'readonly' : null;
      const reason = readText(b.reason, 3);
      if (!mode || !reason) return sendError(reply, 400, 'invalid_input', 'mode (readonly | hidden) und reason nötig.');
      lockBoard(board.id, mode, reason, null);
      return { ok: true, lock: access.lockOf(board.id) };
    });

    admin.delete<{ Params: { id: string } }>('/api/admin/boards/:id/lock', async (req, reply) => {
      const board = boardRow(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const had = access.clearLock(board.id);
      if (had) dropBoard(board.id);
      deps.log(`Moderation: Board ${board.id} entsperrt`);
      return { ok: true, unlocked: had };
    });

    admin.delete<{ Params: { id: string } }>('/api/admin/boards/:id', async (req, reply) => {
      if (!boardRow(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const done = await deps.deleteBoard(req.params.id);
      deps.log(`Moderation: Board ${req.params.id} gelöscht`);
      return { ok: true, deleted: done };
    });

    admin.put<{ Params: { key: string } }>('/api/admin/accounts/:key/lock', async (req, reply) => {
      const key = req.params.key;
      const reason = readText((req.body as { reason?: unknown } | null)?.reason, 3);
      if (!USER_KEY_RE.test(key) || !reason) return sendError(reply, 400, 'invalid_input', 'Schlüssel der Person und reason nötig.');
      lockAccount(key, reason, null);
      return { ok: true, locked: { key, name: nameOf(key) } };
    });

    admin.delete<{ Params: { key: string } }>('/api/admin/accounts/:key/lock', async (req, reply) => {
      if (!USER_KEY_RE.test(req.params.key)) return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
      const had = locks.unlock(req.params.key);
      deps.log(`Moderation: Konto ${req.params.key} entsperrt`);
      return { ok: true, unlocked: had };
    });

    admin.get('/api/admin/locks', async () => ({
      ok: true,
      boards: (db.prepare('SELECT l.board_id, l.mode, l.reason, l.report_id, l.created_at, b.title FROM board_locks l JOIN boards b ON b.id = l.board_id ORDER BY l.created_at').all() as unknown as {
        board_id: string;
        mode: string;
        reason: string;
        report_id: string | null;
        created_at: string;
        title: string;
      }[]).map((r) => ({ id: r.board_id, title: r.title, mode: r.mode, reason: r.reason, reportId: r.report_id, at: r.created_at })),
      accounts: locks.list(),
      reportEmail: moderatorAddress(deps.instance) || null,
    }));

    // Personen suchen (Name/Schlüssel), damit man Schlüssel für lock-account findet
    admin.get<{ Querystring: { q?: string } }>('/api/admin/people', async (req) => {
      const q = `%${(req.query.q ?? '').slice(0, 100)}%`;
      const rows = db.prepare('SELECT key, name, last_seen FROM users WHERE name LIKE ? OR key LIKE ? ORDER BY last_seen DESC LIMIT 50').all(q, q) as unknown as {
        key: string;
        name: string;
        last_seen: string;
      }[];
      return { ok: true, people: rows.map((r) => ({ key: r.key, name: r.name, lastSeen: r.last_seen, locked: locks.has(r.key) })) };
    });
  });
}
