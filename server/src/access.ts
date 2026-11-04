// Board-Rechte (docs/contract.md §6, docs/features/accounts.md). EINE zentrale Prüfung für alle Zugriffswege:
// REST (preHandler `registerAccessGuard`), Bilder/Dateien, Vorschaubilder, SSE-Übersicht, Hocuspocus (sync.ts) und
// spätere Wege wie persönliche API-Tokens (MCP-Server): `access.canAccessBoard(user, boardId, need)`.
//
// Modus org: alle angemeldeten Team-Mitglieder dürfen alles (wie bisher), der Guard tut nichts.
// Modus local: Besitzer:in = boards.created_by; weitere Personen über board_members (Rolle), Einladungen per E-Mail
// (board_invites, werden nach der E-Mail-Bestätigung zu Mitgliedschaften) und den Freigabelink (board_links: jede
// angemeldete Person mit dem Link; wer ihn benutzt hat, steht in board_link_visits und sieht das Board unter „Mit mir
// geteilt“, solange der Link an ist).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as Y from 'yjs';
import type { BoardInfo } from '../../shared/protocol.js';
import type { BoardLockMode } from '../../shared/moderation.js';
import type { BoardEvent } from './board-events.js';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';

export type BoardRole = 'owner' | 'edit' | 'comment' | 'view';
/** Rollen, die man anderen geben kann (Besitz wird übertragen, nicht vergeben). */
export type ShareRole = Exclude<BoardRole, 'owner'>;
export const SHARE_ROLES: readonly ShareRole[] = ['edit', 'comment', 'view'];
export const ROLE_RANK: Record<BoardRole, number> = { view: 1, comment: 2, edit: 3, owner: 4 };
export const ROLE_LABEL: Record<BoardRole, string> = { owner: 'Besitzer:in', edit: 'kann bearbeiten', comment: 'kann kommentieren', view: 'kann ansehen' };

export const isShareRole = (v: unknown): v is ShareRole => typeof v === 'string' && (SHARE_ROLES as readonly string[]).includes(v);

/** Wer fragt: user_key der Sitzung (bzw. des API-Tokens); isOrga zählt nur im Modus org. */
export interface AccessUser {
  key: string;
  isOrga?: boolean;
}

/**
 * Yjs-Strukturen, die die Rolle „kommentieren“ ändern darf: Kommentare, Gelesen-Stand der Erwähnungen
 * (docs/features/collab.md) und die Namensliste, in die sich jede:r beim Öffnen einträgt (structure.people). Wichtig:
 * Verwirft der Server ein Update, hängen alle späteren Updates desselben Clients daran (Yjs-Uhr) – deshalb müssen die
 * Schreibvorgänge, die der Client von selbst macht, hier erlaubt sein.
 */
export const COMMENT_ROOTS: ReadonlySet<string> = new Set(['collab.comments', 'collab.reads', 'structure.people']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS board_members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  role TEXT NOT NULL,             -- edit | comment | view
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_key)
);
CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_key);
CREATE TABLE IF NOT EXISTS board_invites (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  email TEXT NOT NULL,            -- klein geschrieben
  role TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (board_id, email)
);
CREATE INDEX IF NOT EXISTS board_invites_email ON board_invites(email);
CREATE TABLE IF NOT EXISTS board_links (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  role TEXT NOT NULL,             -- edit | comment | view
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS board_link_visits (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  first_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_key)
);
CREATE INDEX IF NOT EXISTS board_link_visits_user ON board_link_visits(user_key);
-- nicht mehr benutzt (früher Treffer der Bild-Suche über alle Boards, UPL-1; image-binding.ts leert sie einmal)
CREATE TABLE IF NOT EXISTS image_access (
  image_id TEXT NOT NULL,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, board_id)
);
`;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const best = (a: BoardRole | null, b: BoardRole | null): BoardRole | null => (!a ? b : !b ? a : ROLE_RANK[a] >= ROLE_RANK[b] ? a : b);

/** Moderations-Sperre (moderation.ts, tools/admin.mts): readonly = alle nur ansehen, hidden = für alle ausgeblendet. */
const LOCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS board_locks (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,             -- readonly | hidden
  reason TEXT NOT NULL,
  report_id TEXT,
  created_at TEXT NOT NULL
);
`;

