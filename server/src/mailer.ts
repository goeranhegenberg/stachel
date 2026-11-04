// E-Mails für eigene Konten (Modus local, docs/features/accounts.md): kleiner SMTP-Client ohne Zusatzpaket
// (implizites TLS wie Strato smtp.strato.de:465, STARTTLS oder unverschlüsselt nur für Tests) und ein Log-Modus
// (STACHEL_MAIL_MODE=log: Mails landen in DATA_DIR/mail.log statt im Netz – nur für Tests und die Sandbox).
// Versand läuft im Hintergrund (queue): Antworten der API sind gleich schnell, egal ob eine Mail rausgeht
// (keine Konto-Aufzählung über die Antwortzeit).
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { InstanceConfig } from './instance.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** ssl = implizites TLS (465), starttls (587), none (nur lokal/Tests) */
  secure: 'ssl' | 'starttls' | 'none';
  /** Zertifikat prüfen (Standard ja; nur Tests schalten ab) */
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export interface Mailer {
  /** Im Hintergrund senden; Fehler landen im Log, nie beim Aufrufer. */
  queue(m: MailMessage): void;
  /** Senden und auf das Ergebnis warten (Tests, Werkzeuge). */
  send(m: MailMessage): Promise<void>;
  /** wartet, bis alles aus queue() raus ist (Tests, Herunterfahren) */
  idle(): Promise<void>;
}

type Log = (msg: string, err?: unknown) => void;

abstract class BaseMailer implements Mailer {
  private pending = new Set<Promise<void>>();
  constructor(protected readonly log: Log) {}
  abstract send(m: MailMessage): Promise<void>;
  queue(m: MailMessage) {
    const p = this.send(m)
      .catch((e) => this.log(`E-Mail an ${maskEmail(m.to)} nicht gesendet`, e))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

/** Schreibt Mails als JSON-Zeilen nach `file` (Tests lesen die Links daraus). */
export class LogMailer extends BaseMailer {
  readonly outbox: MailMessage[] = [];
  constructor(
    private readonly file: string | null,
    log: Log,
    /** Links der Mail mit ins Server-Log (Instanz ohne SMTP: Bestätigungs-/Reset-Links per `docker logs` finden) */
    private readonly echoLinks = false,
  ) {
    super(log);
  }
  async send(m: MailMessage) {
    this.outbox.push(m);
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.file) {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.appendFile(this.file, `${JSON.stringify({ at: new Date().toISOString(), ...m })}\n`);
    }
    const links = this.echoLinks ? [...new Set(m.text.match(/https?:\/\/[^\s<>"]+/g) ?? [])] : [];
    this.log(`[mail-log] an ${maskEmail(m.to)}: ${m.subject}${links.length ? ` – ${links.join(' ')}` : ''}`);
  }
}

export class SmtpMailer extends BaseMailer {
  constructor(
    private readonly cfg: SmtpConfig,
    private readonly brand: string,
    log: Log,
  ) {
    super(log);
  }

  async send(m: MailMessage) {
    const from = parseFrom(this.cfg.from || this.cfg.user);
    if (!from.address) throw new Error('STACHEL_SMTP_FROM fehlt');
    const to = cleanAddress(m.to);
    const raw = buildMime({ ...m, to }, { name: from.name ?? this.brand, address: from.address });
    const s = await SmtpSession.open(this.cfg);
    try {
      await s.hello();
      if (this.cfg.secure === 'starttls') {
        await s.cmd('STARTTLS', [220]);
        await s.upgrade(this.cfg);
        await s.hello();
      }
      if (this.cfg.user) await s.auth(this.cfg.user, this.cfg.pass);
      await s.cmd(`MAIL FROM:<${from.address}>`, [250]);
      await s.cmd(`RCPT TO:<${to}>`, [250, 251]);
      await s.cmd('DATA', [354]);
      await s.cmd(`${dotStuff(raw)}\r\n.`, [250]);
      await s.cmd('QUIT', [221]).catch(() => {});
    } finally {
      s.close();
    }
  }
}

/** Eine SMTP-Verbindung: Zeilen lesen, mehrzeilige Antworten (`250-…`, `250 …`) zusammenfassen. */
class SmtpSession {
  private buf = '';
  private lines: string[] = [];
  private waiters: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void }[] = [];
  private error: Error | null = null;
  private ext = new Set<string>();

  private constructor(
    private socket: net.Socket,
    private readonly host: string,
  ) {
    this.bind(socket);
  }

  static open(cfg: SmtpConfig): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const opts = { host: cfg.host, port: cfg.port };
      const socket =
        cfg.secure === 'ssl'
          ? tls.connect({ ...opts, servername: cfg.host, rejectUnauthorized: cfg.rejectUnauthorized ?? true })
          : net.connect(opts);
      socket.setTimeout(cfg.timeoutMs ?? 20_000);
      const s = new SmtpSession(socket, cfg.host);
      const fail = (e: Error) => reject(e);
      socket.once('error', fail);
      s.read()
        .then((r) => {
          socket.off('error', fail);
          if (r.code !== 220) throw new Error(`SMTP-Begrüßung ${r.code} ${r.text}`);
          resolve(s);
        })
        .catch(reject);
    });
  }

  private bind(socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this.lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) this.flush();
      }
    });
    const fail = (e: Error) => {
      this.error ??= e;
      for (const w of this.waiters.splice(0)) w.reject(e);
    };
    socket.on('error', fail);
    socket.on('timeout', () => {
      fail(new Error('SMTP-Zeitüberschreitung'));
      socket.destroy();
    });
    socket.on('close', () => fail(new Error('SMTP-Verbindung geschlossen')));
  }

  private replies: { code: number; text: string }[] = [];
  private flush() {
    const lines = this.lines.splice(0);
    const code = Number(lines.at(-1)!.slice(0, 3));
    const text = lines.map((l) => l.slice(4)).join('\n');
    const w = this.waiters.shift();
    if (w) w.resolve({ code, text });
    else this.replies.push({ code, text });
  }

  read(): Promise<{ code: number; text: string }> {
    const r = this.replies.shift();
    if (r) return Promise.resolve(r);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** `secret`: Zeile enthält Zugangsdaten (nie in Fehlermeldungen übernehmen). */
  async cmd(line: string, ok: number[], secret = false): Promise<{ code: number; text: string }> {
    this.socket.write(`${line}\r\n`);
    const r = await this.read();
    if (!ok.includes(r.code)) {
      const shown = secret ? (line.startsWith('AUTH') ? line.split(' ').slice(0, 2).join(' ') : '(Anmeldedaten)') : line.split('\r\n')[0]!.slice(0, 40);
      throw new Error(`SMTP ${shown} → ${r.code} ${r.text}`);
    }
    return r;
  }

  async hello() {
    const name = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
    const r = await this.cmd(`EHLO ${name}`, [250]);
    this.ext = new Set(r.text.split('\n').map((l) => l.trim().toUpperCase()));
  }

  upgrade(cfg: SmtpConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners('data');
      this.socket.removeAllListeners('error');
      this.socket.removeAllListeners('timeout');
      this.socket.removeAllListeners('close');
      const secure = tls.connect({ socket: this.socket, servername: this.host, rejectUnauthorized: cfg.rejectUnauthorized ?? true }, () => resolve());
      secure.once('error', reject);
      secure.setTimeout(cfg.timeoutMs ?? 20_000);
      this.socket = secure;
      this.buf = '';
      this.bind(secure);
    });
  }

  async auth(user: string, pass: string) {
    const methods = [...this.ext].find((l) => l.startsWith('AUTH'))?.split(/[\s=]+/) ?? [];
    if (methods.includes('PLAIN') || !methods.includes('LOGIN')) {
      await this.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235], true);
      return;
    }
    await this.cmd('AUTH LOGIN', [334]);
    await this.cmd(Buffer.from(user).toString('base64'), [334], true);
    await this.cmd(Buffer.from(pass).toString('base64'), [235], true);
  }

  close() {
    this.socket.end();
    this.socket.destroy();
  }
}

