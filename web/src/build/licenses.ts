// Build-Werkzeug (nicht Teil der Web-App): Vite-Plugin, das `licenses.txt` in den Build legt – Lizenzen aller npm-Pakete,
// deren Module im Bündel landen, plus Schriften (OFL), lucide (ISC + MIT/Feather) und die Hilfsdateien von pdf.js
// (Liberation Sans GPL-2.0 mit Font-Ausnahme, Foxit, Adobe-CMaps, WebAssembly-Dekoder). Erreichbar unter
// `<Basis>/licenses.txt` (Link „Lizenzen“ im Fuß), docs/legal/lizenzen.md §5.3.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const LICENSES_FILE = 'licenses.txt';

const SOURCE_SERIF_COPYRIGHT =
  'Copyright 2014 - 2023 Adobe (http://www.adobe.com/), with Reserved Font Name ‘Source’. All Rights Reserved. Source is a trademark of Adobe in the United States and/or other countries.';

/** Fontsource nennt bei Source Serif 4 fälschlich „Google Inc.“ als Rechteinhaber – richtig ist Adobe (RFN „Source“). */
const fixSourceSerif = (t: string) => t.replace(/^Google Inc\.\s*$/m, SOURCE_SERIF_COPYRIGHT);

export interface LicenseSection {
  /** Überschrift, z. B. `react 19.3.1 (MIT)` */
  title: string;
  /** Quelle (Repository/Homepage), optional */
  source?: string;
  text: string;
}

/** Wurzel des npm-Pakets einer Modul-ID (`…/node_modules/@scope/name/…`, auch verschachtelt), sonst null. */
export function packageRootOf(id: string): string | null {
  const p = id.replace(/^\0/, '').split('?')[0]!.replace(/\\/g, '/');
  const re = /\/node_modules\/((?:@[^/]+\/)?[^/]+)/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(p); m; m = re.exec(p)) last = m;
  if (!last) return null;
  return p.slice(0, last.index + last[0].length);
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function repoOf(pkg: Record<string, unknown>): string | undefined {
  const r = pkg.repository;
  const url = typeof r === 'string' ? r : r && typeof r === 'object' ? (r as { url?: unknown }).url : undefined;
  if (typeof url === 'string' && url) return url.replace(/^git\+/, '');
  return typeof pkg.homepage === 'string' ? pkg.homepage : undefined;
}

function licenseOf(pkg: Record<string, unknown>): string {
  const l = pkg.license;
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && typeof (l as { type?: unknown }).type === 'string') return (l as { type: string }).type;
  return 'unbekannt';
}

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();

/** Abschnitt eines npm-Pakets (null = kein package.json mit Namen). */
export function packageSection(root: string): LicenseSection | null {
  const pkg = readJson(join(root, 'package.json'));
  if (!pkg || typeof pkg.name !== 'string') return null;
  const license = licenseOf(pkg);
  let files: string[] = [];
  try {
    files = readdirSync(root).filter((f) => LICENSE_FILE.test(f)).sort();
  } catch {
    /* kein Verzeichnis */
  }
  let text = files.length ? files.map((f) => read(join(root, f))).join('\n\n') : `Lizenztext: siehe ${license} (kein Text im Paket)`;
  if (pkg.name === '@fontsource/source-serif-4') text = fixSourceSerif(text);
  return { title: `${pkg.name} ${String(pkg.version ?? '')} (${license})`.replace('  ', ' '), source: repoOf(pkg), text };
}

/**
 * Feste Abschnitte, die nicht (zuverlässig) als Module im Bündel auftauchen: Schriften, Icons, pdf.js-Hilfsdateien.
 * `nm` = node_modules der Web-App; fehlende Dateien werden übersprungen.
 */