export interface Person {
  key: string;
  name: string;
}

export class BoardAccess {
  readonly local: boolean;

  constructor(
    private readonly db: Db,
    mode: 'org' | 'local',
  ) {
    this.local = mode === 'local';
    db.exec(SCHEMA);
    db.exec(LOCK_SCHEMA);
  }

  /**
   * Rolle einer Person auf einem Board, null = kein Zugriff (oder Board unbekannt). Boards im Papierkorb: nur die
   * Besitzer:in (Modus local); mit `ignoreTrash` zählt die Rolle von davor (für Meldungen „in den Papierkorb“).
   */
  roleOf(user: AccessUser | null | undefined, boardId: string, opts: { ignoreTrash?: boolean } = {}): BoardRole | null {
    if (!user?.key || !ID_RE.test(boardId)) return null;
    const row = this.db.prepare('SELECT created_by, deleted_at FROM boards WHERE id = ?').get(boardId) as { created_by: string; deleted_at?: string | null } | undefined;
    if (!row) return null;
    if (!this.local) return this.clampLock(row.created_by === user.key || user.isOrga ? 'owner' : 'edit', boardId);
    if (row.created_by === user.key) return this.clampLock('owner', boardId);
    if (row.deleted_at && !opts.ignoreTrash) return null;
    return this.clampLock(best(this.memberRole(user.key, boardId), this.linkRoleFor(user.key, boardId, false)), boardId);
  }

  /**
   * Rolle für Sync und Native-API (sync.ts, native/gateway.ts): Modus local wie `roleOf`, Modus org `edit` – beide
   * mit Moderations-Sperre (readonly → `view`, hidden → kein Zugriff).
   */
  connectRole(user: AccessUser, boardId: string): BoardRole | null {
    return this.local ? this.roleOf(user, boardId) : this.clampLock('edit', boardId);
  }

  // ---- Moderations-Sperre (moderation.ts, tools/admin.mts) --------------------------------------------------------

  lockOf(boardId: string): { mode: BoardLockMode; reason: string; reportId: string | null; at: string } | null {
    const r = this.db.prepare('SELECT mode, reason, report_id, created_at FROM board_locks WHERE board_id = ?').get(boardId) as
      | { mode: string; reason: string; report_id: string | null; created_at: string }
      | undefined;
    if (!r || (r.mode !== 'readonly' && r.mode !== 'hidden')) return null;
    return { mode: r.mode, reason: r.reason, reportId: r.report_id, at: r.created_at };
  }

  setLock(boardId: string, mode: BoardLockMode, reason: string, reportId: string | null = null) {
    this.db
      .prepare(
        `INSERT INTO board_locks (board_id, mode, reason, report_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET mode = excluded.mode, reason = excluded.reason, report_id = excluded.report_id, created_at = excluded.created_at`,
      )
      .run(boardId, mode, reason, reportId, nowIso());
  }

  clearLock(boardId: string): boolean {
    return this.db.prepare('DELETE FROM board_locks WHERE board_id = ?').run(boardId).changes > 0;
  }

  /** Rolle unter einer Moderations-Sperre: readonly → höchstens `view`, hidden → null. */
  private clampLock(role: BoardRole | null, boardId: string): BoardRole | null {
    if (!role) return null;
    const lock = this.lockOf(boardId);
    if (!lock) return role;
    return lock.mode === 'hidden' ? null : 'view';
  }

  /** DIE Prüfung für alle Zugriffswege: hat `user` auf `boardId` mindestens die Rolle `need`? */
  canAccessBoard(user: AccessUser | null | undefined, boardId: string, need: BoardRole): boolean {
    const role = this.roleOf(user, boardId);
    return !!role && ROLE_RANK[role] >= ROLE_RANK[need];
  }