// ---- MIME ----------------------------------------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

export function isEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

/** Adressen kommen aus Eingaben: keine Zeilenumbrüche/Spitzklammern (Header-Injection). */
function cleanAddress(s: string): string {
  const a = s.trim();
  if (!isEmail(a)) throw new Error('Ungültige Empfängeradresse');
  return a;
}

export function parseFrom(s: string): { name: string | null; address: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(s);
  if (m) return { name: m[1]!.replace(/^"|"$/g, '') || null, address: m[2]! };
  return { name: null, address: s.trim() };
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const b64lines = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');

export function buildMime(m: MailMessage, from: { name: string; address: string }): string {
  const boundary = `stachel-${crypto.randomBytes(12).toString('hex')}`;
  const domain = from.address.split('@')[1] ?? 'localhost';
  const name = from.name.replace(/[\r\n"]/g, '');
  const headers = [
    `From: ${/^[\x20-\x7e]*$/.test(name) ? `"${name}"` : encodeWord(name)} <${from.address}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeWord(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(m.html),
    `--${boundary}--`,
  ].join('\r\n');
}

const dotStuff = (s: string) => s.replace(/(^|\r\n)\./g, '$1..');

/** Für Logs: m***@example.org */
export function maskEmail(s: string): string {
  const [local = '', domain = ''] = s.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Mailer der Instanz: log → DATA_DIR/mail.log, smtp → echter Versand (ohne Host: Log mit Warnung). */
export function createMailer(inst: InstanceConfig, dataDir: string, log: Log): Mailer {
  if (inst.mailMode === 'log') return new LogMailer(path.join(dataDir, 'mail.log'), log);
  if (!inst.smtp.host) {
    if (inst.auth === 'local') {
      log(
        'Kein STACHEL_SMTP_HOST: E-Mails gehen nicht raus, sie stehen samt Links hier im Log und in DATA_DIR/mail.log' +
          (inst.requireVerification
            ? ' (E-Mail-Bestätigung ist an: Konten mit `stachel-admin verify <email>` freischalten)'
            : ' (Konten sind ohne Bestätigung sofort aktiv, STACHEL_REQUIRE_VERIFICATION)'),
      );
    }
    return new LogMailer(path.join(dataDir, 'mail.log'), log, true);
  }
  return new SmtpMailer(inst.smtp, inst.brand, log);
}