export function fixedSections(nm: string): LicenseSection[] {
  const out: LicenseSection[] = [];
  const add = (title: string, file: string, source?: string, fix?: (t: string) => string) => {
    if (!existsSync(file)) return;
    const t = read(file);
    out.push({ title, source, text: fix ? fix(t) : t });
  };
  const fonts: [string, string, string][] = [
    ['barlow', 'Barlow', 'https://github.com/jpt/barlow'],
    ['barlow-condensed', 'Barlow Condensed', 'https://github.com/jpt/barlow'],
    ['source-serif-4', 'Source Serif 4', 'https://github.com/adobe-fonts/source-serif'],
    ['jetbrains-mono', 'JetBrains Mono', 'https://github.com/JetBrains/JetBrainsMono'],
  ];
  for (const [dir, name, source] of fonts) {
    add(`Schrift ${name} (SIL Open Font License 1.1, über @fontsource/${dir})`, join(nm, '@fontsource', dir, 'LICENSE'), source, (t) =>
      dir === 'source-serif-4' ? fixSourceSerif(t) : t,
    );
  }
  add('Icons lucide (ISC; Icons aus Feather: MIT, © Cole Bemis)', join(nm, 'lucide', 'LICENSE'), 'https://github.com/lucide-icons/lucide');
  const pdf = join(nm, 'pdfjs-dist');
  add(
    'pdf.js-Standardschrift Liberation Sans (GNU General Public License v2 mit Font-Ausnahme, Red Hat)',
    join(pdf, 'standard_fonts', 'LICENSE_LIBERATION'),
    'https://github.com/liberationfonts/liberation-fonts',
  );
  add('pdf.js-Standardschriften Foxit (BSD-3-Clause, PDFium Authors)', join(pdf, 'standard_fonts', 'LICENSE_FOXIT'), 'https://pdfium.googlesource.com/pdfium/');
  add('pdf.js-Zeichensatztabellen Adobe CMaps (BSD-3-Clause)', join(pdf, 'cmaps', 'LICENSE'), 'https://github.com/adobe-type-tools/cmap-resources');
  let wasm: string[] = [];
  try {
    wasm = readdirSync(join(pdf, 'wasm')).filter((f) => f.startsWith('LICENSE_')).sort();
  } catch {
    /* ältere pdf.js */
  }
  for (const f of wasm) add(`pdf.js-WebAssembly-Dekoder ${f.slice('LICENSE_'.length)}`, join(pdf, 'wasm', f));
  return out;
}

/** Ganze Datei: Kopf, feste Abschnitte, dann alle Pakete des Bündels (nach Name sortiert, je name@version einmal). */
export function buildLicenseText(moduleIds: Iterable<string>, nm: string): { text: string; packages: number } {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const r = packageRootOf(id);
    if (r) roots.add(r);
  }
  const byKey = new Map<string, LicenseSection>();
  for (const r of roots) {
    const s = packageSection(r);
    if (s && !byKey.has(s.title)) byKey.set(s.title, s);
  }
  const pkgs = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
  const line = '='.repeat(78);
  const render = (s: LicenseSection) => [line, s.title, ...(s.source ? [`Quelle: ${s.source}`] : []), line, '', s.text, ''].join('\n');
  const head = [
    'Stachel – Lizenzen der mitgelieferten Software (Web-App)',
    '',
    'Stachel selbst steht unter der Apache License 2.0, © 2026 Göran Hegenberg (INTSODE).',
    'Die Web-App enthält die folgenden Schriften, Icons, Hilfsdateien und npm-Pakete Dritter.',
    'Diese Datei wird bei jedem Build aus dem tatsächlichen Bündel erzeugt.',
    '',
  ].join('\n');
  const fixed = fixedSections(nm);
  const text = [head, '## Schriften, Icons und pdf.js-Hilfsdateien', '', ...fixed.map(render), `## npm-Pakete im Bündel (${pkgs.length})`, '', ...pkgs.map(render)].join('\n');
  return { text, packages: pkgs.length };
}

/** Vite-Plugin: legt `licenses.txt` (fester Name) als Asset in den Build – vor `closeBundle`, also mit vorkomprimiert. */
export function licensesPlugin(nodeModules: string): Plugin {
  return {
    name: 'stachel-licenses',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const ids: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') ids.push(...item.moduleIds);
      }
      this.emitFile({ type: 'asset', fileName: LICENSES_FILE, source: buildLicenseText(ids, nodeModules).text });
    },
  };
}