  /** So behandelt der Sync-Server eine Verbindung mit dieser Rolle. */
  yjsMode(role: BoardRole): { readOnly: boolean; commentOnly: boolean } {
    return { readOnly: role === 'view' || role === 'comment', commentOnly: role === 'comment' };
  }

  private memberRole(userKey: string, boardId: string): ShareRole | null {
    const m = this.db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_key = ?').get(boardId, userKey) as { role: string } | undefined;
    return m && isShareRole(m.role) ? m.role : null;
  }

  linkRole(boardId: string): ShareRole | null {
    const l = this.db.prepare('SELECT role FROM board_links WHERE board_id = ?').get(boardId) as { role: string } | undefined;
    return l && isShareRole(l.role) ? l.role : null;
  }

  /** Rolle über den Freigabelink; `record` merkt die Person für „Mit mir geteilt“. */
  private linkRoleFor(userKey: string, boardId: string, record: boolean): ShareRole | null {
    const role = this.linkRole(boardId);
    if (role && record) {
      this.db.prepare('INSERT OR IGNORE INTO board_link_visits (board_id, user_key, first_at) VALUES (?, ?, ?)').run(boardId, userKey, nowIso());
    }
    return role;
  }

  /** Board über den Link geöffnet (Editor, Übersicht mit ?open=): Person merken, falls sie nur per Link Zugriff hat. */
  noteOpen(user: AccessUser, boardId: string) {
    if (!this.local || !ID_RE.test(boardId)) return;
    const role = this.roleOf(user, boardId);
    if (role && role !== 'owner' && !this.memberRole(user.key, boardId)) this.linkRoleFor(user.key, boardId, true);
  }

  /** Board-Liste der Person (Modus local: nur mit Zugriff) samt `role`. */
  visibleBoards<T extends { id: string; created_by: string }>(user: AccessUser, rows: readonly T[]): (T & { role: BoardRole })[] {
    // Moderations-Sperre: hidden fehlt in der Liste, readonly nur ansehen
    const locks = new Map((this.db.prepare('SELECT board_id, mode FROM board_locks').all() as unknown as { board_id: string; mode: string }[]).map((r) => [r.board_id, r.mode]));
    const clamp = (id: string, role: BoardRole | null): BoardRole | null => (!role || !locks.has(id) ? role : locks.get(id) === 'readonly' ? 'view' : null);
    if (!this.local) {
      return rows.flatMap((r) => {
        const role = clamp(r.id, r.created_by === user.key || user.isOrga ? 'owner' : 'edit');
        return role ? [{ ...r, role }] : [];
      });
    }
    const members = new Map(
      (this.db.prepare('SELECT board_id, role FROM board_members WHERE user_key = ?').all(user.key) as unknown as { board_id: string; role: string }[]).map((r) => [
        r.board_id,
        r.role,
      ]),
    );
    const links = new Map(
      (
        this.db
          .prepare('SELECT v.board_id, l.role FROM board_link_visits v JOIN board_links l ON l.board_id = v.board_id WHERE v.user_key = ?')
          .all(user.key) as unknown as { board_id: string; role: string }[]
      ).map((r) => [r.board_id, r.role]),
    );
    const out: (T & { role: BoardRole })[] = [];
    for (const r of rows) {
      const m = members.get(r.id);
      const l = links.get(r.id);
      const role = clamp(r.id, r.created_by === user.key ? 'owner' : best(isShareRole(m) ? m : null, isShareRole(l) ? l : null));
      if (role) out.push({ ...r, role });
    }
    return out;
  }

  /** BoardInfo-Liste um `role` ergänzen (nur Modus local, sonst unverändert). */
  decorate(user: AccessUser, boards: BoardInfo[]): BoardInfo[] {
    if (!this.local) return boards;
    return boards.map((b) => ({ ...b, role: this.roleOf(user, b.id) ?? undefined }));
  }

