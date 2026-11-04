// Live-Textfelder (Karten-Dialog, Tabellenzellen): Eingabefeld und Yjs bleiben in beiden Richtungen gleich, ohne dass
// gleichzeitiges Tippen etwas verliert.
// - Felder als `Y.Text` (Kartenbeschreibung, Tabellenzelle): jede Eingabe wird als kleinste Änderung (Löschen +
//   Einfügen an einer Stelle) geschrieben, Yjs führt gleichzeitige Eingaben zusammen.
// - Felder als String (Kartentitel = Kern-Feld `text`): Änderung als Drei-Wege-Abgleich auf den aktuellen Stand.
// Fremde Änderungen landen sofort im Feld, die Schreibmarke bleibt an ihrer Stelle im Text.
import * as Y from 'yjs';
import type { BoardStore } from '../../board/store';

/** Origin für das Umstellen alter String-Felder auf Y.Text (nicht im Undo, der Text bleibt gleich). */
export const MIGRATE_ORIGIN = 'structure:migrate';

export interface Splice {
  index: number;
  del: number;
  ins: string;
}

/** Kleinste Änderung von `a` nach `b`: gemeinsamer Anfang und gemeinsames Ende bleiben. */
export function spliceOf(a: string, b: string): Splice {
  let s = 0;
  const max = Math.min(a.length, b.length);
  while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let e = 0;
  while (e < max - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  return { index: s, del: a.length - s - e, ins: b.slice(s, b.length - e) };
}

/** Position `pos` in `a` auf den Text `b` übertragen (Schreibmarke bei fremden Änderungen). */
export function mapPos(pos: number, a: string, b: string): number {
  const c = spliceOf(a, b);
  if (pos <= c.index) return pos;
  if (pos >= c.index + c.del) return pos + c.ins.length - c.del;
  return c.index + c.ins.length;
}

/** Eigene Änderung `base → mine` auf den aktuellen Stand `theirs` übertragen (liefert die Änderung in `theirs`). */
export function rebase(base: string, mine: string, theirs: string): Splice {
  const m = spliceOf(base, mine);
  if (base === theirs) return m;
  const t = spliceOf(base, theirs);
  const mEnd = m.index + m.del;
  const tEnd = t.index + t.del;
  // ganz vor bzw. hinter der fremden Änderung: unverändert bzw. verschoben
  if (mEnd <= t.index) return m;
  if (m.index >= tEnd) return { ...m, index: m.index + t.ins.length - t.del };
  // überlappt: schon fremd Gelöschtes nicht noch einmal löschen, eigenen Text trotzdem einfügen
  if (m.index < t.index) return { index: m.index, del: t.index - m.index, ins: m.ins };
  return { index: t.index + t.ins.length, del: Math.max(0, mEnd - tEnd), ins: m.ins };
}

export const applySplice = (s: string, c: Splice) => s.slice(0, c.index) + c.ins + s.slice(c.index + c.del);

/** Quelle eines Live-Felds. */
export interface TextSource {
  /** aktueller Stand im Dokument */
  read(): string;
  /** Änderung schreiben (ein Undo-Schritt bzw. zusammengefasst mit den vorigen Tasten) */
  write(c: Splice): void;
  /** Schreibmarke als Yjs-RelativePosition merken (haftet am Zeichen links davon), falls das Feld ein Y.Text ist */
  anchor?(index: number): Y.RelativePosition | null;
  /** gemerkte Schreibmarke im aktuellen Stand; null = nicht auflösbar */
  resolve?(rel: Y.RelativePosition): number | null;
}

/**
 * Schreibmarke im Y.Text genau statt per Textvergleich verfolgen: bei gleichen Zeichen (zwei Leerzeichen gleichzeitig)
 * bliebe sonst offen, wessen Zeichen es ist. Die Marke haftet am Zeichen links davon (eigene Eingabe).
 */
export function yTextCaret(doc: Y.Doc, ytext: () => Y.Text | null): Pick<TextSource, 'anchor' | 'resolve'> {
  return {
    anchor: (index) => {
      const t = ytext();
      return t ? Y.createRelativePositionFromTypeIndex(t, index, -1) : null;
    },
    resolve: (rel) => {
      const t = ytext();
      const abs = t && Y.createAbsolutePositionFromRelativePosition(rel, doc);
      return abs && abs.type === t ? abs.index : null;
    },
  };
}

/** Y.Text in einer Y.Map (Objektfeld bzw. Tabellenzelle); alte String-Werte werden beim Schreiben umgestellt. */
export function yTextSource(store: BoardStore, map: () => Y.Map<unknown> | undefined, key: string, after?: () => void): TextSource {
  const read = () => {
    const v = map()?.get(key);
    return v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v : '';
  };
  return {
    read,
    ...yTextCaret(store.doc, () => {
      const v = map()?.get(key);
      return v instanceof Y.Text ? v : null;
    }),
    write: (c) => {
      store.transact(() => {
        const m = map();
        if (!m) return;
        let t = m.get(key);
        if (!(t instanceof Y.Text)) {
          // alter String bzw. leer: als Y.Text anlegen, im selben Schritt wie die Eingabe
          const y = new Y.Text(typeof t === 'string' ? t : '');
          m.set(key, y);
          t = y;
        }
        const yt = t as Y.Text;
        if (c.del) yt.delete(c.index, c.del);
        if (c.ins) yt.insert(c.index, c.ins);
      });
      after?.();
    },
  };
}

/** String-Feld eines Objekts (z. B. Kern-Feld `text`): Drei-Wege-Abgleich, geschrieben wird der ganze neue Stand. */
export function stringFieldSource(store: BoardStore, id: string, key: string, after?: () => void): TextSource {
  const read = () => {
    const v = (store.get(id) as unknown as Record<string, unknown> | undefined)?.[key];
    return typeof v === 'string' ? v : '';
  };
  return {
    read,
    write: (c) => {
      store.update(id, { [key]: applySplice(read(), c) });
      after?.();
    },
  };
}

/** Alten String-Wert vorab (beim Öffnen) auf Y.Text umstellen – nicht im Undo, der Text bleibt gleich. */
export function migrateToYText(store: BoardStore, map: Y.Map<unknown> | undefined, key: string) {
  const v = map?.get(key);
  if (!map || typeof v !== 'string' || !v) return;
  store.doc.transact(() => map.set(key, new Y.Text(v)), MIGRATE_ORIGIN);
}

/**
 * Eingabefeld an eine Quelle binden. Das Feld ist ungesteuert (kein React-`value`), fremde Änderungen setzt der
 * Store-Beobachter sofort ein – so beruht jede Eingabe auf dem aktuellen Stand. Liefert die Aufräumfunktion.
 */
export function bindField(el: HTMLInputElement | HTMLTextAreaElement, src: TextSource, subscribe: (fn: () => void) => () => void): () => void {
  let base = src.read();
  if (el.value !== base) el.value = base;
  let composing = false;
  let writing = false;
  /** Auswahl als RelativePosition (Y.Text-Felder), vor fremden Änderungen gemerkt */
  let rel: [Y.RelativePosition, Y.RelativePosition] | null = null;
  const capture = () => {
    if (!src.anchor || document.activeElement !== el) return;
    const a = src.anchor(el.selectionStart ?? 0);
    const b = src.anchor(el.selectionEnd ?? 0);
    rel = a && b ? [a, b] : null;
  };
  const pull = () => {
    if (composing || writing) return;
    const cur = src.read();
    if (cur === base) return;
    if (cur === el.value) {
      base = cur;
      return;
    }
    const focused = document.activeElement === el;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const dir = el.selectionDirection ?? 'none';
    // Feld zeigt evtl. schon eigene, noch nicht geschriebene Zeichen: gegen den alten Stand abgleichen
    const shown = el.value;
    const mine = shown !== base ? applySplice(cur, rebase(base, shown, cur)) : cur;
    el.value = mine;
    if (focused) {
      // Y.Text: Schreibmarke exakt über die gemerkte RelativePosition, sonst über den Textvergleich
      const exact = mine === cur && rel && src.resolve ? [src.resolve(rel[0]), src.resolve(rel[1])] : null;
      if (exact && exact[0] !== null && exact[1] !== null) el.setSelectionRange(exact[0], exact[1], dir);
      else el.setSelectionRange(mapPos(s, shown, mine), mapPos(e, shown, mine), dir);
    }
    base = cur;
    if (mine !== cur) push();
    capture();
  };
  const push = () => {
    const shown = el.value;
    const cur = src.read();
    const c = rebase(base, shown, cur);
    writing = true;
    try {
      if (c.del || c.ins) src.write(c);
    } finally {
      writing = false;
    }
    base = src.read();
    if (base !== shown) {
      const s = el.selectionStart ?? 0;
      const e = el.selectionEnd ?? 0;
      el.value = base;
      if (document.activeElement === el) el.setSelectionRange(mapPos(s, shown, base), mapPos(e, shown, base));
    }
    capture();
  };
  const onInput = (e: Event) => {
    if (composing || (e as InputEvent).isComposing) return;
    push();
  };
  const onStart = () => {
    composing = true;
  };
  const onEnd = () => {
    composing = false;
    push();
    pull();
  };
  // Schreibmarke bewegt sich auch ohne Eingabe (Pfeile, Klick): jeweils neu merken
  const onSel = () => {
    if (!composing) capture();
  };
  el.addEventListener('input', onInput);
  el.addEventListener('compositionstart', onStart);
  el.addEventListener('compositionend', onEnd);
  el.addEventListener('focus', onSel);
  document.addEventListener('selectionchange', onSel);
  capture();
  const unsub = subscribe(pull);
  return () => {
    unsub();
    el.removeEventListener('focus', onSel);
    document.removeEventListener('selectionchange', onSel);
    el.removeEventListener('input', onInput);
    el.removeEventListener('compositionstart', onStart);
    el.removeEventListener('compositionend', onEnd);
  };
}
