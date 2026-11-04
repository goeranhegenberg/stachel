// Test-Client für die Native-API (docs/contract.md §8): App-Sitzung holen, WebSocket /native/v1 sprechen, und ein
// Web-Client (Hocuspocus-Provider wie im Browser) als Gegenseite. Genutzt von server/test/native-*.test.ts und
// tools/native-fixtures.mts.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

export type Msg = Record<string, any> & { t: string };

/** Org-Token → `sts_`-Token (POST /api/auth/app-session). */
export async function appSession(base: string, orgToken: string): Promise<{ token: string; user: { key: string; name: string } }> {
  const res = await fetch(`${base}/api/auth/app-session`, { method: 'POST', headers: { Authorization: `Bearer ${orgToken}` } });
  const body = (await res.json()) as { ok: boolean; token: string; user: { key: string; name: string }; error?: string };
  if (res.status !== 200) throw new Error(`app-session ${res.status} ${body.error}`);
  return body;
}

export class NativeClient {
  readonly ws: WebSocket;
  readonly messages: Msg[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: (() => void)[] = [];

  constructor(wsBase: string, token: string | null, opts: { headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    this.ws = new WebSocket(`${wsBase}/native/v1`, { headers, perMessageDeflate: true });
    this.ws.on('message', (data) => {
      this.messages.push(JSON.parse(String(data)) as Msg);
      this.wake();
    });
    this.ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
    this.ws.on('error', () => {});
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  async open(): Promise<this> {
    if (this.ws.readyState === WebSocket.OPEN) return this;
    await new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
      this.ws.once('unexpected-response', (_req, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    });
    return this;
  }

  send(msg: Record<string, unknown>) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Wartet auf die erste Nachricht ab Index `from`, die passt. */
  async next(pred: (m: Msg) => boolean, timeoutMs = 5000, from = 0): Promise<Msg> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.messages.slice(from).find(pred);
      if (hit) return hit;
      if (this.closed) throw new Error(`Verbindung zu (${this.closed.code} ${this.closed.reason}), wartete vergeblich`);
      const left = end - Date.now();
      if (left <= 0) throw new Error(`Timeout; zuletzt: ${JSON.stringify(this.messages.slice(-3)).slice(0, 600)}`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          r();
        });
      });
    }
  }

  async waitClosed(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    const end = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > end) throw new Error('nicht geschlossen');
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closed;
  }

  /** hello senden und auf welcome/resumed warten. */
  async hello(board: string, extra: Record<string, unknown> = {}): Promise<Msg> {
    await this.open();
    const from = this.messages.length;
    this.send({ t: 'hello', proto: 1, board, app: '1.22.0+31', ...extra });
    return this.next((m) => m.t === 'welcome' || m.t === 'resumed' || m.t === 'error', 8000, from);
  }

  close() {
    this.ws.close();
  }
}

/** Web-Client wie im Browser: Hocuspocus-Provider mit Cookie bzw. Bearer im Upgrade. */
export function webClient(wsBase: string, boardId: string, headers: Record<string, string>) {
  class AuthWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: `${wsBase}/sync`, WebSocketPolyfill: AuthWebSocket as any, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false, failed: null as string | null };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason;
    },
  });
  provider.attach();
  return {
    doc,
    provider,
    state,
    objects: doc.getMap<Y.Map<unknown>>('objects'),
    async synced(timeoutMs = 8000) {
      const end = Date.now() + timeoutMs;
      while (!state.synced) {
        if (state.failed) throw new Error(`Sync abgelehnt: ${state.failed}`);
        if (Date.now() > end) throw new Error('Sync-Timeout');
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    /** bis der Server alles hat */
    async flushed(timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      while (provider.hasUnsyncedChanges) {
        if (Date.now() > end) throw new Error('nicht gesendet');
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };
}

/** Patches der Reihe nach auf einen Objekt-Stand anwenden (wie die App, §8.4). */
export function applyPatches(state: Map<string, Record<string, unknown>>, patches: Msg[] | Record<string, any>[]) {
  for (const p of patches) {
    for (const c of p.changes as Record<string, any>[]) {
      if (c.removed) state.delete(c.id);
      else if (c.created) state.set(c.id, structuredClone(c.created));
      else {
        const o = state.get(c.id);
        if (!o) throw new Error(`Patch für unbekanntes Objekt ${c.id}`);
        for (const [k, v] of Object.entries(c.set ?? {})) o[k] = structuredClone(v);
        for (const k of c.unset ?? []) delete o[k];
      }
    }
  }
  return state;
}
