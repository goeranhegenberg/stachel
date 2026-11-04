import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLicenseText, packageRootOf } from './licenses';

const OFL = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.';

/** Kleines node_modules mit allem, was die Lizenzdatei braucht. */
function fakeNodeModules() {
  const nm = join(mkdtempSync(join(tmpdir(), 'stachel-lic-')), 'node_modules');
  const put = (rel: string, text: string) => {
    const f = join(nm, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, text);
  };
  put('@fontsource/barlow/LICENSE', `Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)\n\n${OFL}`);
  put('@fontsource/barlow-condensed/LICENSE', `Copyright 2017 The Barlow Project Authors\n\n${OFL}`);
  put('@fontsource/source-serif-4/LICENSE', `Google Inc.\n\n${OFL}`);
  put('@fontsource/jetbrains-mono/LICENSE', `Copyright 2020 The JetBrains Mono Project Authors\n\n${OFL}`);
  put('lucide/LICENSE', 'ISC License\n\nCopyright (c) 2026 Lucide Icons and Contributors\n\nThe MIT License (MIT) (for the icons listed above)\n\nCopyright (c) 2013-present Cole Bemis');
  put('pdfjs-dist/standard_fonts/LICENSE_LIBERATION', 'GNU General Public License v.2 with the exceptions set forth below');
  put('pdfjs-dist/standard_fonts/LICENSE_FOXIT', 'Copyright 2014 PDFium Authors');
  put('pdfjs-dist/wasm/LICENSE_OPENJPEG', 'BSD-2-Clause openjpeg');
  put('react/package.json', JSON.stringify({ name: 'react', version: '19.3.1', license: 'MIT', repository: { url: 'git+https://github.com/facebook/react.git' } }));
  put('react/LICENSE', 'MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.');
  put('@scope/nolicense/package.json', JSON.stringify({ name: '@scope/nolicense', version: '1.0.0', license: 'BSD-3-Clause' }));
  put('outer/node_modules/inner/package.json', JSON.stringify({ name: 'inner', version: '2.0.0', license: 'ISC' }));
  return nm;
}

describe('licenses.txt', () => {
  it('findet die Paketwurzel auch bei Scope, Verschachtelung, Windows-Pfaden und Query', () => {
    expect(packageRootOf('/a/node_modules/react/cjs/react.js')).toBe('/a/node_modules/react');
    expect(packageRootOf('C:\\a\\node_modules\\@tiptap\\core\\dist\\index.js')).toBe('C:/a/node_modules/@tiptap/core');
    expect(packageRootOf('/a/node_modules/outer/node_modules/inner/x.js?url')).toBe('/a/node_modules/outer/node_modules/inner');
    expect(packageRootOf('\0/a/src/main.tsx')).toBeNull();
  });

  it('enthält Schriften, Liberation (GPL-2 + Font-Ausnahme), lucide (ISC + MIT) und die Pakete des Bündels', () => {
    const nm = fakeNodeModules();
    const { text, packages } = buildLicenseText(
      [`${nm}/react/index.js`, `${nm}/react/cjs/react.js`, `${nm}/@scope/nolicense/a.js`, `${nm}/outer/node_modules/inner/b.js`, '/app/src/main.tsx'],
      nm,
    );
    expect(packages).toBe(3);
    expect(text).toContain('Stachel – Lizenzen der mitgelieferten Software (Web-App)');
    expect(text).toContain('Apache License 2.0');
    for (const font of ['Barlow (', 'Barlow Condensed', 'Source Serif 4', 'JetBrains Mono']) expect(text).toContain(`Schrift ${font}`);
    expect(text).toContain(OFL);
    // Source Serif 4: Adobe statt „Google Inc.“
    expect(text).toContain('Adobe (http://www.adobe.com/), with Reserved Font Name ‘Source’');
    expect(text).not.toMatch(/^Google Inc\.$/m);
    expect(text).toContain('Liberation Sans (GNU General Public License v2 mit Font-Ausnahme');
    expect(text).toContain('ISC License');
    expect(text).toContain('Cole Bemis');
    expect(text).toContain('Foxit');
    expect(text).toContain('WebAssembly-Dekoder OPENJPEG');
    expect(text).toContain('react 19.3.1 (MIT)');
    expect(text).toContain('Quelle: https://github.com/facebook/react.git');
    expect(text).toContain('Lizenztext: siehe BSD-3-Clause (kein Text im Paket)');
    expect(text).toContain('inner 2.0.0 (ISC)');
    // je Paket nur einmal
    expect(text.split('react 19.3.1 (MIT)').length).toBe(2);
  });
});