  /** Alle Personen mit Zugriff auf das Board (Besitzer:in, Mitglieder, per Link Beigetretene bei aktivem Link). */
  people(boardId: string): (Person & { role: BoardRole; via: 'owner' | 'member' | 'link' })[] {
    const board = this.db.prepare('SELECT created_by, created_by_name FROM boards WHERE id = ?').get(boardId) as { created_by: string; created_by_name: string } | undefined;
    if (!board) return [];
    const out = new Map<string, Person & { role: BoardRole; via: 'owner' | 'member' | 'link' }>();
    const name = (key: string, fallback: string) =>
      ((this.db.prepare('SELECT name FROM users WHERE key = ?').get(key) as { name: string } | undefined)?.name ?? fallback) || fallback;
    out.set(board.created_by, { key: board.created_by, name: name(board.created_by, board.created_by_name), role: 'owner', via: 'owner' });
    for (const m of this.db.prepare('SELECT user_key, role FROM board_members WHERE board_id = ?').all(boardId) as unknown as { user_key: string; role: string }[]) {
      if (!out.has(m.user_key) && isShareRole(m.role)) out.set(m.user_key, { key: m.user_key, name: name(m.user_key, 'Unbekannt'), role: m.role, via: 'member' });
    }
    const link = this.linkRole(boardId);
    if (link) {
      for (const v of this.db.prepare('SELECT user_key FROM board_link_visits WHERE board_id = ?').all(boardId) as unknown as { user_key: string }[]) {
        if (!out.has(v.user_key)) out.set(v.user_key, { key: v.user_key, name: name(v.user_key, 'Unbekannt'), role: link, via: 'link' });
      }
    }
    return [...out.values()];
  }

