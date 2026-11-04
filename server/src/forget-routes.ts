// Daten löschen (docs/contract.md §6, docs/features/accounts.md „Konto löschen“):
// - Modus org: `POST /api/account/delete {confirm: true}` = „Meine Daten bei Stachel löschen“. Das Konto bei der
//   Organisation selbst bleibt (es gehört ihrem Identitätsdienst); Stachel vergisst alles Persönliche (Sitzungen samt
//   gespeichertem Org-Token, API-Tokens, Favoriten, „zuletzt geöffnet“, Posteingang), auf den Boards des Teams steht statt des
//   Namens „Gelöschtes Konto“. Die Boards bleiben beim Team. (Modus local: accounts.ts, mit Passwort.)
// - beide Modi: `GET /konto-loeschen` – öffentliche Seite, wie man Konto bzw. Daten löscht (Pflichtlink für Google Play).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { SESSION_COOKIE } from '../../shared/protocol.js';
import type { Db } from './db.js';
import { sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import { DELETION_SLUG, legalFooter, legalFrame } from './legal-pages.js';
import { appSessionToken } from './native/auth.js';
import { RateLimiter } from './rate-limit.js';
import type { SessionStore } from './sessions.js';

export const DELETION_INFO_PATH = `/${DELETION_SLUG}`;

export interface ForgetMeDeps {
  db: Db;
  sessions: SessionStore;
  forget: (who: { key: string; name?: string }) => Promise<unknown>;
  /** offene Sync- und Native-Verbindungen der Person trennen */
  dropUser: (userKey: string) => void;
  clearSessionCookie: (reply: FastifyReply) => void;
}

/** Modus org: „Meine Daten bei Stachel löschen“ (Cookie oder App-Sitzung `sts_`, nicht mit API-Token `stk_`). */
export function registerForgetMe(app: FastifyInstance, deps: ForgetMeDeps) {
  const { db, sessions } = deps;
  const limiter = new RateLimiter(5, 15 * 60_000);
  app.post('/api/account/delete', async (req, reply) => {
    const session = sessions.get(req.cookies[SESSION_COOKIE]) ?? sessions.get(appSessionToken(req.headers.authorization));
    if (!session) return sendError(reply, 401, 'not_logged_in', 'Bitte zuerst anmelden.');
    if ((req.body as { confirm?: unknown } | null)?.confirm !== true) {
      return sendError(reply, 400, 'invalid_input', 'Bitte bestätige, dass deine Daten bei Stachel gelöscht werden sollen.');
    }
    if (!limiter.allow(session.userKey)) return sendError(reply, 429, 'rate_limited', 'Zu viele Versuche. Bitte warte ein paar Minuten.');
    const key = session.userKey;
    await deps.forget({ key, name: session.name });
    db.exec('BEGIN');
    try {
      for (const sql of [
        'DELETE FROM sessions WHERE user_key = ?',
        'DELETE FROM pairings WHERE user_key = ?',
        'DELETE FROM app_codes WHERE user_key = ?',
        'DELETE FROM board_favorites WHERE user_key = ?',
        'DELETE FROM board_visits WHERE user_key = ?',
        'DELETE FROM users WHERE key = ?',
      ]) {
        const table = /FROM (\w+)/.exec(sql)![1]!;
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)) db.prepare(sql).run(key);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    deps.dropUser(key);
    deps.clearSessionCookie(reply);
    return { ok: true };
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Öffentliche Seite „Konto löschen“ unter `/konto-loeschen` (und unter dem Pfad der Web-App, falls gesetzt). */
export function registerDeletionInfo(app: FastifyInstance, opts: { instance: InstanceConfig; appUrl: string; basePath?: string }) {
  const html = deletionInfoPage(opts.instance, opts.appUrl);
  for (const prefix of new Set(['', opts.basePath ?? ''])) {
    app.get(`${prefix}${DELETION_INFO_PATH}`, async (_req, reply) =>
      reply.header('Cache-Control', 'public, max-age=300').type('text/html; charset=utf-8').send(html),
    );
  }
}

export function deletionInfoPage(inst: InstanceConfig, appUrl: string): string {
  const brand = esc(inst.brand || 'Stachel');
  const org = esc(inst.orgName);
  const account = `${appUrl}/?konto=1`;
  const local = inst.auth === 'local';
  const imprint = inst.imprintUrl ? `<a href="${esc(inst.imprintUrl)}">Impressum und Kontakt</a>` : 'das Impressum';
  const body = local
    ? `<h1>Konto <em>löschen</em></h1>
  <p>So löschst du dein ${brand}-Konto und die Daten dazu – jederzeit selbst, ohne Rückfrage.</p>
  <h2>In der App</h2>
  <ol><li>${brand}-App öffnen und anmelden</li><li>Oben rechts auf dein Konto tippen</li><li>„Konto löschen“ wählen und mit deinem Passwort bestätigen</li></ol>
  <h2>Im Browser</h2>
  <ol><li>Anmelden und <a href="${esc(account)}">dein Konto</a> öffnen</li><li>„Konto löschen“ wählen und mit deinem Passwort bestätigen</li></ol>
  <a class="btn" href="${esc(account)}">Zu meinem Konto</a>
  <h2>Was gelöscht wird</h2>
  <ul>
    <li>dein Konto: E-Mail-Adresse, Name, Passwort (nur als Hash gespeichert)</li>
    <li>alle Anmeldungen, auch in der App, und deine persönlichen KI-Zugänge (API-Tokens)</li>
    <li>Favoriten, „Zuletzt geöffnet“, Erwähnungen im Posteingang und offene Einladungen an deine Adresse</li>
    <li>deine eigenen Boards mit Bildern und Dokumenten – oder du gibst sie vorher an eine Person mit Zugriff weiter</li>
  </ul>
  <p>Was du auf Boards anderer beigetragen hast (Kommentare, Reaktionen, Stimmen, Inhalte), bleibt dort stehen;
  statt deines Namens steht dann „Gelöschtes Konto“. Das Löschen passiert sofort. Server-Protokolle (mit IP-Adresse)
  werden laufend überschrieben.</p>
  <h2>Kein Zugang mehr?</h2>
  <p>Setze dein Passwort über „Passwort vergessen“ auf der Anmeldeseite neu und lösche das Konto dann selbst – oder
  schreib uns über ${imprint}.</p>`
    : `<h1>Meine Daten <em>löschen</em></h1>
  <p>Bei ${brand} meldest du dich mit deinem Konto bei ${org} an. ${brand} selbst hat kein eigenes Konto von dir, speichert aber
  ein paar Daten zu dir – die kannst du jederzeit selbst löschen.</p>
  <h2>In der App</h2>
  <ol><li>Stachel-App öffnen und anmelden</li><li>Oben rechts auf dein Konto tippen</li><li>„Meine Daten bei Stachel löschen“ wählen und bestätigen</li></ol>
  <h2>Im Browser</h2>
  <ol><li>Anmelden und <a href="${esc(account)}">deine Daten</a> öffnen (oben auf deinen Namen)</li><li>„Meine Daten bei Stachel löschen“ wählen und bestätigen</li></ol>
  <a class="btn" href="${esc(account)}">Zu meinen Daten</a>
  <h2>Was gelöscht wird</h2>
  <ul>
    <li>alle Anmeldungen bei ${brand} (auch in der App) samt dem dafür gespeicherten Anmelde-Token von ${org}</li>
    <li>deine persönlichen KI-Zugänge (API-Tokens), Favoriten, „Zuletzt geöffnet“ und der Posteingang</li>
    <li>dein Name auf den Boards: bei Kommentaren, Reaktionen, Stimmen und in der Liste „zuständig“ steht dann „Gelöschtes Konto“</li>
  </ul>
  <p>Die Boards gehören dem Team und bleiben. Dein <strong>Konto bei ${org}</strong> bleibt bestehen – das verwaltet
  ${org}; wende dich dafür direkt dorthin. Meldest du dich später wieder bei ${brand} an, beginnt alles neu.
  Server-Protokolle (mit IP-Adresse) werden laufend überschrieben. Fragen: ${imprint}.</p>`;
  return legalFrame({ brand: inst.brand || 'Stachel', title: local ? 'Konto löschen' : 'Meine Daten löschen', body, footer: legalFooter(inst, appUrl, DELETION_SLUG) });
}
