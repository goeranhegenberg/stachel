// Rechtstexte der Instanz als eigene Seiten (docs/features/legal-pages.md): Impressum, Datenschutzerklärung,
// Nutzungsbedingungen. Stachel liefert KEINE Texte mit – wer eine Instanz betreibt, legt seine eigenen als HTML-Fragmente
// in einen Ordner (STACHEL_LEGAL_DIR, Standard `<DATA_DIR>/legal`, im Container `/data/legal`):
//   impressum.html → /impressum, datenschutz.html → /datenschutz, nutzungsbedingungen.html → /nutzungsbedingungen
// Fehlt eine Datei, gibt es die Seite nicht (404) – dann zeigt die Instanz wie bisher nur die Links aus
// STACHEL_IMPRINT_URL / STACHEL_PRIVACY_URL / STACHEL_TERMS_URL. Liegt eine Datei vor und ist die passende Variable leer,
// verlinken Fuß, Registrierung, Apps und Mails automatisch die eigene Seite (`applyLegalDefaults`).
// Vorlagen mit Platzhaltern: deploy/legal-templates/. Die Seiten sind statisch, ohne Anmeldung, ohne Skripte und ohne
// fremde Quellen (Schriften von /qr-fonts); unter dem Pfad der Web-App (`/app/impressum`) leiten sie zur Wurzel weiter.
// Platzhalter in den Dateien: {{BRAND}} {{ORIGIN}} {{APP_URL}} {{IMPRINT_URL}} {{PRIVACY_URL}} {{TERMS_URL}}
// {{DELETE_URL}} {{TERMS_VERSION}}. Dateien werden bei Änderung (mtime) neu gelesen, ein Neustart ist nicht nötig.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BRAND } from '../../shared/protocol.js';
import type { InstanceConfig } from './instance.js';

export type LegalSlug = 'impressum' | 'datenschutz' | 'nutzungsbedingungen';

export interface LegalPageDef {
  slug: LegalSlug;
  title: string;
  /** Feld in InstanceConfig, das auf die Seite zeigt */
  key: 'imprintUrl' | 'privacyUrl' | 'termsUrl';
}

export const LEGAL_PAGES: readonly LegalPageDef[] = [
  { slug: 'impressum', title: 'Impressum', key: 'imprintUrl' },
  { slug: 'datenschutz', title: 'Datenschutzerklärung', key: 'privacyUrl' },
  { slug: 'nutzungsbedingungen', title: 'Nutzungsbedingungen', key: 'termsUrl' },
];

/** Seite zum Löschen des Kontos (forget-routes.ts), im Fuß aller Rechtsseiten verlinkt */
export const DELETION_SLUG = 'konto-loeschen';

/** Pfadteile, die als STACHEL_BASE_PATH nicht in Frage kommen (config.ts) */
export const LEGAL_RESERVED = [...LEGAL_PAGES.map((p) => p.slug), DELETION_SLUG];

export const legalFile = (dir: string, slug: LegalSlug) => path.join(dir, `${slug}.html`);

/** Ordner der Rechtstexte: STACHEL_LEGAL_DIR oder `<DATA_DIR>/legal`. */
export function legalDirOf(env: NodeJS.ProcessEnv, dataDir: string): string {
  const v = (env.STACHEL_LEGAL_DIR ?? '').trim();
  return v ? path.resolve(v) : path.join(dataDir, 'legal');
}

/**
 * Leere Link-Variablen der Instanz auf die eigene Seite setzen, wenn der Text dafür im Ordner liegt (so verlinken Fuß,
 * Registrierung, Apps und Mails die Seite ohne zusätzliche Einstellung). Gesetzte Variablen haben Vorrang.
 */
