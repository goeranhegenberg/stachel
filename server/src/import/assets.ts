// Bilder und PDFs aus Miro laden (docs/features/import.md §3 Schritt images), mit SSRF-Schutz:
// 1. Miro-API-Adresse (`data.imageUrl`/`documentUrl`) MIT Token, nur unter der API-Basis, `redirect=false` → JSON `{url}`.
// 2. Signierte Datei-Adresse OHNE Token: nur `https:`, Host aus der Liste (Miro-Hosts + STACHEL_IMPORT_MIRO_HOSTS), DNS
//    aufgelöst und jede Adresse geprüft (privat, Loopback, Link-local, CGNAT, ULA, Multicast …), verbunden wird genau mit
//    der geprüften Adresse (eigenes `lookup`), höchstens 3 Weiterleitungen (jede neu geprüft), Größe beim Lesen begrenzt,
//    30 s Zeitlimit. Ausnahme nur für die Hosts aus STACHEL_IMPORT_MIRO_API_BASE/-AUTH_BASE (Fake-Miro in Tests).
// 3. Prüfungen wie ein Upload: Magic Bytes, Pixel-Grenzen, Metadaten weg (image-clean.ts); SVG/HEIC/TIFF/AVIF/BMP, die
//    sharp lesen kann, als PNG gerastert. Die Speicherquote prüft der Job (jobs.ts) über UploadLimits.fits.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import sharp from 'sharp';
import { sniffImage, type ImageMime } from '../images.js';
import { cleanImage, ImageCleanError } from '../image-clean.js';
import { PDF_MIME, sniffPdf } from '../documents.js';
import { ImportAbortError, type MiroClient } from './miro/client.js';
import type { AssetNeed } from './miro/types.js';

/** wie die Upload-Route (app.ts) */
export const MAX_IMAGE_SIDE = 20_000;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const MAX_REDIRECTS = 3;
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Hosts der Miro-Dateien. Bestätigt im Lauf gegen ein echtes Board: siehe docs/features/import.md §3; weitere über
 * STACHEL_IMPORT_MIRO_HOSTS. (`miro.medium.com` gehört zu Medium, nicht zu Miro – bewusst nicht in der Liste.)
 */
export const MIRO_FILE_HOSTS: readonly string[] = ['api.miro.com', 'miro.com', '*.miro.com', '*.miro.app', '*.miroassets.com', '*.mirostatic.com'];

export type AssetFailure = 'host' | 'private' | 'redirect' | 'too_large' | 'http' | 'timeout' | 'type' | 'pixels' | 'broken' | 'quota' | 'limit';

export class AssetError extends Error {
  constructor(readonly reason: AssetFailure) {
    super(`Datei nicht übernommen (${reason})`);
    this.name = 'AssetError';
  }
}

/** `host` passt zu einem Muster (`name` exakt, `*.name` = jede Unterdomain). */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return patterns.some((p) => {
    const q = p.toLowerCase().trim();
    if (!q) return false;
    if (q.startsWith('*.')) {
      const base = q.slice(2);
      return h.endsWith(`.${base}`) && h.length > base.length + 1;
    }
    return h === q;
  });
}

const BLOCKED = (() => {
  const b = new net.BlockList();
  for (const [a, p] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const)
    b.addSubnet(a, p, 'ipv4');
  for (const [a, p] of [
    ['::', 128],
    ['::1', 128],
    ['100::', 64],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
  ] as const)
    b.addSubnet(a, p, 'ipv6');
  return b;
})();

/** Darf der Import diese Adresse NICHT ansprechen? (privat, Loopback, Link-local, CGNAT, ULA, Multicast, Doku-Netze …) */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return BLOCKED.check(ip, 'ipv4');
  if (v !== 6) return true;
  const low = ip.toLowerCase();
  // IPv4 in IPv6 (::ffff:a.b.c.d, ::ffff:xxxx:xxxx, NAT64 64:ff9b::/96): die IPv4-Adresse zählt
  const embedded = embeddedV4(low);
  if (embedded) return BLOCKED.check(embedded, 'ipv4');
  return BLOCKED.check(low, 'ipv6');
}

function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::|::ffff:0:)(.+)$/.exec(ip) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (!m) return null;
  const rest = m[1]!;
  if (net.isIPv4(rest)) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return null;
  const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export interface DownloadOptions {
  /** erlaubte Hosts (Muster wie hostAllowed) */
  hosts: readonly string[];
  /** `host:port` aus STACHEL_IMPORT_MIRO_*_BASE: auch http und lokale Adressen (nur Tests/Entwicklung) */
  devHosts?: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** DNS (Tests) */
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
}

const defaultResolve = (host: string) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Datei über eine fremde Adresse laden (ohne Token), siehe Kopf. */
export async function safeDownload(url: string, o: DownloadOptions): Promise<{ buf: Buffer; contentType: string }> {
  const timeout = AbortSignal.timeout(o.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(current, o, signal);
    if (res.kind === 'redirect') {
      if (hop === MAX_REDIRECTS) throw new AssetError('redirect');
      try {
        current = new URL(res.location, current).toString();
      } catch {
        throw new AssetError('redirect');
      }
      continue;
    }
    return res;
  }
  throw new AssetError('redirect');
}

