// Startet den echten Stachel-Server (server/dist) als eigenen Prozess; Neustart behält DATA_DIR.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_DIR, SERVER_ENTRY, WEB_DIST } from './paths';

export class StachelServer {
  private proc: ChildProcess | null = null;
  readonly url: string;
  private log: fs.WriteStream;

  constructor(
    readonly port: number,
    readonly dataDir: string,
    /** Fake-Identitätsdienst (server/test/fake-org.ts): Modus org mit `${orgBase}/me` und `${orgBase}/login` */
    readonly orgBase: string,
    logFile: string,
    /** zusätzliche Env-Werte, z. B. STACHEL_AUTH=local und STACHEL_MAIL_MODE=log (accounts.spec.ts, tools/sandbox-open.mts) */
    private readonly extraEnv: Record<string, string> = {},
  ) {
    this.url = `http://127.0.0.1:${port}`;
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    this.log = fs.createWriteStream(logFile, { flags: 'a' });
  }

  async start(): Promise<void> {
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_ENTRY], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(this.port),
        HOST: '127.0.0.1',
        PUBLIC_URL: this.url,
        STACHEL_AUTH: 'org',
        STACHEL_ORG_IDENTITY_URL: `${this.orgBase}/me`,
        STACHEL_ORG_LOGIN_URL: `${this.orgBase}/login`,
        DATA_DIR: this.dataDir,
        WEB_DIST,
        COOKIE_SECURE: 'false',
        LOG_LEVEL: 'warn',
        ...this.extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout!.pipe(this.log, { end: false });
    proc.stderr!.pipe(this.log, { end: false });
    this.proc = proc;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`Server beendet (Code ${proc.exitCode}), siehe Log`);
      try {
        const r = await fetch(`${this.url}/api/health`);
        if (r.ok) return;
      } catch {
        /* startet noch */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('Server startet nicht');
  }

  /** Sauber beenden (SIGTERM speichert offene Dokumente). */
  async stop(): Promise<void> {
    const p = this.proc;
    if (!p || p.exitCode !== null) return;
    const done = new Promise<void>((r) => p.once('exit', () => r()));
    p.kill('SIGTERM');
    const timer = setTimeout(() => p.kill('SIGKILL'), 15_000);
    await done;
    clearTimeout(timer);
    this.proc = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
