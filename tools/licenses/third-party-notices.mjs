// Erzeugt THIRD_PARTY_NOTICES (Repo-Wurzel; landet in beiden Images unter /usr/share/doc/stachel/) aus dem, was
// tatsächlich ausgeliefert wird:
//   - npm-Pakete der Images stachel (server) und stachel-mcp (mcp): tools/licenses/collect-images.sh
//   - Web-Bündel: licenses.txt, die das Vite-Plugin web/src/build/licenses.ts aus dem echten Bündel schreibt
//   - Flutter-App: Pub-Pakete ohne dev-Abhängigkeiten (flutter pub deps + .dart_tool/package_config.json)
//   - Bestandteile ohne Paketverwaltung: tools/licenses/components.json (libvips-Bibliotheken, Schriften, PDFium,
//     Chromium, Node.js, Debian, Flutter-Engine) mit Texten aus tools/licenses/texts/ bzw. dem Repo
// Ablauf und Befehle: docs/open_source/publish.md („THIRD_PARTY_NOTICES erzeugen“). Ohne Abhängigkeiten, Node ≥ 22.
//
//   node tools/licenses/third-party-notices.mjs [--collected tools/licenses/.collected] [--flutter flutter/app]
//        [--out THIRD_PARTY_NOTICES] [--images "ghcr.io/goeranhegenberg/stachel:1.0.0, …"]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const COLLECTED = path.resolve(ROOT, args.collected ?? 'tools/licenses/.collected');
const FLUTTER_APP = path.resolve(ROOT, args.flutter ?? 'flutter/app');
const OUT = path.resolve(ROOT, args.out ?? 'THIRD_PARTY_NOTICES');
const TEXTS = path.join(ROOT, 'tools/licenses/texts');
const LINE = '='.repeat(100);
const DASH = '-'.repeat(100);

const read = (f) => fs.readFileSync(f, 'utf8').replace(new RegExp('^' + String.fromCharCode(0xfeff)), '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const LICENSE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotices)([.-].*)?$/i;

/** @type {Map<string, {name:string, version:string, license:string, source?:string, parts:Set<string>, texts:string[], note?:string}>} */
const components = new Map();
function add({ name, version = '', license, source, parts, texts, note }) {
  const key = `${name}@${version}`;
  const c = components.get(key);
  if (c) {
    for (const p of parts) c.parts.add(p);
    return;
  }
  components.set(key, { name, version, license, source, parts: new Set(parts), texts: texts.filter(Boolean), note });
}

// ---------- npm (aus den Images) ----------
function repoOf(pkg) {
  const r = pkg.repository;
  const url = typeof r === 'string' ? r : r?.url;
  if (typeof url === 'string' && url) return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  return typeof pkg.homepage === 'string' ? pkg.homepage : undefined;
}
function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
/** Paketwurzeln in einem gesammelten node_modules-Abzug: `<name>/` bzw. `@scope/name/`, auch verschachtelt. */
function npmPackages(nm) {
  const re = /^(?:(?:@[^/]+\/)?[^/@][^/]*\/node_modules\/)*(?:@[^/]+\/)?[^/]+\/package\.json$/;
  return walk(nm)
    .map((f) => path.relative(nm, f).replace(/\\/g, '/'))
    .filter((r) => re.test(r))
    .map((r) => path.join(nm, path.dirname(r)));
}
function addNpm(nm, part, overrides = {}) {
  if (!fs.existsSync(nm)) throw new Error(`${nm} fehlt – erst tools/licenses/collect-images.sh ausführen`);
  for (const dir of npmPackages(nm)) {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg?.name || !pkg.version) continue;
    const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
    const license = licenseOf(pkg);
    const o = overrides[pkg.name];
    add({
      name: pkg.name,
      version: pkg.version,
      license,
      source: repoOf(pkg),
      parts: [part],
      texts: files.length ? files.map((f) => read(path.join(dir, f))) : o?.texts ?? [],
      note: files.length ? undefined : o?.note ?? `The package contains no license file; ${license} applies (standard text in section 5).`,
    });
  }
}

