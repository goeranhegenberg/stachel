// Paritäts-Wächter (docs/contract.md §8.10, docs/native_paritaet.md): Definiert das Web einen neuen Objekttyp
// (`defineObjectType`) oder ein neues Y-Feld (`registerYField`), muss es in shared/native.ts, in der Paritätsliste und
// (Y-Feld) im Server-Schnappschuss stehen – sonst scheitert dieser Test, bevor die App still falsch darstellt.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_OBJECT_TYPES, NATIVE_Y_FIELDS } from '../../shared/native.js';
import { WEB } from '#stachel-web';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WEB_SRC = path.join(ROOT, 'web/src');

function sources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.harness\.tsx?$/.test(e.name)) out.push({ file: p, text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}

const files = sources(WEB_SRC);

/** Literal oder Konstante (`export const X = '…'` irgendwo in web/src) auflösen. */
function resolve(expr: string): string {
  const e = expr.trim();
  const lit = /^['"]([^'"]+)['"]$/.exec(e);
  if (lit) return lit[1]!;
  const re = new RegExp(`export const ${e}\\s*=\\s*['"]([^'"]+)['"]`);
  for (const f of files) {
    const m = re.exec(f.text);
    if (m) return m[1]!;
  }
  // gemeinsame Konstanten (z. B. RICH_TEXT_FIELD)
  const shared = fs.readFileSync(path.join(ROOT, 'shared/protocol.ts'), 'utf8');
  const m = re.exec(shared);
  if (m) return m[1]!;
  throw new Error(`Konstante ${e} nicht gefunden`);
}

function webTypes(): string[] {
  const out = new Set<string>();
  for (const f of files) {
    // erste Eigenschaft `type:` (ggf. nach einem Spread); reine Spreads ersetzen nur die Darstellung eines vorhandenen Typs
    for (const m of f.text.matchAll(/defineObjectType\(\{\s*(?:\.\.\.[\w.]+\s*,\s*)?type:\s*([^,\n}]+)/g)) out.add(resolve(m[1]!));
  }
  return [...out].sort();
}

function webYFields(): string[] {
  const out = new Set<string>();
  for (const f of files) for (const m of f.text.matchAll(/registerYField\(\s*([^,\s)]+)\s*,/g)) out.add(resolve(m[1]!));
  return [...out].sort();
}

const paritaet = fs.readFileSync(path.join(ROOT, 'docs/native_paritaet.md'), 'utf8');

describe('Parität Web ↔ Native-API', () => {
  it('findet die Objekttypen des Web (Selbsttest des Scanners)', () => {
    const types = webTypes();
    expect(types).toEqual(expect.arrayContaining(['sticky', 'connector', 'table', 'document']));
  });

  it('jeder Objekttyp des Web steht in shared/native.ts (NATIVE_OBJECT_TYPES) und in docs/native_paritaet.md', () => {
    const missing = webTypes().filter((t) => !(NATIVE_OBJECT_TYPES as readonly string[]).includes(t));
    expect(missing, `Neue Objekttypen im Web – in shared/native.ts und docs/native_paritaet.md eintragen: ${missing.join(', ')}`).toEqual([]);
    const noRow = NATIVE_OBJECT_TYPES.filter((t) => !paritaet.includes(`| \`${t}\` |`));
    expect(noRow, `Zeile in docs/native_paritaet.md fehlt: ${noRow.join(', ')}`).toEqual([]);
    // umgekehrt: keine Leichen
    const gone = NATIVE_OBJECT_TYPES.filter((t) => !webTypes().includes(t));
    expect(gone, `Im Web nicht mehr definiert: ${gone.join(', ')}`).toEqual([]);
  });

  it('jedes Y-Feld des Web hat einen Codec im Server-Schnappschuss und eine Zeile in der Paritätsliste', () => {
    const fields = webYFields();
    expect(fields).toContain('content');
    const unknown = fields.filter((f) => !(f in NATIVE_Y_FIELDS));
    expect(unknown, `Neue Y-Felder im Web – in shared/native.ts (NATIVE_Y_FIELDS), server/src/native/web-impl.ts und docs/native_paritaet.md: ${unknown.join(', ')}`).toEqual([]);
    expect(WEB.yFieldNames().sort(), 'web-impl.ts registriert nicht alle Codecs').toEqual(Object.keys(NATIVE_Y_FIELDS).sort());
    const noRow = Object.keys(NATIVE_Y_FIELDS).filter((f) => !paritaet.includes(`| \`${f}\` |`));
    expect(noRow, `Zeile in docs/native_paritaet.md fehlt: ${noRow.join(', ')}`).toEqual([]);
  });
});
