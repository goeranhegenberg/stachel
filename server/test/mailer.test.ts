// SMTP-Client gegen einen kleinen Fake-SMTP-Server (unverschlüsselt; TLS ist node:tls) und Modus org unverändert.
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMime, parseFrom, SmtpMailer } from '../src/mailer.js';
import { mails } from '../src/mail-templates.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';

interface Session {
  lines: string[];
  data: string;
}

/** Minimaler SMTP-Server: EHLO mit AUTH PLAIN LOGIN, nimmt eine Mail an. */
function fakeSmtp(opts: { onlyLogin?: boolean } = {}) {
  const sessions: Session[] = [];
  const server = net.createServer((sock) => {
    const s: Session = { lines: [], data: '' };
    sessions.push(s);
    let inData = false;
    let buf = '';
    let authStep = 0;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 OK queued\r\n');
          } else s.data += `${line}\r\n`;
          continue;
        }
        s.lines.push(line);
        if (authStep === 1) {
          authStep = 2;
          sock.write('334 UGFzc3dvcmQ6\r\n');
        } else if (authStep === 2) {
          authStep = 0;
          sock.write('235 ok\r\n');
        } else if (line.startsWith('EHLO')) sock.write(`250-fake\r\n250-SIZE 1000000\r\n250 AUTH ${opts.onlyLogin ? 'LOGIN' : 'PLAIN LOGIN'}\r\n`);
        else if (line.startsWith('AUTH PLAIN')) sock.write('235 ok\r\n');
        else if (line === 'AUTH LOGIN') {
          authStep = 1;
          sock.write('334 VXNlcm5hbWU6\r\n');
        } else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('500 ?\r\n');
      }
    });
  });
  return new Promise<{ port: number; sessions: Session[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, sessions, close: () => server.close() })),
  );
}

const ctx = { brand: 'Stachel', publicUrl: 'https://stachel.intsode.com', imprintUrl: 'https://intsode.com/impressum', privacyUrl: '' };

describe('SMTP-Versand', () => {
  it('AUTH PLAIN, Umschlag, MIME (Text + HTML, UTF-8), Punkt-Verdopplung', async () => {
    const smtp = await fakeSmtp();
    const logs: string[] = [];
    const m = new SmtpMailer({ host: '127.0.0.1', port: smtp.port, user: 'noreply@intsode.com', pass: 'geheim', from: 'Stachel <noreply@intsode.com>', secure: 'none' }, 'Stachel', (x) => logs.push(x));
    const msg = mails.verify(ctx, 'mara@example.org', 'Mära', 'https://stachel.intsode.com/?verify=abc');
    await m.send({ ...msg, text: `${msg.text}\n.\nEnde` });
    smtp.close();
    const s = smtp.sessions[0]!;
    expect(s.lines).toContain(`AUTH PLAIN ${Buffer.from('\0noreply@intsode.com\0geheim').toString('base64')}`);
    expect(s.lines).toContain('MAIL FROM:<noreply@intsode.com>');
    expect(s.lines).toContain('RCPT TO:<mara@example.org>');
    expect(s.data).toMatch(/^From: "Stachel" <noreply@intsode.com>\r\n/m);
    expect(s.data).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(s.data).toContain('multipart/alternative');
    const parts = s.data.split(/\r\n\r\n/);
    const decoded = parts.map((p) => Buffer.from(p.split('\r\n--')[0]!.replace(/\r\n/g, ''), 'base64').toString('utf8')).join('\n');
    expect(decoded).toContain('Hallo Mära,');
    expect(decoded).toContain('https://stachel.intsode.com/?verify=abc');
    expect(decoded).toContain('<a href="https://stachel.intsode.com/?verify=abc"');
    expect(logs).toEqual([]);
  });

  it('AUTH LOGIN, wenn der Server nur das kann; Fehler nennen keine Zugangsdaten', async () => {
    const smtp = await fakeSmtp({ onlyLogin: true });
    const m = new SmtpMailer({ host: '127.0.0.1', port: smtp.port, user: 'u@x.de', pass: 'pw', from: 'u@x.de', secure: 'none' }, 'Stachel', () => {});
    await m.send({ to: 'a@example.org', subject: 'Test', text: 'x', html: '<p>x</p>' });
    expect(smtp.sessions[0]!.lines.slice(1, 4)).toEqual(['AUTH LOGIN', Buffer.from('u@x.de').toString('base64'), Buffer.from('pw').toString('base64')]);
    smtp.close();
  });

  it('Header-Injection über die Empfängeradresse geht nicht', async () => {
    const m = new SmtpMailer({ host: '127.0.0.1', port: 1, user: '', pass: '', from: 'a@b.de', secure: 'none' }, 'S', () => {});
    await expect(m.send({ to: 'x@example.org\r\nBcc: y@example.org', subject: 's', text: 't', html: 'h' })).rejects.toThrow(/Empfänger/);
  });

  it('Absender mit Namen, HTML wird escaped', () => {
    expect(parseFrom('Stachel <noreply@intsode.com>')).toEqual({ name: 'Stachel', address: 'noreply@intsode.com' });
    expect(parseFrom('noreply@intsode.com')).toEqual({ name: null, address: 'noreply@intsode.com' });
    const inv = mails.invite(ctx, 'a@example.org', '<b>Mara</b>', 'Plan "A"', 'kann ansehen', 'https://x/?register=1');
    expect(inv.html).toContain('&lt;b&gt;Mara&lt;/b&gt;');
    expect(inv.html).not.toContain('<b>Mara</b>');
    expect(inv.text).toContain('Impressum: https://intsode.com/impressum');
    expect(buildMime(inv, { name: 'Stachel', address: 'n@intsode.com' })).toContain('Auto-Submitted: auto-generated');
  });
});

describe('Modus org bleibt wie bisher', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv();
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('/api/instance meldet org, eigene Konten gibt es nicht, alle sehen alle Boards ohne role', async () => {
    const b = new Browser(env.base);
    expect((await b.get('/api/instance')).body).toMatchObject({ auth: 'org', brand: 'Stachel', registration: null });
    expect((await b.post('/api/auth/register', { email: 'a@b.de' })).status).toBe(404);
    expect((await b.post('/api/auth/login', { email: 'a@b.de', password: 'x' })).status).toBe(404);
    expect((await b.get('/api/auth/captcha')).status).toBe(404);
    expect((await b.post('/api/auth/password', { username: 'orga', password: 'geheim' })).status).toBe(200);
    const board = (await b.post('/api/boards', { title: 'Team' })).body.board;
    const list = (await b.get('/api/boards')).body.boards;
    expect(list.find((x: any) => x.id === board.id).role).toBeUndefined();
    expect((await b.get(`/api/boards/${board.id}/share`)).status).toBe(404);
    expect(env.srv.access.canAccessBoard({ key: 'm:999' }, board.id, 'edit')).toBe(true);
    expect(env.srv.access.canAccessBoard({ key: 'm:999' }, board.id, 'owner')).toBe(false);
    expect(env.srv.access.canAccessBoard({ key: 'm:999', isOrga: true }, board.id, 'owner')).toBe(true);
  });
});