async function fetchOnce(
  raw: string,
  o: DownloadOptions,
  signal: AbortSignal,
): Promise<{ kind: 'redirect'; location: string } | { kind: 'file'; buf: Buffer; contentType: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AssetError('host');
  }
  const dev = (o.devHosts ?? []).includes(u.host.toLowerCase());
  if (u.username || u.password) throw new AssetError('host');
  if (u.protocol !== 'https:' && !(dev && u.protocol === 'http:')) throw new AssetError('host');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!dev && !hostAllowed(host, o.hosts)) throw new AssetError('host');
  // Adresse festlegen und prüfen; verbunden wird genau mit ihr
  let target: { address: string; family: number };
  if (net.isIP(host)) target = { address: host, family: net.isIP(host) };
  else {
    let list: { address: string; family: number }[];
    try {
      list = await (o.resolve ?? defaultResolve)(host);
    } catch {
      if (signal.aborted) throw abortReason(o.signal);
      throw new AssetError('http');
    }
    if (!list.length) throw new AssetError('http');
    // alle Antworten müssen öffentlich sein (sonst wechselt ein zweiter Abruf ggf. auf eine interne Adresse)
    if (!dev && list.some((a) => isPrivateAddress(a.address))) throw new AssetError('private');
    target = list[0]!;
  }
  if (!dev && isPrivateAddress(target.address)) throw new AssetError('private');

  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: host,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: { Accept: '*/*', 'User-Agent': 'Stachel-Import', Host: u.host },
        signal,
        ...(u.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        }) as unknown as typeof dns.lookup,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const loc = res.headers.location;
          res.resume();
          if (typeof loc !== 'string' || !loc) return reject(new AssetError('redirect'));
          return resolve({ kind: 'redirect', location: loc });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new AssetError('http'));
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > o.maxBytes) {
          res.destroy();
          return reject(new AssetError('too_large'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            res.destroy();
            req.destroy();
            reject(new AssetError('too_large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ kind: 'file', buf: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? '') }));
        res.on('error', () => reject(signal.aborted ? abortReason(o.signal) : new AssetError('http')));
      },
    );
    req.on('error', () => reject(signal.aborted ? abortReason(o.signal) : new AssetError('http')));
    req.end();
  });
}

function abortReason(jobSignal: AbortSignal | undefined): Error {
  return jobSignal?.aborted ? new ImportAbortError() : new AssetError('timeout');
}

export interface ProcessedAsset {
  kind: 'image' | 'document';
  mime: ImageMime | typeof PDF_MIME;
  width: number;
  height: number;
  buf: Buffer;
  /** aus SVG/HEIC/TIFF … gerastert */
  converted?: boolean;
}

/** Prüfungen wie ein Upload (Magic Bytes, Pixel, Metadaten); andere Bildformate als PNG, wenn sharp sie lesen kann. */
export async function processAsset(buf: Buffer, kind: 'image' | 'document', maxBytes: number): Promise<ProcessedAsset> {
  if (kind === 'document') {
    if (!sniffPdf(buf)) throw new AssetError('type');
    return { kind, mime: PDF_MIME, width: 0, height: 0, buf };
  }
  let info = sniffImage(buf);
  let converted = false;
  if (!info) {
    try {
      const img = sharp(buf, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error', density: 144 });
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new Error('ohne Maße');
      buf = await img.rotate().png().toBuffer();
      info = sniffImage(buf);
      converted = true;
    } catch {
      throw new AssetError('type');
    }
    if (!info) throw new AssetError('type');
  }
  if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE || info.width * info.height > MAX_IMAGE_PIXELS) throw new AssetError('pixels');
  try {
    const clean = await cleanImage(buf, info);
    if (clean.buf.length > maxBytes) throw new AssetError('too_large');
    return { kind, mime: clean.info.mime, width: clean.info.width, height: clean.info.height, buf: clean.buf, ...(converted ? { converted } : {}) };
  } catch (e) {
    if (e instanceof AssetError) throw e;
    if (e instanceof ImageCleanError) throw new AssetError('broken');
    throw new AssetError('broken');
  }
}

/** Miro-API-Adresse eines Bildes/Dokuments → signierte Datei-Adresse (mit Token, nur API-Basis). */
export async function resolveAssetUrl(client: MiroClient, need: AssetNeed): Promise<string> {
  let api: URL;
  try {
    api = client.url(need.apiUrl);
  } catch {
    throw new AssetError('host');
  }
  if (need.kind === 'image') api.searchParams.set('format', 'original');
  api.searchParams.set('redirect', 'false');
  const res = (await client.get(api.toString())) as { url?: unknown };
  if (typeof res?.url !== 'string' || !res.url) throw new AssetError('broken');
  return res.url;
}

/** Eine Datei vollständig laden und prüfen; eine abgelaufene signierte Adresse (403) wird einmal neu geholt. */
export async function loadAsset(client: MiroClient, need: AssetNeed, o: DownloadOptions): Promise<ProcessedAsset> {
  for (let attempt = 0; ; attempt++) {
    const url = await resolveAssetUrl(client, need);
    try {
      const { buf } = await safeDownload(url, o);
      return await processAsset(buf, need.kind, o.maxBytes);
    } catch (e) {
      if (attempt === 0 && e instanceof AssetError && e.reason === 'http') continue;
      throw e;
    }
  }
}