export function applyLegalDefaults(instance: InstanceConfig, publicUrl: string, dir: string): InstanceConfig {
  const out = { ...instance };
  for (const p of LEGAL_PAGES) {
    if (!out[p.key] && fs.existsSync(legalFile(dir, p.slug))) out[p.key] = `${publicUrl}/${p.slug}`;
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface LegalFrameOptions {
  brand: string;
  /** Text im <title> */
  title: string;
  /** fertiges HTML des Hauptteils */
  body: string;
  /** fertiges HTML des Fußes (Links) */
  footer: string;
  /** längere Texte: Tabellen, Zwischenüberschriften h3 */
  prose?: boolean;
}

/** Gemeinsamer Rahmen der statischen Seiten (Konto löschen, Rechtstexte): schwarz, Barlow von /qr-fonts, kein JS. */
export function legalFrame(o: LegalFrameOptions): string {
  const brand = esc(o.brand || 'Stachel');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${BRAND.black}">
<title>${esc(o.title)} – ${brand}</title>
<style>
@font-face { font-family: 'Barlow'; font-weight: 400; font-display: swap; src: url(/qr-fonts/barlow-400.woff2) format('woff2'); }
@font-face { font-family: 'Barlow'; font-weight: 600; font-display: swap; src: url(/qr-fonts/barlow-600.woff2) format('woff2'); }
@font-face { font-family: 'Barlow Condensed'; font-weight: 700; font-display: swap; src: url(/qr-fonts/barlow-condensed-700.woff2) format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body { background: ${BRAND.black}; color: ${BRAND.white}; font-family: 'Barlow', system-ui, sans-serif; font-size: 17px; line-height: 1.55; padding: 32px 16px 48px; overflow-wrap: anywhere; }
main { max-width: ${o.prose ? 760 : 620}px; margin: 0 auto; }
.logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; color: inherit; text-decoration: none; }
.logo span { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 26px; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 44px; line-height: 1; text-transform: uppercase; margin: 0 0 16px; hyphens: auto; }
h1 em { font-style: normal; color: ${BRAND.green}; }
h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 24px; text-transform: uppercase; margin: 28px 0 8px; }
h3 { font-size: 18px; font-weight: 600; margin: 20px 0 6px; }
p, ul { margin: 0 0 16px; color: #e6e6e6; }
ol { margin: 0 0 16px; padding-left: 1.4em; color: #e6e6e6; }
li { margin: 4px 0; }
a { color: ${BRAND.green}; }
strong { color: ${BRAND.white}; }
address { font-style: normal; margin: 0 0 16px; color: #e6e6e6; }
.table { overflow-x: auto; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 15px; color: #e6e6e6; }
th, td { text-align: left; vertical-align: top; border-bottom: 1px solid #333; padding: 6px 10px 6px 0; }
th { font-weight: 600; color: ${BRAND.white}; }
.stand { color: #a6a6a6; font-size: 15px; }
.btn { display: inline-flex; align-items: center; min-height: 48px; padding: 10px 24px; border-radius: 999px; background: ${BRAND.green}; color: ${BRAND.black}; font-weight: 600; text-decoration: none; margin: 8px 0 8px; }
.btn:focus-visible, a:focus-visible { outline: 3px solid ${BRAND.white}; outline-offset: 3px; }
footer { margin-top: 32px; font-size: 15px; color: #a6a6a6; display: flex; flex-wrap: wrap; gap: 6px 16px; }
</style>
</head>
<body>
<main>
  <div class="logo" aria-hidden="true">
    <svg width="30" height="30" viewBox="0 0 32 32"><circle cx="16" cy="9" r="7" fill="${BRAND.pink}"/><path d="M14.5 15h3L16 31z" fill="${BRAND.white}"/></svg>
    <span>${brand}</span>
  </div>
  ${o.body}
  <footer>${o.footer}</footer>
</main>
</body>
</html>`;
}

/** Fuß der statischen Seiten: Impressum · Datenschutz · Nutzungsbedingungen · Konto/Daten löschen · zur App (ohne die aktuelle). */
export function legalFooter(inst: InstanceConfig, appUrl: string, current?: string): string {
  const links: [string, string, string][] = [
    ['impressum', inst.imprintUrl, 'Impressum'],
    ['datenschutz', inst.privacyUrl, 'Datenschutz'],
    ['nutzungsbedingungen', inst.termsUrl, 'Nutzungsbedingungen'],
  ];
  const out = links.filter(([slug, url]) => url && slug !== current).map(([, url, label]) => `<a href="${esc(url)}">${label}</a>`);
  if (current !== DELETION_SLUG) out.push(`<a href="/${DELETION_SLUG}">${inst.auth === 'local' ? 'Konto löschen' : 'Meine Daten löschen'}</a>`);
  out.push(`<a href="${esc(appUrl)}/">Zu ${esc(inst.brand || 'Stachel')}</a>`);
  return out.join('');
}

/** Platzhalter ersetzen (Werte HTML-escaped); unbekannte bleiben stehen. */
export function fillLegal(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? esc(vars[k]!) : m));
}

/** Titel der Seite: Text der ersten <h1> (ohne Tags), sonst der Standardtitel. */
export function titleOf(html: string, fallback: string): string {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = m
    ? m[1]!
        .replace(/<[^>]+>/g, '')
        .replace(/&shy;|\xad/g, '') // weiche Trennstriche gehören nicht in den Titel
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return t || fallback;
}

export interface LegalPagesOptions {
  instance: InstanceConfig;
  dir: string;
  publicUrl: string;
  /** öffentliche Adresse der Web-App (PUBLIC_URL + STACHEL_BASE_PATH) */
  appUrl: string;
  basePath: string;
}

/** Registriert `/impressum`, `/datenschutz`, `/nutzungsbedingungen` (nur mit Datei) und die Weiterleitung unter dem Pfad. */
export function registerLegalPages(app: FastifyInstance, o: LegalPagesOptions) {
  const cache = new Map<LegalSlug, { mtimeMs: number; size: number; html: string }>();
  const vars = {
    BRAND: o.instance.brand || 'Stachel',
    ORIGIN: o.publicUrl,
    APP_URL: `${o.appUrl}/`,
    IMPRINT_URL: o.instance.imprintUrl,
    PRIVACY_URL: o.instance.privacyUrl,
    TERMS_URL: o.instance.termsUrl,
    DELETE_URL: `${o.publicUrl}/${DELETION_SLUG}`,
    TERMS_VERSION: o.instance.termsVersion,
  };
  const render = (p: LegalPageDef): string | null => {
    const file = legalFile(o.dir, p.slug);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      cache.delete(p.slug);
      return null;
    }
    const hit = cache.get(p.slug);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.html;
    const body = fillLegal(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), vars);
    const html = legalFrame({ brand: vars.BRAND, title: titleOf(body, p.title), body, footer: legalFooter(o.instance, o.appUrl, p.slug), prose: true });
    cache.set(p.slug, { mtimeMs: st.mtimeMs, size: st.size, html });
    return html;
  };
  for (const p of LEGAL_PAGES) {
    app.get(`/${p.slug}`, async (_req, reply) => {
      const html = render(p);
      if (html === null) return reply.callNotFound();
      return reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(html);
    });
    // Links von früher bzw. aus der Web-App unter dem Pfad
    if (o.basePath) app.get(`${o.basePath}/${p.slug}`, async (_req, reply) => reply.redirect(`/${p.slug}`, 301));
  }
}