// ---------- Web-Bündel (licenses.txt aus dem Image) ----------
function addWeb(file) {
  const t = read(file);
  const re = new RegExp(`^={78}\\n(.+)\\n(?:Quelle: (.+)\\n)?={78}\\n\\n([\\s\\S]*?)(?=\\n={78}\\n|\\n## |$)`, 'gm');
  let n = 0;
  for (const m of t.matchAll(re)) {
    const [, title, source, text] = m;
    // npm-Abschnitt „name version (lizenz)“; feste Abschnitte (Schriften, pdf.js-Dateien) haben keine Versionsnummer
    const pm = /^(\S+) (\d\S*) \((.+)\)$/.exec(title);
    if (pm) add({ name: pm[1], version: pm[2], license: pm[3], source, parts: ['web'], texts: [text.trim()] });
    else add({ name: title.replace(/^(Schrift|Schriften) /, 'Font ').replace(/^pdf\.js-/, 'pdf.js '), license: '(see text)', source, parts: ['web'], texts: [text.trim()] });
    n++;
  }
  if (n < 10) throw new Error(`${file}: nur ${n} Abschnitte erkannt`);
}

// ---------- Flutter-App (Pub) ----------
function guessLicense(t) {
  if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(t)) return /Redistribution and use in source and binary forms/.test(t) ? 'Apache-2.0 AND BSD-3-Clause' : 'Apache-2.0';
  if (/Mozilla Public License,? (version|v\.?) ?2\.0/i.test(t)) return 'MPL-2.0';
  if (/Neither the name/i.test(t)) return 'BSD-3-Clause';
  if (/Redistribution and use in source and binary forms/.test(t)) return 'BSD-2-Clause';
  if (/Permission is hereby granted, free of charge/.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute/.test(t)) return 'ISC';
  return '(see text)';
}
function addFlutter(appDir) {
  const cfg = readJson(path.join(appDir, '.dart_tool/package_config.json'));
  if (!cfg) throw new Error(`${appDir}/.dart_tool/package_config.json fehlt – erst „flutter pub get“ in ${appDir}`);
  const deps = JSON.parse(
    execFileSync(process.platform === 'win32' ? 'flutter.bat' : 'flutter', ['pub', 'deps', '--json'], {
      cwd: appDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/^[^{]*/, ''),
  );
  const byName = new Map(deps.packages.map((p) => [p.name, p]));
  const root = deps.packages.find((p) => p.kind === 'root');
  // Abschluss über die Nicht-dev-Abhängigkeiten der App (dev-Abhängigkeiten der Pfad-Pakete stehen nicht im Graph)
  const seen = new Set();
  const todo = [...root.directDependencies];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    todo.push(...(byName.get(n)?.dependencies ?? []));
  }
  const rootUri = new Map(cfg.packages.map((p) => [p.name, p.rootUri]));
  let sdkVersion = '';
  for (const n of [...seen].sort()) {
    const p = byName.get(n);
    if (!p || p.source === 'path' || p.source === 'root') continue; // eigener Code (stachel_board, stachel_client)
    if (p.source === 'sdk') {
      sdkVersion ||= deps.sdks?.find((s) => s.name === 'Flutter')?.version ?? '';
      continue;
    }
    const uri = rootUri.get(n);
    const dir = fileURLToPath(new URL(uri.endsWith('/') ? uri : `${uri}/`, pathToFileURL(path.join(appDir, '.dart_tool/')).href));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort() : [];
    const texts = files.map((f) => read(path.join(dir, f)));
    add({
      name: n,
      version: p.version,
      license: guessLicense(texts.join('\n')),
      source: `https://pub.dev/packages/${n}/versions/${p.version}`,
      parts: ['flutter_app'],
      texts,
      note: files.length ? undefined : 'No license file in the package – see pub.dev.',
    });
  }
  return { packages: seen.size, sdkVersion };
}

// ---------- feste Bestandteile ----------
function addComponents(facts, sharpLibvipsVersions) {
  const spec = readJson(path.join(ROOT, 'tools/licenses/components.json'));
  const vars = {
    node: facts.stachel.node,
    debian: facts.stachel.debian,
    chromium: '',
    chromiumRevision: '',
    chromiumLicense: facts.mcp.chromiumLicense,
  };
  const shell = facts.mcp.playwrightBrowsers?.browsers?.find((b) => b.name === 'chromium-headless-shell');
  if (shell) {
    vars.chromium = shell.browserVersion;
    vars.chromiumRevision = shell.revision;
  }
  const subst = (s) => s?.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  for (const c of spec.components) {
    add({
      name: subst(c.name),
      version: subst(c.version ?? ''),
      license: c.license,
      source: subst(c.source),
      parts: c.parts,
      texts: (c.files ?? []).map((f) => {
        const p = path.join(ROOT, f);
        if (!fs.existsSync(p)) throw new Error(`components.json: ${f} fehlt`);
        return read(p);
      }),
      note: subst(c.note),
    });
  }
  // Bibliotheken in @img/sharp-libvips-linux-* (Versionen aus dessen versions.json, Texte aus fetch-texts.sh)
  for (const [lib, meta] of Object.entries(spec.libvips)) {
    const version = sharpLibvipsVersions[lib];
    if (!version) throw new Error(`versions.json von sharp-libvips kennt ${lib} nicht mehr – components.json anpassen`);
    const f = path.join(TEXTS, 'libvips', `${lib}.txt`);
    add({
      name: `libvips bundle: ${meta.name}`,
      version,
      license: meta.license,
      source: meta.source,
      parts: ['server'],
      texts: [read(f)],
      note: meta.note,
    });
  }
  const unknown = Object.keys(sharpLibvipsVersions).filter((k) => !(k in spec.libvips) && !spec.libvipsNotShipped.includes(k));
  if (unknown.length) throw new Error(`neu in sharp-libvips: ${unknown.join(', ')} – in components.json (libvips) eintragen`);
}

// ---------- los ----------
const facts = readJson(path.join(COLLECTED, 'facts.json'));
if (!facts) throw new Error(`${COLLECTED}/facts.json fehlt – erst tools/licenses/collect-images.sh ausführen`);
const lock = readJson(path.join(ROOT, 'server/package-lock.json')).packages;
addNpm(path.join(COLLECTED, 'server'), 'server', {
  '@img/sharp-libvips-linux-x64': { texts: [], note: 'Prebuilt libvips and the libraries listed as "libvips bundle"; LGPL-3.0 and GPL-3.0 texts in section 5, source code: section 1.' },
});
// arm64-Image: dieselben Pakete in der arm64-Fassung (gleiche Version und Lizenz wie x64)
for (const [arm, x64] of [
  ['@img/sharp-linux-arm64', '@img/sharp-linux-x64'],
  ['@img/sharp-libvips-linux-arm64', '@img/sharp-libvips-linux-x64'],
]) {
  const v = lock[`node_modules/${arm}`]?.version;
  const twin = components.get(`${x64}@${lock[`node_modules/${x64}`]?.version}`);
  if (v && twin) add({ ...twin, name: arm, version: v, parts: ['server (arm64)'] });
}
for (const c of components.values()) if (c.name.endsWith('-x64') && c.name.startsWith('@img/')) c.parts = new Set(['server (amd64)']);
addNpm(path.join(COLLECTED, 'mcp'), 'mcp');
addWeb(path.join(COLLECTED, 'web-licenses.txt'));
const sharpLibvips = readJson(path.join(COLLECTED, 'server/@img/sharp-libvips-linux-x64/package.json'));
const sharpLibvipsVersions = readJson(path.join(COLLECTED, 'server/@img/sharp-libvips-linux-x64/versions.json'));
if (!sharpLibvipsVersions) throw new Error('versions.json von @img/sharp-libvips-linux-x64 fehlt in der Sammlung (collect-images.sh nimmt package.json/Lizenzen; versions.json wird extra geholt)');
const fetched = read(path.join(TEXTS, 'libvips/SHARP_LIBVIPS_VERSION'));
if (fetched !== sharpLibvips.version) throw new Error(`tools/licenses/texts/libvips ist für sharp-libvips ${fetched}, im Image steckt ${sharpLibvips.version} – tools/licenses/fetch-texts.sh ausführen`);
addComponents(facts, sharpLibvipsVersions);
const flutter = args.flutter === 'none' ? null : addFlutter(FLUTTER_APP);

// ---------- schreiben ----------
const comps = [...components.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
const norm = (t) => t.replace(/\s+/g, ' ').trim();
/** gleiche Texte einmal: Schlüssel = normalisierter Text */
const groups = new Map();
for (const c of comps) {
  if (!c.texts.length) continue;
  const text = c.texts.join(`\n\n${'- '.repeat(20).trim()}\n\n`);
  const k = norm(text);
  if (!groups.has(k)) groups.set(k, { text, users: [] });
  groups.get(k).users.push(c);
}
const textNo = new Map();
[...groups.values()].forEach((g, i) => g.users.forEach((c) => textNo.set(c, i + 1)));
const partsOf = (c) => [...c.parts].sort().join(', ');
const label = (c) => `${c.name}${c.version ? ` ${c.version}` : ''}`;

const sv = sharpLibvips.version;
const vips = sharpLibvipsVersions.vips;
const head = `THIRD-PARTY SOFTWARE NOTICES – Stachel
${LINE}

Stachel itself is licensed under the Apache License 2.0 (files LICENSE and NOTICE), Copyright 2026 Göran Hegenberg
(INTSODE). Stachel includes and uses software of third parties under the licenses listed below. Their copyright
notices and license texts are reproduced verbatim from the respective packages.

Parts (where a component is shipped):
  server          Docker image ghcr.io/goeranhegenberg/stachel – Node.js server (/app/server/node_modules)
  server (amd64) / server (arm64)   only in the image for that architecture
  web             web app bundle (/app/web/dist in the image "stachel"; list also at <instance>/licenses.txt)
  mcp             Docker image ghcr.io/goeranhegenberg/stachel-mcp – MCP server (/app/node_modules) and Chromium
  image           both Docker images (base system)
  flutter_app     app com.intsode.stachel (Android, iOS, Windows, Linux): all non-dev Pub dependencies (like Flutter's own
                  NOTICES, including implementations for other platforms) plus fonts, icons and PDFium; the app shows all
                  of them on its license page (Konto → Open-Source-Lizenzen)
  flutter_app (Windows) / flutter_app (Linux)   only in the installers and packages for that system
  repo            files in this source repository (fonts, icon paths, license texts)

Generated by tools/licenses/third-party-notices.mjs${args.images ? ` from the images ${args.images}` : ''} on ${new Date().toISOString().slice(0, 10)}:
${comps.length} components, ${groups.size} distinct license texts. Node.js ${facts.stachel.node}, Debian ${facts.stachel.debian}${vars()}.
`;
function vars() {
  const shell = facts.mcp.playwrightBrowsers?.browsers?.find((b) => b.name === 'chromium-headless-shell');
  return `${shell ? `, Chromium Headless Shell ${shell.browserVersion} (Playwright revision ${shell.revision})` : ''}${flutter ? `, Flutter ${flutter.sdkVersion || 'SDK'}` : ''}`;
}

const offer = `${LINE}
1. SOURCE CODE OF THE (L)GPL COMPONENTS – WRITTEN OFFER
${LINE}

The image "stachel" contains libvips ${vips} and the libraries bundled with it (glib, pango, librsvg, libheif, libexif,
fribidi, cairo, aom and others, list in section 3, "libvips bundle") as separately loaded shared libraries from the npm
package @img/sharp-libvips-linux-<arch> ${sv} (used by sharp). libvips, glib, pango, librsvg, libheif, libexif and fribidi
are licensed under LGPL-2.1-or-later and used under LGPL-3.0-or-later (cairo: LGPL-2.1 or MPL-1.1); the license texts are
in section 4 and under "Standard license texts" (LGPL-3.0, GPL-3.0). You may replace these libraries with your own
builds: sharp loads them from node_modules/@img/sharp-libvips-linux-<arch>/lib/ at run time.

Complete corresponding source code:
  - Attached to every GitHub release of Stachel: https://github.com/goeranhegenberg/stachel/releases
    (assets "libvips-sources-${sv}.tar" and "libvips-sources-${sv}.sha256": the upstream source archives of every
    library in versions.json of sharp-libvips v${sv}, the patches applied by its build script and the build scripts
    themselves; created by tools/release/fetch-libvips-source.sh).
  - Upstream: https://github.com/lovell/sharp-libvips/tree/v${sv} (build/posix.sh, versions.properties).

Both images also contain unmodified Debian packages under the GPL/LGPL (section 2) and the image "stachel-mcp" contains
Chromium, which includes LGPL-2.1-or-later code (FFmpeg) among other components (section 2).

Written offer: For at least three years after the last distribution of an image or app version by us, we will give
anyone who asks a complete machine-readable copy of the corresponding source code of every GPL/LGPL-licensed component
contained in it, for a charge no more than our cost of physically performing the distribution, on a customary data
carrier or by download. Contact: Göran Hegenberg (INTSODE), goeran@intsode.com, https://intsode.com/kontakt/ – please
name the image tag or app version.
`;

const shell = facts.mcp.playwrightBrowsers?.browsers?.find((b) => b.name === 'chromium-headless-shell');
const images = `${LINE}
2. DOCKER IMAGES: BASE SYSTEM, NODE.JS, CHROMIUM
${LINE}

Base system (both images): Debian ${facts.stachel.debian} ("bookworm", image node:22-bookworm-slim), unmodified binary packages
(${facts.stachel.debianPackages} in "stachel", ${facts.mcp.debianPackages} in "stachel-mcp"). The license of each package is in the image under
/usr/share/doc/<package>/copyright; the exact package list with source package and version is in
/usr/share/doc/stachel/debian-packages.tsv. Sources: https://snapshot.debian.org/ (by source package and version) and
https://sources.debian.org/.

Node.js ${facts.stachel.node} (both images, /usr/local): MIT license plus the licenses of the components bundled with Node.js
(OpenSSL, ICU, libuv, V8, llhttp, …), full text in the image at ${facts.stachel.nodeLicense || '/usr/local/LICENSE'}. npm and corepack (in
/usr/local/lib/node_modules, Artistic-2.0 / MIT) carry their own licenses there. Source:
https://github.com/nodejs/node/tree/${facts.stachel.node}.

Image "stachel-mcp" only: Chromium Headless Shell${shell ? ` ${shell.browserVersion} (Chrome for Testing, Playwright revision ${shell.revision})` : ''}, installed
by "playwright-core install --with-deps --only-shell chromium" (which also installs the Debian packages for fonts and
X11/GTK/NSS libraries listed in debian-packages.tsv, e.g. fonts-liberation, fonts-noto-color-emoji, fonts-freefont-ttf,
fonts-ipafont-gothic, fonts-wqy-zenhei, fonts-tlwg-loma-otf, fonts-unifont, libnss3, xvfb). Chromium is licensed under
BSD-3-Clause; the complete list of its bundled components and their licenses (${Math.round((facts.mcp.chromiumLicenseBytes ?? 0) / 1e6 * 10) / 10} MB, including FFmpeg under
LGPL-2.1-or-later) is in the image at
  ${facts.mcp.chromiumLicense}
(on linux/arm64 the same file in the arm64 build directory under /ms-playwright/chromium_headless_shell-${shell?.revision ?? '<rev>'}/).
Source: https://chromium.googlesource.com/chromium/src/+/refs/tags/${shell?.browserVersion ?? '<version>'} . FFmpeg as a separate
download of Playwright is not included${facts.mcp.ffmpegRemoved === false ? ' (WARNING: /ms-playwright/ffmpeg* found in the image!)' : ' (removed in mcp/Dockerfile)'}.
`;

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const index = `${LINE}
3. COMPONENTS
${LINE}

${pad('Component', 58)} ${pad('License', 40)} Parts   [Text no.]
${DASH}
${comps
  .map((c) => {
    const lic = c.license.length > 40 ? `${c.license.slice(0, 37)}...` : c.license;
    return `${pad(label(c), 58)} ${pad(lic, 40)} ${partsOf(c)}${textNo.has(c) ? `  [${textNo.get(c)}]` : ''}${c.source ? `\n    ${c.source}` : ''}${c.note ? `\n    ${c.note.replace(/\n/g, '\n    ')}` : ''}`;
  })
  .join('\n')}
`;

const texts = `${LINE}
4. LICENSE TEXTS (verbatim from the components; identical texts are printed once)
${LINE}

${[...groups.values()]
  .map((g, i) => `${DASH}\n[${i + 1}] ${g.users.map((c) => `${label(c)} (${partsOf(c)})`).join('; ')}\n${DASH}\n\n${g.text}\n`)
  .join('\n')}`;

const common = ['Apache-2.0', 'MIT', 'GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-1.1', 'MPL-2.0', 'IPA'];
const standard = `
${LINE}
5. STANDARD LICENSE TEXTS (referenced above; for components whose package carries no own license file)
${LINE}

${common
  .map((id) => {
    const f = id === 'Apache-2.0' ? path.join(ROOT, 'LICENSE') : path.join(TEXTS, 'common', `${id}.txt`);
    return `${DASH}\n${id}\n${DASH}\n\n${read(f)}\n`;
  })
  .join('\n')}`;

fs.writeFileSync(OUT, `${head}\n${offer}\n${images}\n${index}\n${texts}${standard}`.replace(/[ \t]+$/gm, ''), 'utf8');
const unknown = comps.filter((c) => /UNKNOWN|unbekannt/i.test(c.license) || (!c.texts.length && !c.note));
console.log(`${path.relative(ROOT, OUT)}: ${comps.length} Komponenten, ${groups.size} Texte, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KiB`);
if (unknown.length) {
  console.error(`ohne Lizenz/Text: ${unknown.map(label).join(', ')}`);
  process.exitCode = 1;
}
