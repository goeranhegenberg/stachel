// Melden von Inhalten, Boards und Personen (Google Play UGC, DSA Art. 16; docs/features/moderation.md).
// `POST /api/reports` legt eine Meldung in der Tabelle `reports` an – mit einem Beleg (Text des Objekts bzw. Kommentars
// zum Zeitpunkt der Meldung, weil Inhalte danach geändert oder gelöscht werden können) –, schickt sie per Mail an die
// Melde-Adresse der Instanz (STACHEL_REPORT_EMAIL) und eine Eingangsbestätigung an die meldende Person (Art. 16 Abs. 4,
// nur wenn eine Adresse bekannt ist, Modus local). Entscheiden, Sperren und Benachrichtigen (Art. 16 Abs. 5, Art. 17):
// moderation.ts (Admin-API) und tools/admin.mts.
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import {
  REPORTS_PATH,
  REPORT_REASON_LABEL,
  REPORT_TEXT_MAX,
  REPORT_TEXT_MIN,
  REPORT_TEXT_REQUIRED,
  isReportReason,
  type ReportCreated,
  type ReportReason,
} from '../../shared/moderation.js';
import { DOC_OBJECTS } from '../../shared/protocol.js';
import type { BoardAccess } from './access.js';
import { boardState } from './board-copies.js';
import { USER_KEY_RE } from './blocks.js';
import { nowIso, type Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import { defang, renderMail, type MailContext } from './mail-templates.js';
import { isEmail, parseFrom, type MailMessage, type Mailer } from './mailer.js';
import { ipKey, RateLimiter } from './rate-limit.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,             -- R-XXXXXXXX
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,            -- open | closed
  reporter_key TEXT NOT NULL,
  reporter_name TEXT NOT NULL,
  reporter_email TEXT,             -- für Eingangsbestätigung und Entscheidung (Modus local)
  board_id TEXT NOT NULL,
  board_title TEXT NOT NULL,
  object_id TEXT,
  comment_id TEXT,
  message_id TEXT,
  target_key TEXT,                 -- betroffene Person (gemeldete Person, Autor:in des Kommentars, Besitzer:in des Boards)
  target_name TEXT,
  reason TEXT NOT NULL,
  text TEXT NOT NULL,
  evidence TEXT NOT NULL,          -- JSON: Beleg zum Zeitpunkt der Meldung
  decided_at TEXT,
  decision TEXT,                   -- s. DECISIONS
  statement TEXT,                  -- Begründung (DSA Art. 17 Abs. 3)
  ground TEXT,                     -- Rechtsgrundlage bzw. Regel der Nutzungsbedingungen
  affected_key TEXT,               -- wen die Maßnahme trifft (Standard target_key)
  notified_at TEXT
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);
`;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SNIPPET = 500;
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DECISIONS = ['no_action', 'content_removed', 'board_readonly', 'board_hidden', 'board_deleted', 'account_locked'] as const;
export type Decision = (typeof DECISIONS)[number];
export const isDecision = (v: unknown): v is Decision => typeof v === 'string' && (DECISIONS as readonly string[]).includes(v);

/** Maßnahme in Worten (Mails, CLI) */
export const DECISION_LABEL: Record<Decision, string> = {
  no_action: 'Kein Verstoß festgestellt – keine Maßnahme',
  content_removed: 'Inhalt entfernt',
  board_readonly: 'Board gesperrt: kann nur noch angesehen werden',
  board_hidden: 'Board gesperrt: für alle ausgeblendet',
  board_deleted: 'Board gelöscht',
  account_locked: 'Konto gesperrt',
};

export interface Evidence {
  object?: { id: string; type: string; text: string; imageId?: string };
  comment?: { threadId: string; messages: { id: string; by: string; name: string; text: string; at: string }[] };
  person?: { key: string; name: string };
}

export interface ReportRow {
  id: string;
  created_at: string;
  status: 'open' | 'closed';
  reporter_key: string;
  reporter_name: string;
  reporter_email: string | null;
  board_id: string;
  board_title: string;
  object_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  target_key: string | null;
  target_name: string | null;
  reason: ReportReason;
  text: string;
  evidence: string;
  decided_at: string | null;
  decision: Decision | null;
  statement: string | null;
  ground: string | null;
  affected_key: string | null;
  notified_at: string | null;
}

/** Meldung für die Admin-API (tools/admin.mts) */
export function reportJson(r: ReportRow) {
  let evidence: Evidence = {};
  try {
    evidence = JSON.parse(r.evidence) as Evidence;
  } catch {
    // alter/kaputter Beleg
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    reporter: { key: r.reporter_key, name: r.reporter_name, email: r.reporter_email },
    board: { id: r.board_id, title: r.board_title },
    objectId: r.object_id,
    commentId: r.comment_id,
    messageId: r.message_id,
    target: r.target_key ? { key: r.target_key, name: r.target_name } : null,
    reason: r.reason,
    reasonLabel: REPORT_REASON_LABEL[r.reason] ?? r.reason,
    text: r.text,
    evidence,
    decision: r.decision ? { decision: r.decision, label: DECISION_LABEL[r.decision], statement: r.statement, ground: r.ground, affectedKey: r.affected_key, at: r.decided_at, notifiedAt: r.notified_at } : null,
  };
}

const newId = () => `R-${Array.from(crypto.randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
const snippet = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s);

/** Klartext eines Objekts (Notiz, Text, Form, Karte …): `text` bzw. Rich-Text `content` ohne Auszeichnung */
function plainText(o: Y.Map<unknown>): string {
  const parts: string[] = [];
  for (const f of ['title', 'text', 'label']) {
    const v = o.get(f);
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  const c = o.get('content');
  if (c instanceof Y.XmlFragment || c instanceof Y.XmlElement) parts.push(c.toString().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  else if (c instanceof Y.Text) parts.push(c.toString());
  return parts.filter(Boolean).join(' · ');
}

export class Reports {
  constructor(private readonly db: Db) {
    db.exec(SCHEMA);
  }

  insert(r: Omit<ReportRow, 'decided_at' | 'decision' | 'statement' | 'ground' | 'affected_key' | 'notified_at'>) {
    this.db
      .prepare(
        `INSERT INTO reports (id, created_at, status, reporter_key, reporter_name, reporter_email, board_id, board_title, object_id,
           comment_id, message_id, target_key, target_name, reason, text, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.created_at,
        r.status,
        r.reporter_key,
        r.reporter_name,
        r.reporter_email,
        r.board_id,
        r.board_title,
        r.object_id,
        r.comment_id,
        r.message_id,
        r.target_key,
        r.target_name,
        r.reason,
        r.text,
        r.evidence,
      );
  }

  get(id: string): ReportRow | null {
    return (this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined) ?? null;
  }

  list(status: 'open' | 'closed' | 'all', limit = 200): ReportRow[] {
    const sql = status === 'all' ? 'SELECT * FROM reports ORDER BY created_at DESC LIMIT ?' : 'SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT ?';
    return (status === 'all' ? this.db.prepare(sql).all(limit) : this.db.prepare(sql).all(status, limit)) as unknown as ReportRow[];
  }

  decide(id: string, d: { decision: Decision; statement: string; ground: string | null; affectedKey: string | null }) {
    this.db
      .prepare('UPDATE reports SET status = ?, decided_at = ?, decision = ?, statement = ?, ground = ?, affected_key = ? WHERE id = ?')
      .run('closed', nowIso(), d.decision, d.statement, d.ground, d.affectedKey, id);
  }

  reopen(id: string) {
    this.db.prepare("UPDATE reports SET status = 'open' WHERE id = ?").run(id);
  }

  markNotified(id: string) {
    this.db.prepare('UPDATE reports SET notified_at = ? WHERE id = ?').run(nowIso(), id);
  }

  /** Konto gelöscht: Adresse der meldenden Person entfernen (der Beleg bleibt für Nachweis/Beschwerde). */
  forgetUser(userKey: string) {
    this.db.prepare('UPDATE reports SET reporter_email = NULL WHERE reporter_key = ?').run(userKey);
  }
}

// ---- Mails ----------------------------------------------------------------------------------------------------------

export interface ReportMailDeps {
  instance: InstanceConfig;
  /** öffentliche Adresse der Web-App (PUBLIC_URL + STACHEL_BASE_PATH) */
  appUrl: string;
}

const ctxOf = (d: ReportMailDeps): MailContext => ({ brand: d.instance.brand, publicUrl: d.appUrl, imprintUrl: d.instance.imprintUrl, privacyUrl: d.instance.privacyUrl });

/** Melde-Adresse der Instanz: STACHEL_REPORT_EMAIL, sonst die Absenderadresse (STACHEL_SMTP_FROM bzw. -USER); '' = keine. */
export function moderatorAddress(instance: InstanceConfig): string {
  const a = instance.reportEmail || parseFrom(instance.smtp.from || instance.smtp.user).address;
  return isEmail(a) ? a : '';
}

const boardLink = (d: ReportMailDeps, r: ReportRow) => `${d.appUrl}/b/${r.board_id}${r.object_id ? `?o=${encodeURIComponent(r.object_id)}` : ''}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

/** Was gemeldet wurde, in Worten (Eingangsbestätigung) */
function whatLine(r: ReportRow): string {
  const board = `„${defang(r.board_title)}“`;
  if (r.object_id) return `einen Inhalt auf dem Board ${board}`;
  if (r.comment_id) return `einen Kommentar auf dem Board ${board}`;
  if (r.evidence.includes('"person"') && r.target_name) return `eine Person (${defang(r.target_name)}) auf dem Board ${board}`;
  return `das Board ${board}`;
}

export const reportMails = {
  /** An die Melde-Adresse der Instanz: alles, was zum Prüfen nötig ist */
  moderator(d: ReportMailDeps, to: string, r: ReportRow): MailMessage {
    const ev = JSON.parse(r.evidence) as Evidence;
    const lines = [
      `Meldung ${r.id} vom ${fmtDate(r.created_at)}`,
      `Grund: ${REPORT_REASON_LABEL[r.reason]}`,
      `Begründung der meldenden Person: ${r.text || '(keine)'}`,
      `Board: „${defang(r.board_title)}“ (${r.board_id})`,
      ...(ev.object ? [`Objekt ${ev.object.id} (${ev.object.type}): ${defang(ev.object.text || '(ohne Text)')}${ev.object.imageId ? ` · Bild ${ev.object.imageId}` : ''}`] : []),
      ...(ev.comment ? ev.comment.messages.map((m) => `Kommentar von ${defang(m.name)} (${m.by}), ${fmtDate(m.at)}: ${defang(m.text)}`) : []),
      ...(r.target_key ? [`Betroffene Person: ${defang(r.target_name ?? '')} (${r.target_key})`] : []),
      `Meldende Person: ${defang(r.reporter_name)} (${r.reporter_key})${r.reporter_email ? `, ${r.reporter_email}` : ', keine Mail-Adresse bekannt'}`,
      `Ansehen und entscheiden: npx tsx tools/admin.mts report ${r.id} (Anleitung: docs/ops/moderation.md)`,
    ];
    return renderMail(ctxOf(d), to, `${d.instance.brand}: Neue Meldung ${r.id} (${REPORT_REASON_LABEL[r.reason]})`, {
      greeting: 'Hallo,',
      paragraphs: [`es gibt eine neue Meldung (DSA Art. 16). Bitte zeitnah prüfen und entscheiden.`, ...lines],
      button: { label: 'Board öffnen', url: boardLink(d, r) },
    });
  },

  /** Eingangsbestätigung an die meldende Person (DSA Art. 16 Abs. 4) */
  received(d: ReportMailDeps, to: string, r: ReportRow): MailMessage {
    return renderMail(ctxOf(d), to, `${d.instance.brand}: Deine Meldung ${r.id} ist eingegangen`, {
      greeting: `Hallo ${defang(r.reporter_name)},`,
      paragraphs: [
        `danke für deine Meldung. Wir haben sie am ${fmtDate(r.created_at)} erhalten (Nummer ${r.id}). Gemeldet hast du ${whatLine(r)}, Grund: ${REPORT_REASON_LABEL[r.reason]}.`,
        'Ein Mensch prüft die Meldung; automatisierte Entscheidungen setzen wir dabei nicht ein. Über das Ergebnis und die Gründe informieren wir dich per Mail.',
      ],
      after: ['Bitte antworte nicht auf diese Mail. Wenn du etwas ergänzen möchtest, melde den Inhalt einfach noch einmal mit der Ergänzung im Text.'],
    });
  },

  /** Entscheidung an die meldende Person (DSA Art. 16 Abs. 5) */
  decisionReporter(d: ReportMailDeps, to: string, r: ReportRow): MailMessage {
    const decision = r.decision ?? 'no_action';
    return renderMail(ctxOf(d), to, `${d.instance.brand}: Entscheidung zu deiner Meldung ${r.id}`, {
      greeting: `Hallo ${defang(r.reporter_name)},`,
      paragraphs: [
        `wir haben deine Meldung ${r.id} vom ${fmtDate(r.created_at)} geprüft (Board „${defang(r.board_title)}“, Grund: ${REPORT_REASON_LABEL[r.reason]}).`,
        `Entscheidung: ${DECISION_LABEL[decision]}.`,
        `Begründung: ${r.statement ?? ''}`,
        'Die Entscheidung hat ein Mensch getroffen; automatisierte Mittel haben wir dabei nicht eingesetzt.',
      ],
      after: [redress(d)],
    });
  },

  /** Begründung an die betroffene Person (DSA Art. 17 Abs. 3) */
  decisionAffected(d: ReportMailDeps, to: string, name: string, r: ReportRow): MailMessage {
    const decision = r.decision ?? 'no_action';
    const scope =
      decision === 'content_removed'
        ? r.object_id
          ? `ein Inhalt (Objekt) auf dem Board „${defang(r.board_title)}“ wurde entfernt.`
          : `ein Kommentar auf dem Board „${defang(r.board_title)}“ wurde entfernt.`
        : decision === 'board_readonly'
          ? `das Board „${defang(r.board_title)}“ kann bis auf Weiteres nur noch angesehen werden.`
          : decision === 'board_hidden'
            ? `das Board „${defang(r.board_title)}“ ist bis auf Weiteres für alle ausgeblendet.`
            : decision === 'board_deleted'
              ? `das Board „${defang(r.board_title)}“ wurde gelöscht.`
              : `dein Konto ist bis auf Weiteres gesperrt.`;
    return renderMail(ctxOf(d), to, `${d.instance.brand}: Maßnahme wegen einer Meldung (${r.id})`, {
      greeting: `Hallo ${defang(name)},`,
      paragraphs: [
        `wir müssen dich über eine Maßnahme informieren: ${scope}`,
        `Anlass: eine Meldung vom ${fmtDate(r.created_at)} (Nummer ${r.id}, Grund: ${REPORT_REASON_LABEL[r.reason]}).`,
        `Begründung: ${r.statement ?? ''}`,
        `Grundlage: ${r.ground || 'unsere Nutzungsbedingungen'}.`,
        'Die Entscheidung hat ein Mensch getroffen; automatisierte Mittel haben wir dabei nicht eingesetzt.',
      ],
      after: [redress(d)],
    });
  },
};

function redress(d: ReportMailDeps): string {
  const contact = moderatorAddress(d.instance);
  return (
    `Du kannst dich innerhalb von sechs Monaten gegen diese Entscheidung beschweren${contact ? ` – per Mail an ${contact} mit der Nummer der Meldung` : ''}; ` +
    'wir prüfen sie dann erneut. Außerdem kannst du dich an eine zertifizierte außergerichtliche Streitbeilegungsstelle (Art. 21 DSA) oder an ein Gericht wenden.'
  );
}

// ---- Beleg aus dem Board-Dokument -------------------------------------------------------------------------------------

export interface EvidenceResult {
  evidence: Evidence;
  /** betroffene Person, wenn ermittelbar */
  target: { key: string; name: string } | null;
  missing?: 'object' | 'comment' | 'message';
}

/** Objekt bzw. Kommentar im aktuellen Board-Stand nachschlagen und als Beleg festhalten. */
export function collectEvidence(state: Uint8Array | null, input: { objectId?: string; commentId?: string; messageId?: string }): EvidenceResult {
  const doc = new Y.Doc();
  try {
    if (state) Y.applyUpdate(doc, state);
    const evidence: Evidence = {};
    let target: EvidenceResult['target'] = null;
    if (input.objectId) {
      const o = doc.getMap<unknown>(DOC_OBJECTS).get(input.objectId);
      if (!(o instanceof Y.Map)) return { evidence, target, missing: 'object' };
      const imageId = o.get('imageId');
      evidence.object = { id: input.objectId, type: String(o.get('type') ?? '?'), text: snippet(plainText(o)), ...(typeof imageId === 'string' ? { imageId } : {}) };
    }
    if (input.commentId) {
      const t = doc.getMap<unknown>('collab.comments').get(input.commentId);
      const msgs = t instanceof Y.Map ? t.get('messages') : null;
      if (!(msgs instanceof Y.Array)) return { evidence, target, missing: 'comment' };
      const all = (msgs.toArray() as unknown[]).filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string');
      const picked = input.messageId ? all.filter((m) => m.id === input.messageId) : all.slice(0, 5);
      if (!picked.length) return { evidence, target, missing: 'message' };
      const messages = picked.map((m) => ({
        id: String(m.id),
        by: typeof m.by === 'string' ? m.by : '',
        name: typeof m.name === 'string' ? m.name : '',
        text: snippet(typeof m.text === 'string' ? m.text : ''),
        at: typeof m.at === 'string' ? m.at : '',
      }));
      evidence.comment = { threadId: input.commentId, messages };
      if (messages[0]!.by) target = { key: messages[0]!.by, name: messages[0]!.name };
    }
    return { evidence, target };
  } finally {
    doc.destroy();
  }
}

// ---- Route ------------------------------------------------------------------------------------------------------------

export interface ReportRouteDeps extends ReportMailDeps {
  db: Db;
  reports: Reports;
  access: BoardAccess;
  hocuspocus: Hocuspocus<any>;
  mailer: Mailer;
  /** Mail-Adresse einer Person (Modus local: Konto), sonst null */
  emailOf: (userKey: string) => string | null;
  log: (msg: string) => void;
}

/** `POST /api/reports` – im Sitzungs-Scope registrieren. */
export function registerReports(scope: FastifyInstance, deps: ReportRouteDeps) {
  const { db, reports, access, mailer } = deps;
  // je Person 10, je IP 30 Meldungen pro Stunde (gegen Fluten der Melde-Adresse)
  const userLimiter = new RateLimiter(10, 3600_000);
  const ipLimiter = new RateLimiter(30, 3600_000);
  const timer = setInterval(() => {
    userLimiter.prune();
    ipLimiter.prune();
  }, 60_000);
  timer.unref();
  scope.addHook('onClose', async () => clearInterval(timer));

  const nameOf = (key: string) => (db.prepare('SELECT name FROM users WHERE key = ?').get(key) as { name: string } | undefined)?.name ?? null;
  const optId = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : typeof v === 'string' && ID_RE.test(v) ? v : null);

  scope.post(REPORTS_PATH, async (req, reply) => {
    const s = req.session!;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const boardId = typeof b.boardId === 'string' && ID_RE.test(b.boardId) ? b.boardId : null;
    const objectId = optId(b.objectId);
    const commentId = optId(b.commentId);
    const messageId = optId(b.messageId);
    const userKey = b.userKey === undefined || b.userKey === null || b.userKey === '' ? undefined : typeof b.userKey === 'string' && USER_KEY_RE.test(b.userKey) ? b.userKey : null;
    if (!boardId || objectId === null || commentId === null || messageId === null || userKey === null || (messageId && !commentId)) {
      return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
    }
    if (!isReportReason(b.reason)) return sendError(reply, 400, 'invalid_input', 'Bitte einen Grund wählen.');
    const reason = b.reason;
    if (b.text !== undefined && typeof b.text !== 'string') return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
    const text = (typeof b.text === 'string' ? b.text : '').replace(/\r\n?/g, '\n').trim();
    if (text.length > REPORT_TEXT_MAX) return sendError(reply, 400, 'invalid_input', `Die Begründung darf höchstens ${REPORT_TEXT_MAX} Zeichen haben.`);
    if (REPORT_TEXT_REQUIRED.includes(reason) && text.length < REPORT_TEXT_MIN) {
      return sendError(reply, 400, 'text_required', 'Bitte beschreibe kurz, was nicht in Ordnung ist (mindestens 10 Zeichen).');
    }
    if (userKey === s.userKey) return sendError(reply, 400, 'invalid_input', 'Dich selbst kannst du nicht melden.');
    // nur, was man auch sehen kann
    const board = db.prepare('SELECT id, title, created_by, created_by_name FROM boards WHERE id = ? AND deleted_at IS NULL').get(boardId) as
      | { id: string; title: string; created_by: string; created_by_name: string }
      | undefined;
    if (!board || !access.roleOf({ key: s.userKey, isOrga: s.isOrga }, boardId)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    if (!userLimiter.allow(s.userKey) || !ipLimiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);

    const found = objectId || commentId ? collectEvidence(boardState(db, deps.hocuspocus, boardId), { objectId, commentId, messageId }) : { evidence: {} as Evidence, target: null };
    if (found.missing) return sendError(reply, 404, 'not_found', found.missing === 'object' ? 'Dieses Objekt gibt es nicht (mehr).' : 'Diesen Kommentar gibt es nicht (mehr).');
    let target = found.target;
    if (userKey) {
      const name = nameOf(userKey);
      if (!name) return sendError(reply, 404, 'not_found', 'Diese Person kennt Stachel nicht.');
      target = { key: userKey, name };
      found.evidence.person = target;
    } else if (!objectId && !commentId) {
      // Board gemeldet: betroffen ist die Besitzerin bzw. der Besitzer
      target = { key: board.created_by, name: nameOf(board.created_by) ?? board.created_by_name };
    }

    const row: ReportRow = {
      id: newId(),
      created_at: nowIso(),
      status: 'open',
      reporter_key: s.userKey,
      reporter_name: s.name,
      reporter_email: deps.emailOf(s.userKey),
      board_id: boardId,
      board_title: board.title,
      object_id: objectId ?? null,
      comment_id: commentId ?? null,
      message_id: messageId ?? null,
      target_key: target?.key ?? null,
      target_name: target?.name ?? null,
      reason,
      text,
      evidence: JSON.stringify(found.evidence),
      decided_at: null,
      decision: null,
      statement: null,
      ground: null,
      affected_key: null,
      notified_at: null,
    };
    reports.insert(row);
    deps.log(`Meldung ${row.id} (${reason}) zu Board ${boardId}`);
    const mod = moderatorAddress(deps.instance);
    if (mod) mailer.queue(reportMails.moderator(deps, mod, row));
    else deps.log(`Meldung ${row.id}: keine Melde-Adresse (STACHEL_REPORT_EMAIL) – nur in der Datenbank`);
    const mailed = !!row.reporter_email;
    if (row.reporter_email) mailer.queue(reportMails.received(deps, row.reporter_email, row));
    const res: ReportCreated = { ok: true, report: { id: row.id, createdAt: row.created_at }, mailed };
    return reply.code(201).send(res);
  });
}
