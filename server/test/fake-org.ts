// Lokales Fake eines Identitätsdienstes für den Modus org (docs/contract.md §1): `GET /me` prüft ein Org-Token,
// `POST /login` tauscht Benutzername + Passwort gegen ein Token. Admins bekommen die Kennung `a:<name>`, Mitglieder `m:<id>`.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeIdentity =
  | { kind: 'admin'; username: string }
  | { kind: 'member'; id: number; name: string; status: 'active' | 'pending' | 'blocked'; orga?: boolean };

/** Pfade des Fakes (STACHEL_ORG_IDENTITY_URL = `${url}${ME_PATH}`, STACHEL_ORG_LOGIN_URL = `${url}${LOGIN_PATH}`). */
export const ME_PATH = '/me';
export const LOGIN_PATH = '/login';

export class FakeOrg {
  /** Admin-Logins: username → password. */
  admins = new Map<string, string>();
  /** Gültige Tokens → Identität. */
  tokens = new Map<string, FakeIdentity>();
  /** 'ok' normal, 'down' = Verbindung kappen, 'error' = HTTP 500. */
  mode: 'ok' | 'down' | 'error' = 'ok';
  calls = { login: 0, me: 0 };
  private server = http.createServer((req, res) => this.handle(req, res));
  url = '';

  /** port 0 = frei wählen (Tests); die Sandbox nimmt einen festen Port (tools/sandbox.mts). */
  async start(port = 0, host = '127.0.0.1'): Promise<this> {
    await new Promise<void>((r) => this.server.listen(port, host, r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  get identityUrl(): string {
    return this.url + ME_PATH;
  }

  get loginUrl(): string {
    return this.url + LOGIN_PATH;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  addAdmin(username: string, password: string): void {
    this.admins.set(username, password);
  }

  /** Legt ein Mitglieds-Token an und gibt es zurück. */
  addMember(id: number, name: string, status: 'active' | 'pending' | 'blocked' = 'active', orga = false): string {
    const token = `member-${id}-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(token, { kind: 'member', id, name, status, orga });
    return token;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (this.mode === 'down') {
      req.socket.destroy();
      return;
    }
    if (this.mode === 'error') return this.json(res, 500, { error: 'boom' });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');

    if (req.method === 'POST' && req.url === LOGIN_PATH) {
      this.calls.login++;
      const body = raw ? (JSON.parse(raw) as { username?: string; password?: string }) : {};
      const username = (body.username ?? '').trim();
      if (!this.admins.has(username) || this.admins.get(username) !== body.password) {
        return this.json(res, 401, { error: 'invalid_credentials', message: 'Login fehlgeschlagen.' });
      }
      const token = `admin-${username}-${Math.random().toString(36).slice(2)}`;
      this.tokens.set(token, { kind: 'admin', username });
      return this.json(res, 200, { token });
    }

    if (req.method === 'GET' && req.url === ME_PATH) {
      this.calls.me++;
      const auth = req.headers.authorization ?? '';
      if (!auth.startsWith('Bearer ')) return this.json(res, 401, { error: 'missing_token' });
      const id = this.tokens.get(auth.slice(7).trim());
      if (!id) return this.json(res, 401, { error: 'invalid_token' });
      if (id.kind === 'admin') return this.json(res, 200, { id: `a:${id.username}`, name: id.username, admin: true, status: 'active' });
      return this.json(res, 200, { id: `m:${id.id}`, name: id.name, admin: Boolean(id.orga) && id.status === 'active', status: id.status });
    }
    this.json(res, 404, { error: 'not_found' });
  }
}
