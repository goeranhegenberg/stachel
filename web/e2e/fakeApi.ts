// Lokales Fake des Stachel-Servers (docs/contract.md §2/§3) über page.route – kein echtes Backend in Tests.
import type { Page, Route } from '@playwright/test';

export interface FakeUser {
  key: string;
  name: string;
  isOrga: boolean;
}
export interface FakeBoard {
  id: string;
  title: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface FakeOptions {
  loggedIn?: boolean;
  qrTtlMs?: number;
  boards?: FakeBoard[];
  user?: FakeUser;
  /** WebSocket /sync nicht abfangen (für den echten Test-Sync-Server) */
  keepSync?: boolean;
  /** Port des Test-Sync-Servers (startSyncServer): /sync geht direkt dorthin statt über den Vite-Proxy; impliziert keepSync */
  syncPort?: number;
  /** Antwort von /api/instance überschreiben (Standard: Modus org mit FAKE_INSTANCE) */
  instance?: Partial<typeof FAKE_INSTANCE>;
}

/** Betriebsart der Fake-Instanz (docs/contract.md §6 `/api/instance`): Modus org einer Beispiel-Organisation. */
export const FAKE_INSTANCE = {
  auth: 'org' as 'org' | 'local',
  brand: 'Stachel',
  imprintUrl: null as string | null,
  privacyUrl: null as string | null,
  termsUrl: null as string | null,
  registration: null as 'open' | 'invite' | null,
  orgName: 'Musterverein' as string | null,
  orgAppName: 'Musterverein-App' as string | null,
  orgPasswordLogin: true,
  orgAndroidPackage: 'org.example.verein' as string | null,
};

export const DEFAULT_USER: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };

