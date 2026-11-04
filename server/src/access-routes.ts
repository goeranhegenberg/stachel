// Teilen-Dialog (Modus local, docs/features/accounts.md): Personen per E-Mail einladen, Rollen ändern, Zugriff
// entziehen, Freigabelink, Besitz übertragen; dazu die Personen-Liste je Board (Erwähnungen, Zuweisen).
// Die grobe Rechteprüfung macht schon der Guard (access.ts ROUTE_ROLES), hier die feineren Regeln:
// - verwalten (einladen, Rollen, Link) dürfen Besitzer:in und „bearbeiten“; Besitz übertragen nur die Besitzer:in
// - die Besitzer:in kann niemand ändern oder entfernen; sich selbst entfernen („Board verlassen“) darf jede:r
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ROLE_LABEL, ROLE_RANK, isShareRole, type BoardAccess, type BoardRole, type ShareRole } from './access.js';
import { accountKey, normEmail, type Accounts } from './accounts.js';
import type { BoardEvents } from './board-events.js';
import type { Db } from './db.js';
import { sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import { mails, type MailContext } from './mail-templates.js';
import { isEmail, type Mailer } from './mailer.js';
import { DEFAULT_LIMITS, type Limits } from './limits.js';
import { ipKey, RateLimiter } from './rate-limit.js';

const MAX_EMAILS = 20;

interface Deps {
  db: Db;
  access: BoardAccess;
  accounts: Accounts;
  mailer: Mailer;
  events: BoardEvents;
  instance: InstanceConfig;
  /** öffentliche Adresse der Web-App (PUBLIC_URL + STACHEL_BASE_PATH, site.ts) für Teilen- und Mail-Links */
  appUrl: string;
  /** Einladungs-Mails je Konto (Stunde, Tag) und je IP (Tag), limits.ts; fehlt = Vorgaben */
  limits?: Pick<Limits, 'invitesPerHour' | 'invitesPerDay' | 'invitesPerDayIp'>;
  /** Sync-Verbindungen einer Person auf dem Board trennen (neue Rolle gilt beim Wiederverbinden) */
  dropUser: (userKey: string, opts: { boardId?: string }) => void;
}

/** Übersichten gezielt neu laden lassen (Board neu sichtbar bzw. weg); `only` filtert der SSE-Filter (access.ts). */
export function notifyPeople(events: BoardEvents, boardId: string, userKeys: readonly string[]) {
  for (const key of new Set(userKeys)) events.emit({ type: 'created', id: boardId, only: [key] } as never);
}

export function registerAccessRoutes(scope: FastifyInstance, deps: Deps) {
  const { db, access, accounts, mailer, events, instance, appUrl } = deps;
  const ctx: MailContext = { brand: instance.brand, publicUrl: appUrl, imprintUrl: instance.imprintUrl, privacyUrl: instance.privacyUrl, termsUrl: instance.termsUrl };
  // Einladungs-/Teilen-Mails gehen an beliebige Adressen: je Konto pro Stunde und Tag, je IP pro Tag begrenzt
  // (Review 2026-11-02 MAIL-1); 0 = ohne Grenze. Zählt jede Adresse, auch an vorhandene Konten (die bekommen ebenfalls eine Mail).
  const lim = { ...DEFAULT_LIMITS, ...deps.limits };
  const inviteLimiters = [
    { max: lim.invitesPerHour, rl: new RateLimiter(Math.max(1, lim.invitesPerHour), 3600_000), key: (req: FastifyRequest) => req.session!.userKey },
    { max: lim.invitesPerDay, rl: new RateLimiter(Math.max(1, lim.invitesPerDay), 24 * 3600_000), key: (req: FastifyRequest) => req.session!.userKey },
    { max: lim.invitesPerDayIp, rl: new RateLimiter(Math.max(1, lim.invitesPerDayIp), 24 * 3600_000), key: (req: FastifyRequest) => ipKey(req.ip) },
  ].filter((l) => l.max > 0);
  const timer = setInterval(() => inviteLimiters.forEach((l) => l.rl.prune()), 60_000);
  timer.unref();
  scope.addHook('onClose', async () => clearInterval(timer));

  const me = (req: FastifyRequest) => ({ key: req.session!.userKey, name: req.session!.name });
  const roleOf = (req: FastifyRequest, id: string) => access.roleOf({ key: req.session!.userKey }, id)!;
  const canManage = (role: BoardRole) => ROLE_RANK[role] >= ROLE_RANK.edit;
  const title = (id: string) => (db.prepare('SELECT title FROM boards WHERE id = ?').get(id) as { title: string } | undefined)?.title ?? 'Board';
  const changed = (id: string, keys: string[]) => {
    for (const k of keys) deps.dropUser(k, { boardId: id });
    notifyPeople(events, id, keys);
  };

  /** Stand des Teilen-Dialogs. E-Mail-Adressen sehen nur, wer verwalten darf. */
  function shareInfo(req: FastifyRequest, id: string) {
    const role = roleOf(req, id);
    const manage = canManage(role);
    const people = access.people(id).map((p) => {
      const acc = accounts.byKey(p.key);
      return { key: p.key, name: acc?.name ?? p.name, email: manage ? (acc?.email ?? null) : null, role: p.role, via: p.via };
    });
    people.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name, 'de'));
    return {
      ok: true,
      title: title(id),
      role,
      canManage: manage,
      people,
      invites: manage ? access.invites(id) : [],
      link: access.linkRole(id),
      url: `${appUrl}/b/${id}`,
    };
  }

  scope.get<{ Params: { id: string } }>('/api/boards/:id/share', async (req) => shareInfo(req, req.params.id));

  // Personen per E-Mail einladen: mit Konto → sofort Mitglied (Mail „geteilt“), ohne → Einladung (Mail mit Registrieren)
  scope.post<{ Params: { id: string } }>('/api/boards/:id/share', async (req, reply) => {
    const id = req.params.id;
    const role = roleOf(req, id);
    if (!canManage(role)) return sendError(reply, 403, 'no_permission', 'Teilen dürfen nur Besitzer:in und wer bearbeiten darf.');
    const b = (req.body ?? {}) as { emails?: unknown; role?: unknown };
    const newRole = b.role;
    if (!isShareRole(newRole)) return sendError(reply, 400, 'invalid_input', 'Bitte eine Rolle wählen.');
    const raw = Array.isArray(b.emails) ? b.emails : typeof b.emails === 'string' ? b.emails.split(/[\s,;]+/) : [];
    const emails = [...new Set(raw.map(normEmail).filter(Boolean))];
    if (!emails.length) return sendError(reply, 400, 'invalid_input', 'Bitte mindestens eine E-Mail-Adresse eingeben.');
    if (emails.length > MAX_EMAILS) return sendError(reply, 400, 'invalid_input', `Höchstens ${MAX_EMAILS} Adressen auf einmal.`);
    const bad = emails.filter((e) => !isEmail(e));
    if (bad.length) return sendError(reply, 400, 'invalid_email', `Diese Adresse stimmt nicht: ${bad[0]}`);
    // alle Grenzen vorab prüfen, dann zählen (keine halb verschickten Einladungen)
    if (inviteLimiters.some((l) => l.rl.remaining(l.key(req)) < emails.length)) {
      return sendError(reply, 429, 'rate_limited', 'Du hast gerade zu viele Einladungen verschickt. Bitte versuch es später noch einmal.');
    }
    for (const l of inviteLimiters) for (const _ of emails) l.rl.hit(l.key(req));
    const who = me(req);
    const boardTitle = title(id);
    const owner = (db.prepare('SELECT created_by FROM boards WHERE id = ?').get(id) as { created_by: string }).created_by;
    const added: string[] = [];
    for (const email of emails) {
      const acc = accounts.byEmail(email);
      if (acc?.verified_at) {
        const key = accountKey(acc.id);
        if (key === owner || key === who.key) continue;
        // die Person hat mich blockiert (blocks.ts, Tabelle user_blocks): Einladung kommt nicht an, ohne es zu verraten
        if (db.prepare('SELECT 1 FROM user_blocks WHERE user_key = ? AND blocked_key = ?').get(key, who.key)) continue;
        access.setMember(id, key, newRole, who.key);
        added.push(key);
        mailer.queue(mails.shared(ctx, email, acc.name, who.name, boardTitle, ROLE_LABEL[newRole], `${appUrl}/b/${id}`));
      } else {
        access.setInvite(id, email, newRole, who.key);
        const url = `${appUrl}/?b=${encodeURIComponent(id)}&register=1&email=${encodeURIComponent(email)}`;
        mailer.queue(mails.invite(ctx, email, who.name, boardTitle, ROLE_LABEL[newRole], url));
      }
    }
    changed(id, added);
    return shareInfo(req, id);
  });

  // Rolle ändern bzw. (DELETE) Zugriff entziehen / Board verlassen
  scope.patch<{ Params: { id: string; key: string } }>('/api/boards/:id/members/:key', async (req, reply) => {
    const id = req.params.id;
    if (!canManage(roleOf(req, id))) return sendError(reply, 403, 'no_permission', 'Rollen ändern dürfen nur Besitzer:in und wer bearbeiten darf.');
    const newRole = (req.body as { role?: unknown } | null)?.role;
    if (!isShareRole(newRole)) return sendError(reply, 400, 'invalid_input', 'Bitte eine Rolle wählen.');
    const target = access.people(id).find((p) => p.key === req.params.key);
    if (!target) return sendError(reply, 404, 'not_found', 'Diese Person hat keinen Zugriff auf das Board.');
    if (target.role === 'owner') return sendError(reply, 403, 'no_permission', 'Die Rolle der Besitzerin bzw. des Besitzers lässt sich nicht ändern.');
    access.setMember(id, target.key, newRole, req.session!.userKey);
    changed(id, [target.key]);
    return shareInfo(req, id);
  });

  scope.delete<{ Params: { id: string; key: string } }>('/api/boards/:id/members/:key', async (req, reply) => {
    const id = req.params.id;
    const self = req.params.key === req.session!.userKey;
    if (!self && !canManage(roleOf(req, id))) return sendError(reply, 403, 'no_permission', 'Zugriff entziehen dürfen nur Besitzer:in und wer bearbeiten darf.');
    const target = access.people(id).find((p) => p.key === req.params.key);
    if (!target) return sendError(reply, 404, 'not_found', 'Diese Person hat keinen Zugriff auf das Board.');
    if (target.role === 'owner') {
      return sendError(reply, 403, 'no_permission', self ? 'Übertrage das Board erst an jemand anderen, bevor du es verlässt.' : 'Die Besitzerin bzw. den Besitzer kann man nicht entfernen.');
    }
    access.removeMember(id, target.key);
    // per Link beigetreten: entfernen hilft nur, solange der Link aus ist – der Dialog sagt das
    changed(id, [target.key]);
    if (self) return { ok: true, left: true };
    return shareInfo(req, id);
  });

  scope.delete<{ Params: { id: string; email: string } }>('/api/boards/:id/invites/:email', async (req, reply) => {
    const id = req.params.id;
    if (!access.removeInvite(id, normEmail(req.params.email))) return sendError(reply, 404, 'not_found', 'Diese Einladung gibt es nicht.');
    return shareInfo(req, id);
  });

  // Freigabelink: {role: 'view'|'comment'|'edit'} an, {role: null} aus
  scope.put<{ Params: { id: string } }>('/api/boards/:id/link', async (req, reply) => {
    const id = req.params.id;
    const r = (req.body as { role?: unknown } | null)?.role ?? null;
    if (r !== null && !isShareRole(r)) return sendError(reply, 400, 'invalid_input', 'Unbekannte Rolle.');
    const before = access.people(id).filter((p) => p.via === 'link').map((p) => p.key);
    access.setLink(id, r as ShareRole | null, req.session!.userKey);
    changed(id, before);
    return shareInfo(req, id);
  });

  // Besitz übertragen (nur Besitzer:in): an eine Person, die schon Zugriff hat
  scope.post<{ Params: { id: string } }>('/api/boards/:id/owner', async (req, reply) => {
    const id = req.params.id;
    const key = (req.body as { key?: unknown } | null)?.key;
    const target = typeof key === 'string' ? access.people(id).find((p) => p.key === key && p.role !== 'owner') : undefined;
    if (!target || !accounts.byKey(target.key)) return sendError(reply, 400, 'invalid_input', 'Übertragen geht nur an eine Person, die schon Zugriff hat.');
    access.transfer(id, { key: target.key, name: accounts.byKey(target.key)!.name }, req.session!.userKey);
    changed(id, [target.key, req.session!.userKey]);
    return shareInfo(req, id);
  });

  // Personen mit Zugriff (Erwähnungen, Zuständige); ohne E-Mail-Adressen
  scope.get<{ Params: { id: string } }>('/api/boards/:id/people', async (req) => ({
    ok: true,
    users: access
      .people(req.params.id)
      .map((p) => ({ key: p.key, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  }));

  // /api/users (Erwähnungen): im Modus local nur Personen mit Zugriff auf `?board=` bzw. mit gemeinsamen Boards
  scope.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions?.url !== '/api/users' || req.method !== 'GET') return;
    const board = (req.query as { board?: unknown } | undefined)?.board;
    const user = { key: req.session!.userKey };
    if (typeof board === 'string' && board) {
      if (!access.canAccessBoard(user, board, 'view')) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const users = access
        .people(board)
        .map((p) => ({ key: p.key, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      return reply.send({ ok: true, users });
    }
    return reply.send({ ok: true, users: access.coworkers(user) });
  });
}