  /** Personen, mit denen ich mindestens ein Board teile (für /api/users ohne Board, Modus local). */
  coworkers(user: AccessUser): Person[] {
    const ids = (this.db.prepare('SELECT id, created_by FROM boards WHERE deleted_at IS NULL').all() as unknown as { id: string; created_by: string }[]).filter(
      (b) => this.roleOf(user, b.id),
    );
    const out = new Map<string, Person>();
    for (const b of ids) for (const p of this.people(b.id)) out.set(p.key, { key: p.key, name: p.name });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  /**
   * Bild bzw. Datei ansehen: nur mit Zugriff auf das Board, dem sie gehört (auf das sie hochgeladen bzw. für das sie
   * kopiert wurde). Einfügen über Boards hinweg legt eine eigene Kopie an (image-binding.ts); fremde IDs in einem Board
   * zählen nicht (Sicherheits-Review 2026-11-02 UPL-1: Ex-Mitglieder lasen Bilder über ein eigenes Board weiter).
   */
  canViewImage(user: AccessUser, imageId: string): boolean {
    if (!this.local) return true;
    const row = this.db.prepare('SELECT board_id FROM images WHERE id = ?').get(imageId) as { board_id: string } | undefined;
    if (!row) return true; // die Route antwortet 404
    return this.canAccessBoard(user, row.board_id, 'view');
  }

  // ---- Ändern (Teilen-Dialog) ----------------------------------------------------------------------------------

  setMember(boardId: string, userKey: string, role: ShareRole, by: string) {
    this.db
      .prepare(
        `INSERT INTO board_members (board_id, user_key, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id, user_key) DO UPDATE SET role = excluded.role`,
      )
      .run(boardId, userKey, role, by, nowIso());
  }

  removeMember(boardId: string, userKey: string) {
    this.db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_key = ?').run(boardId, userKey);
    this.db.prepare('DELETE FROM board_link_visits WHERE board_id = ? AND user_key = ?').run(boardId, userKey);
  }

  setInvite(boardId: string, email: string, role: ShareRole, by: string) {
    this.db
      .prepare(
        `INSERT INTO board_invites (board_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role`,
      )
      .run(boardId, email, role, by, nowIso());
  }

  removeInvite(boardId: string, email: string): boolean {
    return this.db.prepare('DELETE FROM board_invites WHERE board_id = ? AND email = ?').run(boardId, email).changes > 0;
  }

  invites(boardId: string): { email: string; role: ShareRole }[] {
    return (this.db.prepare('SELECT email, role FROM board_invites WHERE board_id = ? ORDER BY created_at').all(boardId) as unknown as { email: string; role: string }[]).filter(
      (i): i is { email: string; role: ShareRole } => isShareRole(i.role),
    );
  }

  hasInvite(email: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM board_invites WHERE email = ?').get(email));
  }

  /** Nach der E-Mail-Bestätigung: Einladungen an diese Adresse werden Mitgliedschaften. Liefert die Board-IDs. */
  claimInvites(email: string, userKey: string): string[] {
    const rows = this.db.prepare('SELECT board_id, role, invited_by FROM board_invites WHERE email = ?').all(email) as unknown as { board_id: string; role: string; invited_by: string }[];
    for (const r of rows) {
      const owner = (this.db.prepare('SELECT created_by FROM boards WHERE id = ?').get(r.board_id) as { created_by: string } | undefined)?.created_by;
      if (owner && owner !== userKey && isShareRole(r.role)) {
        const had = this.memberRole(userKey, r.board_id);
        this.setMember(r.board_id, userKey, had && ROLE_RANK[had] > ROLE_RANK[r.role] ? had : r.role, r.invited_by);
      }
    }
    this.db.prepare('DELETE FROM board_invites WHERE email = ?').run(email);
    return rows.map((r) => r.board_id);
  }

  setLink(boardId: string, role: ShareRole | null, by: string) {
    if (!role) this.db.prepare('DELETE FROM board_links WHERE board_id = ?').run(boardId);
    else
      this.db
        .prepare(
          `INSERT INTO board_links (board_id, role, updated_by, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(board_id) DO UPDATE SET role = excluded.role, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .run(boardId, role, by, nowIso());
  }

  /** Besitz übertragen: neue:r Besitzer:in muss schon Zugriff haben; die bisherige bleibt mit „bearbeiten“ dabei. */
  transfer(boardId: string, to: Person, from: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE boards SET created_by = ?, created_by_name = ? WHERE id = ?').run(to.key, to.name, boardId);
      this.db.prepare('DELETE FROM board_members WHERE board_id = ? AND user_key = ?').run(boardId, to.key);
      this.db.prepare('DELETE FROM board_link_visits WHERE board_id = ? AND user_key = ?').run(boardId, to.key);
      this.setMember(boardId, from, 'edit', to.key);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Konto gelöscht: alle Mitgliedschaften und Link-Besuche der Person entfernen. */
  forgetUser(userKey: string) {
    this.db.prepare('DELETE FROM board_members WHERE user_key = ?').run(userKey);
    this.db.prepare('DELETE FROM board_link_visits WHERE user_key = ?').run(userKey);
  }

  /** SSE-Filter (Modus local): Ereignisse nur an Personen mit Zugriff; `only` = gezielt an bestimmte Personen. */
  eventVisible(user: AccessUser, e: BoardEvent): boolean {
    const only = (e as { only?: unknown }).only;
    if (Array.isArray(only)) return only.includes(user.key);
    if (!this.local) return true;
    if (e.type === 'deleted' || e.type === 'purged') return !!this.roleOf(user, e.id, { ignoreTrash: true }) || e.type === 'purged';
    return !!this.roleOf(user, e.id);
  }
}

/**
 * Welche Rolle braucht eine Route? Standard: GET/HEAD `view`, alles andere `edit`. Neue Routen unter
 * `/api/boards/:id/…` (auch anderer Module) sind so automatisch geschützt; Ausnahmen hier eintragen.
 */
export const ROUTE_ROLES: Record<string, Partial<Record<string, BoardRole>> & { '*'?: BoardRole }> = {
  '/api/boards/:id': { DELETE: 'owner' },
  '/api/boards/:id/favorite': { '*': 'view' },
  '/api/boards/:id/duplicate': { POST: 'view' },
  // Versionsverlauf nur für Bearbeitende (wie bei gängigen Whiteboards); zeigt auch gelöschte Inhalte
  '/api/boards/:id/versions': { '*': 'edit' },
  '/api/boards/:id/versions/:vid': { '*': 'edit' },
  '/api/boards/:id/versions/:vid/restore': { '*': 'edit' },
  '/api/boards/:id/versions/:vid/copy': { '*': 'edit' },
  // Versions-Vorschau der Native-API (native/routes.ts, Vertrag §8.14): wie der Versionsverlauf nur für Bearbeitende
  '/api/native/v1/boards/:id/versions/:vid/snapshot': { '*': 'edit' },
  // Teilen-Routen prüfen selbst genauer (access-routes.ts)
  '/api/boards/:id/share': { '*': 'view' },
  '/api/boards/:id/members/:key': { '*': 'view' },
  '/api/boards/:id/invites/:email': { '*': 'edit' },
  '/api/boards/:id/link': { '*': 'edit' },
  '/api/boards/:id/owner': { '*': 'owner' },
  '/api/boards/:id/people': { '*': 'view' },
};

export function requiredRole(route: string, method: string): BoardRole {
  const r = ROUTE_ROLES[route];
  return r?.[method] ?? r?.['*'] ?? (method === 'GET' || method === 'HEAD' ? 'view' : 'edit');
}

/**
 * preHandler im Sitzungs-Bereich (vor dem Papierkorb-Guard): prüft alle Routen mit Board-ID (`/api/boards/:id…` und
 * `/api/native/v1/boards/:id…`) und Bild/Datei-ID.
 * Ohne Zugriff → 404 (das Board „gibt es nicht“ – verrät nichts), mit zu kleiner Rolle → 403 `forbidden`.
 * Im Modus org ein No-op.
 */
export function registerAccessGuard(scope: FastifyInstance, access: BoardAccess) {
  if (!access.local) return;
  scope.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions?.url ?? '';
    const user = req.session ? { key: req.session.userKey, isOrga: false } : null;
    if (!user) return;
    const params = (req.params ?? {}) as { id?: unknown };
    const id = typeof params.id === 'string' ? params.id : '';
    if (route.startsWith('/api/boards/:id') || route.startsWith('/api/native/v1/boards/:id')) {
      const role = access.roleOf(user, id);
      if (!role) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const need = requiredRole(route, req.method);
      if (ROLE_RANK[role] < ROLE_RANK[need]) return sendError(reply, 403, 'no_permission', forbiddenText(need));
      return;
    }
    if (route === '/api/images/:id' || route === '/api/files/:id') {
      if (!access.canViewImage(user, id)) return sendError(reply, 404, 'not_found', 'Nicht gefunden.');
      return;
    }
    if (route.startsWith('/api/trash/:id')) {
      // Papierkorb: nur die Besitzer:in (sie hat gelöscht)
      if (access.roleOf(user, id) !== 'owner') return sendError(reply, 404, 'not_found', 'Dieses Board liegt nicht im Papierkorb.');
    }
  });
}

export function forbiddenText(need: BoardRole): string {
  if (need === 'owner') return 'Das darf nur die Besitzerin bzw. der Besitzer des Boards.';
  if (need === 'edit') return 'Dafür brauchst du Bearbeitungsrechte auf diesem Board.';
  return 'Dafür reichen deine Rechte auf diesem Board nicht.';
}

/**
 * Prüft ein Yjs-Update der Rolle „kommentieren“: Es darf nur Strukturen aus `allowed` ändern (Kommentare, Gelesen-Stand).
 * Spielt das Update auf einer Kopie ein und schaut, welche Wurzel-Strukturen sich geändert haben; Updates mit
 * fehlenden Vorgängern (die später woanders landen könnten) werden abgelehnt.
 */
export function updateTouchesOnly(doc: Y.Doc, update: Uint8Array, allowed: ReadonlySet<string>): boolean {
  if (Y.snapshotContainsUpdate(Y.snapshot(doc), update)) return true; // nichts Neues
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const roots = new Map<Y.AbstractType<any>, string>();
    let ok = true;
    copy.on('afterTransaction', (tr: Y.Transaction) => {
      if (roots.size === 0) for (const [name, t] of copy.share) roots.set(t, name);
      for (const t of tr.changed.keys()) {
        let root: Y.AbstractType<any> = t;
        while (root._item) root = root._item.parent as Y.AbstractType<any>;
        const name = roots.get(root) ?? [...copy.share].find(([, v]) => v === root)?.[0];
        if (!name || !allowed.has(name)) ok = false;
      }
    });
    Y.applyUpdate(copy, update);
    const store = copy.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
    if (store.pendingStructs || store.pendingDs) return false;
    return ok;
  } catch {
    return false;
  } finally {
    copy.destroy();
  }
}

/** lib0-varUint/varUint8Array lesen (Hocuspocus-Nachrichten); null bei kaputten Daten. */
function readVarUint(buf: Uint8Array, pos: { i: number }): number | null {
  let num = 0;
  let mult = 1;
  while (pos.i < buf.length) {
    const b = buf[pos.i++]!;
    num += (b & 0x7f) * mult;
    if (b < 0x80) return num;
    mult *= 128;
    if (mult > 2 ** 53) return null;
  }
  return null;
}

/** Hocuspocus-Nachrichtentypen Sync (0) und SyncReply (4): beide spielen Updates ein (MessageReceiver.apply). */
const SYNC_TYPES: ReadonlySet<number> = new Set([0, 4]);
/** Ohne Dokumentänderung: Awareness (1, eigene Prüfung in sync.ts), Auth (2), QueryAwareness (3), Stateless (5), Close (7). */
const HARMLESS_TYPES: ReadonlySet<number> = new Set([1, 2, 3, 5, 7]);

/**
 * Das Yjs-Update einer Hocuspocus-Nachricht: bei Sync/SyncReply mit Schritt 2 bzw. Update das Update, `null` bei
 * Nachrichten ohne Dokumentänderung (Sync-Schritt 1, Awareness, Auth, Stateless, …), `'invalid'` bei kaputten oder
 * unbekannten Nachrichten (gelten als schreibend und werden abgelehnt).
 */
export function messageUpdate(message: Uint8Array): Uint8Array | null | 'invalid' {
  const pos = { i: 0 };
  const nameLen = readVarUint(message, pos);
  if (nameLen === null) return 'invalid';
  pos.i += nameLen;
  const type = readVarUint(message, pos);
  if (type === null) return 'invalid';
  if (!SYNC_TYPES.has(type)) return HARMLESS_TYPES.has(type) ? null : 'invalid';
  const syncType = readVarUint(message, pos);
  if (syncType === 0) return null; // Schritt 1: fragt nur nach dem Stand
  if (syncType !== 1 && syncType !== 2) return 'invalid';
  const len = readVarUint(message, pos);
  if (len === null || pos.i + len > message.length) return 'invalid';
  return message.subarray(pos.i, pos.i + len);
}

/**
 * Hocuspocus-Nachricht einer Verbindung mit Rolle „kommentieren“: Sync-Schritt 2 und Updates (auch als SyncReply)
 * dürfen nur Kommentar-Strukturen ändern; Awareness, Sync-Schritt 1 und Stateless sind unkritisch, unbekannte Typen
 * werden wie schreibgeschützt behandelt.
 */
export function commentMessageAllowed(message: Uint8Array, doc: Y.Doc): boolean {
  const update = messageUpdate(message);
  if (update === null) return true;
  if (update === 'invalid') return false;
  return updateTouchesOnly(doc, update, COMMENT_ROOTS);
}
