// Ergänzungen des Rich-Text-Editors ohne eigenes Schema: Einfügen bereinigen (paste.ts), Esc schließt zuerst ein
// offenes Menü der Format-Leiste, Schreibmarke bleibt in einer überlaufenden Notiz/Form sichtbar (Bereich scrollt).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { getPop, setPop } from './active';
import { cleanPastedHtml } from './paste';

/** Variante des Editors (sticky, text, shape, label) – RichEdit setzt sie als `data-variant`. */
const variantOf = (view: EditorView | undefined) => view?.dom?.getAttribute('data-variant') ?? '';

/** Schreibmarke im eigenen Scrollbereich halten (Board selbst scrollt nie, siehe RichEdit handleScrollToSelection). */
function keepCaretVisible(view: EditorView) {
  const dom = view.dom as HTMLElement;
  if (!view.hasFocus() || dom.scrollHeight <= dom.clientHeight + 1) return;
  let c: { top: number; bottom: number };
  try {
    c = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const r = dom.getBoundingClientRect();
  // Board-Zoom: Bildschirm- in Elementpixel umrechnen
  const k = dom.offsetHeight ? r.height / dom.offsetHeight : 1;
  if (c.bottom > r.bottom) dom.scrollTop += (c.bottom - r.bottom) / k + 2;
  else if (c.top < r.top) dom.scrollTop -= (r.top - c.top) / k + 2;
}

export const StachelExtras = Extension.create({
  name: 'stachelExtras',
  // vor den Kürzeln aus RichEdit (Esc beendet dort die Bearbeitung)
  priority: 1100,
  addKeyboardShortcuts: () => ({
    Escape: () => {
      if (!getPop()) return false;
      setPop(null);
      return true;
    },
  }),
  transformPastedHTML(html) {
    let view: EditorView | undefined;
    try {
      view = this.editor.view;
    } catch {
      view = undefined;
    }
    const v = variantOf(view);
    // Teil-Schriftgrößen gibt es nur in Text und Form (Vertrag richtext.md)
    return cleanPastedHtml(html, { sizes: v === 'text' || v === 'shape' });
  },
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey('stachelExtras'),
      props: {
        // Zeilenenden aus Windows-Programmen (Excel, Word) vereinheitlichen
        transformPastedText: (text) => text.replace(/\r\n?/g, '\n'),
      },
      view: () => ({
        update: (view) => {
          const v = variantOf(view);
          if (v === 'sticky' || v === 'shape') keepCaretVisible(view);
        },
      }),
    }),
  ],
});
