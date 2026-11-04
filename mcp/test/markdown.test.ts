import { describe, expect, it } from 'vitest';
import { docToMarkdown, hasFormatting, markdownToDoc, parseInline } from '../src/board/markdown';
import { plainOf } from '../../web/src/features/richtext/doc';

describe('Markdown ↔ Rich-Text (content)', () => {
  it('Inline-Formate werden Marks wie im Tiptap-StarterKit', () => {
    expect(parseInline('Das ist **fett** und *kursiv*, ~~weg~~, `code`, ==markiert==, <u>unter</u>')).toEqual([
      { type: 'text', text: 'Das ist ' },
      { type: 'text', text: 'fett', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' und ' },
      { type: 'text', text: 'kursiv', marks: [{ type: 'italic' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'weg', marks: [{ type: 'strike' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'markiert', marks: [{ type: 'highlight' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'unter', marks: [{ type: 'underline' }] },
    ]);
  });

  it('Links: nur sichere Ziele, ohne Schema → https', () => {
    expect(parseInline('[Beispiel](example.org)')).toEqual([{ type: 'text', text: 'Beispiel', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] }]);
    expect(parseInline('[böse](javascript:void)')).toEqual([{ type: 'text', text: 'böse' }]);
  });

  it('snake_case, Rechnungen und Sternchen ohne Gegenstück bleiben Text', () => {
    expect(plainOf(markdownToDoc('datei_name_neu.txt'))).toBe('datei_name_neu.txt');
    expect(plainOf(markdownToDoc('2*3*4 = 24'))).toBe('2*3*4 = 24');
    expect(plainOf(markdownToDoc('Preis: 5 * Menge'))).toBe('Preis: 5 * Menge');
  });

  it('jede Zeile ein Absatz, Klartext-Spiegel wie die Web-App', () => {
    const doc = markdownToDoc('Erste Zeile\nZweite Zeile');
    expect(doc.content).toHaveLength(2);
    expect(plainOf(doc)).toBe('Erste Zeile\nZweite Zeile');
    expect(hasFormatting(doc)).toBe(false);
  });

  it('Listen (verschachtelt), Aufgaben, Überschriften, Zitat, Code', () => {
    const md = '# Plan\n- Bühne\n  - Licht\n  - Ton\n- Bar\n1. eins\n2. zwei\n- [ ] offen\n- [x] erledigt\n> Zitat\n```\ncode\n```';
    const doc = markdownToDoc(md);
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock']);
    const bullets = doc.content[1]!;
    expect(bullets.content).toHaveLength(2);
    expect(bullets.content![0]!.content![1]!.type).toBe('bulletList');
    expect(doc.content[3]!.content![1]!.attrs).toEqual({ checked: true });
    expect(hasFormatting(doc)).toBe(true);
    expect(docToMarkdown(doc)).toBe(md);
  });

  it('Rundreise mit Formaten', () => {
    const md = '**Bühne** aufbauen mit *Licht*\n- [Plan](https://x.de)';
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
  });

  it('Escapes: \\* bleibt ein Stern', () => {
    expect(plainOf(markdownToDoc('\\*wichtig\\*'))).toBe('*wichtig*');
    expect(docToMarkdown(markdownToDoc('\\*wichtig\\*'))).toBe('\\*wichtig\\*');
  });
});