export async function installFakeApi(page: Page, opts: FakeOptions = {}) {
  const ORGA = opts.user ?? DEFAULT_USER;
  const state = {
    user: opts.loggedIn ? ORGA : (null as FakeUser | null),
    boards: [...(opts.boards ?? [])],
    /** Papierkorb (docs/contract.md §3): gelöschte Boards mit deletedAt/purgeAt */
    trash: [] as (FakeBoard & { deletedAt: string; deletedBy: string; deletedByName: string; purgeAt: string; canManage: boolean })[],
    qrStarts: 0,
    approveNext: false,
    qrError: null as string | null,
    wrongPasswords: 0,
    csrfMissing: 0,
  };
  let seq = 0;

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const fail = (route: Route, status: number, error: string) => json(route, status, { ok: false, error, message: `Server: ${error}` });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method !== 'GET' && req.headers()['x-stachel'] !== '1' && path !== '/api/auth/qr/approve') {
      state.csrfMissing++;
      return fail(route, 403, 'csrf');
    }

    if (path === '/api/instance') return json(route, 200, { ok: true, ...FAKE_INSTANCE, ...opts.instance });
    if (path === '/api/auth/me') return state.user ? json(route, 200, { ok: true, user: state.user }) : fail(route, 401, 'not_logged_in');
    if (path === '/api/auth/logout') {
      state.user = null;
      return json(route, 200, { ok: true });
    }
    if (path === '/api/auth/password') {
      const { username, password } = req.postDataJSON();
      if (state.wrongPasswords >= 3) return fail(route, 429, 'rate_limited');
      if (username === 'wartend') return json(route, 403, { ok: false, error: 'pending', message: 'Dein Konto bei Musterverein wartet noch auf Freigabe.' });
      if (username === 'orga' && password === 'geheim') {
        state.user = ORGA;
        return json(route, 200, { ok: true, user: ORGA });
      }
      state.wrongPasswords++;
      return fail(route, 401, 'invalid_credentials');
    }
    if (path === '/api/auth/qr' && method === 'POST') {
      state.qrStarts++;
      const code = `code-${state.qrStarts}-abcdefghijklmnopqrstuvwx`;
      const ttl = opts.qrTtlMs ?? 120_000;
      return json(route, 200, { ok: true, code, url: `https://board.example.org/qr/${code}`, expires_at: new Date(Date.now() + ttl).toISOString() });
    }
    const wait = path.match(/^\/api\/auth\/qr\/([^/]+)\/wait$/);
    if (wait) {
      await new Promise((r) => setTimeout(r, 250));
      // bleibt gesetzt, bis der Test ihn zurücknimmt (abgebrochene Long-Polls verschlucken ihn sonst)
      if (state.qrError) return fail(route, state.qrError === 'expired' ? 410 : 403, state.qrError);
      if (state.approveNext) {
        state.user = ORGA;
        state.approveNext = false;
        return json(route, 200, { ok: true, status: 'approved', user: ORGA });
      }
      return json(route, 200, { ok: true, status: 'pending' });
    }

    if (!state.user) return fail(route, 401, 'not_logged_in');
    if (path === '/api/boards' && method === 'GET') {
      const sorted = [...state.boards].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return json(route, 200, { ok: true, boards: sorted });
    }
    if (path === '/api/boards' && method === 'POST') {
      const { title } = req.postDataJSON();
      const now = new Date().toISOString();
      const board = { id: `b${++seq}`, title, createdBy: state.user.key, createdByName: state.user.name, createdAt: now, updatedAt: now };
      state.boards.push(board);
      return json(route, 201, { ok: true, board });
    }
    const one = path.match(/^\/api\/boards\/([^/]+)$/);
    if (one) {
      const b = state.boards.find((x) => x.id === decodeURIComponent(one[1]));
      if (!b) return fail(route, 404, 'not_found');
      if (method === 'PATCH') {
        b.title = req.postDataJSON().title;
        b.updatedAt = new Date().toISOString();
        return json(route, 200, { ok: true, board: b });
      }
      if (method === 'DELETE') {
        if (b.createdBy !== state.user.key && !state.user.isOrga) return fail(route, 403, 'forbidden');
        state.boards = state.boards.filter((x) => x !== b);
        const deletedAt = new Date().toISOString();
        const purgeAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
        const t = { ...b, deletedAt, deletedBy: state.user.key, deletedByName: state.user.name, purgeAt, canManage: true };
        state.trash.unshift(t);
        return json(route, 200, { ok: true, board: t });
      }
    }
    if (path === '/api/trash' && method === 'GET') return json(route, 200, { ok: true, boards: state.trash });
    if (path === '/api/trash' && method === 'DELETE') {
      const purged = state.trash.length;
      state.trash = [];
      return json(route, 200, { ok: true, purged });
    }
    const trashed = path.match(/^\/api\/trash\/([^/]+)(\/restore)?$/);
    if (trashed) {
      const t = state.trash.find((x) => x.id === decodeURIComponent(trashed[1]));
      if (!t) return fail(route, 404, 'not_found');
      if (method === 'GET') return json(route, 200, { ok: true, board: t });
      state.trash = state.trash.filter((x) => x !== t);
      if (trashed[2] && method === 'POST') {
        const { deletedAt: _a, deletedBy: _b, deletedByName: _c, purgeAt: _d, canManage: _e, ...board } = t;
        state.boards.push(board);
        return json(route, 200, { ok: true, board });
      }
      return json(route, 200, { ok: true });
    }
    return fail(route, 404, 'not_found');
  });
  // Ohne Test-Sync-Server: WebSocket sofort schließen
  if (opts.syncPort) {
    // WebSocket-URL umschreiben: Cookies hängen am Host, nicht am Port – die Session geht also mit
    await page.addInitScript((port) => {
      const Native = window.WebSocket;
      const Patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
        const u = new URL(String(url), location.href);
        if (u.pathname === '/sync') url = `ws://localhost:${port}/sync`;
        return new Native(url, protocols);
      } as unknown as typeof WebSocket;
      Patched.prototype = Native.prototype;
      Object.assign(Patched, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      window.WebSocket = Patched;
    }, opts.syncPort);
  } else if (!opts.keepSync) await page.routeWebSocket('**/sync', (ws) => ws.close());
  return state;
}

export function sampleBoards(): FakeBoard[] {
  const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
  return [
    { id: 'b-plan', title: 'Festival · Ablauf', createdBy: 'm:12', createdByName: 'Mara Lindner', createdAt: t(9000), updatedAt: t(4) },
    { id: 'b-lage', title: 'Lageplan Gelände', createdBy: 'm:31', createdByName: 'Jonas Keller', createdAt: t(9000), updatedAt: t(60 * 5) },
    { id: 'b-ideen', title: 'Ideen-Pool', createdBy: 'm:7', createdByName: 'Ida Wolff', createdAt: t(9000), updatedAt: t(60 * 26) },
    { id: 'b-helfer', title: 'Helfer-Schichten', createdBy: 'm:12', createdByName: 'Mara Lindner', createdAt: t(9000), updatedAt: t(60 * 24 * 4) },
    { id: 'b-retro', title: 'Retro Sommerfest 2026', createdBy: 'a:admin', createdByName: 'Admin', createdAt: t(90000), updatedAt: t(60 * 24 * 40) },
  ];
}
