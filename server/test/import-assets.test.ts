// SSRF-Schutz und Prüfungen beim Laden von Miro-Dateien (server/src/import/assets.ts).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssetError, hostAllowed, isPrivateAddress, MIRO_FILE_HOSTS, processAsset, safeDownload } from '../src/import/assets.js';
import { tinyPdf, tinyPng } from './fake-miro.js';

let server: http.Server;
let host = '';
const hits: string[] = [];

beforeAll(async () => {
  const png = await tinyPng();
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/ok.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png);
    }
    if (u.pathname === '/big') {
      res.writeHead(200, { 'Content-Type': 'image/png' }); // ohne Content-Length: Grenze beim Lesen
      res.write(Buffer.alloc(64 * 1024));
      res.write(Buffer.alloc(64 * 1024));
      return res.end(Buffer.alloc(64 * 1024));
    }
    if (u.pathname === '/declared-big') {
      res.writeHead(200, { 'Content-Length': String(10 * 1024 * 1024) });
      return res.end();
    }
    if (u.pathname === '/to-evil') {
      res.writeHead(302, { Location: 'https://evil.example.com/x.png' });
      return res.end();
    }
    if (u.pathname === '/to-private') {
      res.writeHead(302, { Location: 'https://files.miro.com/x.png' });
      return res.end();
    }
    if (u.pathname.startsWith('/loop')) {
      const n = Number(u.pathname.slice(5) || 0);
      res.writeHead(302, { Location: `/loop${n + 1}` });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const base = { hosts: MIRO_FILE_HOSTS, maxBytes: 100 * 1024 };

describe('Hosts und Adressen', () => {
  it('Hostliste mit *.', () => {
    expect(hostAllowed('api.miro.com', MIRO_FILE_HOSTS)).toBe(true);
    expect(hostAllowed('files.eu.miro.com', MIRO_FILE_HOSTS)).toBe(true);
    expect(hostAllowed('miro.com.evil.example', MIRO_FILE_HOSTS)).toBe(false);
    expect(hostAllowed('evilmiro.com', MIRO_FILE_HOSTS)).toBe(false);
    expect(hostAllowed('miro.medium.com', MIRO_FILE_HOSTS)).toBe(false);
    expect(hostAllowed('cdn.example.org', ['*.example.org'])).toBe(true);
  });

  it('private, Loopback, Link-local, CGNAT, ULA, eingebettetes IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '52.1.2.3', '2a00:1450:4001::1', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(isPrivateAddress('kein-ip')).toBe(true);
  });
});

describe('safeDownload', () => {
  it('lädt von einem erlaubten Entwicklungs-Host', async () => {
    const r = await safeDownload(`http://${host}/ok.png`, { ...base, devHosts: [host] });
    expect(r.buf.length).toBeGreaterThan(20);
  });

  it('fremder Host, http und Zugangsdaten in der Adresse → host', async () => {
    for (const u of ['https://evil.example.com/a.png', `http://${host}/ok.png`, 'http://files.miro.com/a.png', 'https://user:pw@files.miro.com/a.png', 'ftp://files.miro.com/x']) {
      const e = await safeDownload(u, base).catch((x) => x);
      expect(e, u).toBeInstanceOf(AssetError);
      expect(e.reason, u).toBe('host');
    }
  });

  it('erlaubter Name, aber private Adresse (DNS) → private, ohne Verbindung', async () => {
    const before = hits.length;
    for (const addr of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fd00::5']) {
      const e = await safeDownload('https://files.miro.com/x.png', { ...base, resolve: async () => [{ address: addr, family: addr.includes(':') ? 6 : 4 }] }).catch((x) => x);
      expect(e.reason, addr).toBe('private');
    }
    // eine öffentliche und eine private Antwort: ebenfalls abgelehnt (DNS-Rebinding)
    const e = await safeDownload('https://files.miro.com/x.png', {
      ...base,
      resolve: async () => [
        { address: '52.1.2.3', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    }).catch((x) => x);
    expect(e.reason).toBe('private');
    // IP-Literal in der Adresse
    expect((await safeDownload('https://127.0.0.1/x.png', { ...base, hosts: ['127.0.0.1'] }).catch((x) => x)).reason).toBe('private');
    expect(hits.length).toBe(before);
  });

  it('Weiterleitung auf fremden Host bzw. privaten Host wird neu geprüft und abgelehnt', async () => {
    expect((await safeDownload(`http://${host}/to-evil`, { ...base, devHosts: [host] }).catch((x) => x)).reason).toBe('host');
    const e = await safeDownload(`http://${host}/to-private`, { ...base, devHosts: [host], resolve: async () => [{ address: '192.168.0.10', family: 4 }] }).catch((x) => x);
    expect(e.reason).toBe('private');
  });

  it('höchstens 3 Weiterleitungen', async () => {
    expect((await safeDownload(`http://${host}/loop0`, { ...base, devHosts: [host] }).catch((x) => x)).reason).toBe('redirect');
  });

  it('zu groß (angekündigt und beim Lesen)', async () => {
    expect((await safeDownload(`http://${host}/big`, { ...base, devHosts: [host] }).catch((x) => x)).reason).toBe('too_large');
    expect((await safeDownload(`http://${host}/declared-big`, { ...base, devHosts: [host] }).catch((x) => x)).reason).toBe('too_large');
  });

  it('HTTP-Fehler → http', async () => {
    expect((await safeDownload(`http://${host}/nope`, { ...base, devHosts: [host] }).catch((x) => x)).reason).toBe('http');
  });
});

describe('processAsset', () => {
  it('PNG ok, ohne Metadaten', async () => {
    const r = await processAsset(await tinyPng(10, 8), 'image', 1e7);
    expect(r).toMatchObject({ mime: 'image/png', width: 10, height: 8 });
  });

  it('falscher Typ: Text als Bild, Bild als Dokument', async () => {
    expect((await processAsset(Buffer.from('<html>hallo</html>'), 'image', 1e7).catch((x) => x)).reason).toBe('type');
    expect((await processAsset(await tinyPng(), 'document', 1e7).catch((x) => x)).reason).toBe('type');
    expect((await processAsset(tinyPdf(), 'document', 1e7)).mime).toBe('application/pdf');
  });

  it('SVG wird als PNG gerastert', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#c9e14a"/></svg>');
    const r = await processAsset(svg, 'image', 1e7);
    expect(r.mime).toBe('image/png');
    expect(r.converted).toBe(true);
    expect(r.width).toBeGreaterThan(0);
  });

  it('zu viele Pixel', async () => {
    // PNG-Kopf mit 30000 × 30000 (nur Kopf, Pixel-Grenze greift vor dem Dekodieren)
    const big = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
    const hacked = Buffer.from(big);
    hacked.writeUInt32BE(30_000, 16);
    hacked.writeUInt32BE(30_000, 20);
    expect((await processAsset(hacked, 'image', 1e7).catch((x) => x)).reason).toBe('pixels');
  });
});
