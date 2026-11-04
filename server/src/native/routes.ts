// Native REST-Routen der Apps (docs/contract.md §8): hier hängen alle Pakete ihre HTTP-Endpunkte an, damit
// server/src/app.ts sie nur einmal einbindet. Öffentlich: `GET /api/native/info` (§8.2). Mit Sitzung: Posteingang
// `GET /api/native/v1/inbox` (§8.11), Versions-Vorschau `GET /api/native/v1/boards/:id/versions/:vid/snapshot` (§8.14).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { NATIVE_FEATURES, NATIVE_INBOX_PATH, NATIVE_INFO_PATH, NATIVE_LIMITS, NATIVE_PATH, NATIVE_PRESENCE_EXTRA, NATIVE_PROTO } from '../../../shared/native.js';
import { WEB } from '#stachel-web';
import { sendError } from '../http-util.js';
import type { NativeInbox } from './inbox.js';
import type { BoardVersions } from '../versions.js';
import { VERSION_SNAPSHOT_BELOW, versionSnapshot } from './version-snapshot.js';

export interface NativePublicDeps {
  /** Mindestversion je App (null = keine); `minApp` in der Antwort = die der Org-App (älteres Feld) */
  minApps: { org: string | null; stachel: string | null };
  /** Sandbox-Aktionen (`dev.*`) mitzählen */
  devActions: boolean;
}

/** Routen ohne Sitzung (an `app`). */
export function registerNativePublicRoutes(app: FastifyInstance, deps: NativePublicDeps) {
  app.get(NATIVE_INFO_PATH, async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return {
      ok: true,
      proto: [NATIVE_PROTO],
      minApp: deps.minApps.org,
      minApps: { ...deps.minApps },
      path: NATIVE_PATH,
      features: [...NATIVE_FEATURES],
      actions: WEB.actionList(deps.devActions),
      presenceExtra: [...NATIVE_PRESENCE_EXTRA],
      limits: { ...NATIVE_LIMITS },
    };
  });
}

export interface NativeSessionDeps {
  inbox: NativeInbox;
  /** Modus local: darf die anfragende Person das Board sehen? (fehlt = alle) */
  visible?: (req: FastifyRequest, boardId: string) => boolean;
  /** Versionsverlauf und Board-Titel (Versions-Vorschau §8.14; fehlt = Route nicht da) */
  versions?: BoardVersions;
  boardTitle?: (id: string) => string | undefined;
}

const VERSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Routen mit Sitzungspflicht (an den Sitzungs-Scope von app.ts). */
export function registerNativeRoutes(scope: FastifyInstance, deps: NativeSessionDeps) {
  // `GET /api/native/v1/inbox?since=<iso>` (§8.11): neue @Erwähnungen und Karten-Zuweisungen der anfragenden Person
  scope.get<{ Querystring: { since?: string } }>(NATIVE_INBOX_PATH, async (req, reply) => {
    const since = req.query.since;
    if (since !== undefined && !ISO_RE.test(since)) return sendError(reply, 400, 'invalid_input', '`since` muss eine ISO-Zeit (UTC, …Z) sein.');
    const res = deps.inbox.list(req.session!.userKey, since);
    const visible = deps.visible;
    return { ok: true, now: res.now, items: visible ? res.items.filter((i) => visible(req, i.boardId)) : res.items };
  });

  // `GET /api/native/v1/boards/:id/versions/:vid/snapshot` (§8.14): Inhalt einer Version als Objekt-JSON (Vorschau N03)
  const { versions, boardTitle } = deps;
  if (versions && boardTitle) {
    scope.get<{ Params: { id: string; vid: string } }>('/api/native/v1/boards/:id/versions/:vid/snapshot', async (req, reply) => {
      const { id, vid } = req.params;
      const title = boardTitle(id);
      if (title === undefined || (deps.visible && !deps.visible(req, id))) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const info = VERSION_ID.test(vid) ? versions.list(id).find((v) => v.id === vid) : undefined;
      const content = info ? versions.content(id, vid) : null;
      if (!info || !content) return sendError(reply, 404, 'not_found', 'Diese Version gibt es nicht (mehr).');
      // Inhalt einer Version bleibt gleich, ihr Name nicht: immer nachfragen
      reply.header('Cache-Control', 'private, no-cache');
      return { ok: true, board: { id, title }, version: info, below: VERSION_SNAPSHOT_BELOW, snapshot: versionSnapshot(content) };
    });
  }
}
