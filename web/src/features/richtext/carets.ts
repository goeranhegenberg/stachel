// Schreibmarken anderer Personen im selben Text (Awareness-Feld `richtext.caret`, Positionen relativ zum Y-Text).
import * as Y from 'yjs';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror';
import type { EditorApi } from '../../editor/ext/types';

export const CARET_FIELD = 'richtext.caret';

export interface CaretState {
  /** Objekt, in dem die Person schreibt */
  id: string;
  anchor: unknown;
  head: unknown;
}

const key = new PluginKey<DecorationSet>('richtext.carets');

function caretEl(name: string, color: string) {
  const el = document.createElement('span');
  el.className = 'rt-caret';
  // Name per CSS (attr), damit er nicht zum Text gehört (Kopieren, Screenreader)
  el.dataset.name = name;
  el.style.setProperty('--rt-caret', color);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function remoteCarets(api: EditorApi, id: string, frag: Y.XmlFragment) {
  const session = api.session;
  const ydoc = frag.doc ?? api.store.doc; // Privat-Ablage: eigenes Dokument (docs/features/private.md)
  const mappingOf = (state: Parameters<typeof ySyncPluginKey.getState>[0]) => ySyncPluginKey.getState(state)?.binding?.mapping;

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set, _old, state) {
        const mapping = mappingOf(state);
        if (!mapping || (!tr.docChanged && !tr.getMeta(key))) return set.map(tr.mapping, tr.doc);
        const decos: Decoration[] = [];
        for (const p of session.getPeers()) {
          const c = p.extra[CARET_FIELD] as CaretState | null | undefined;
          if (!c || c.id !== id) continue;
          try {
            const head = relativePositionToAbsolutePosition(ydoc, frag, Y.createRelativePositionFromJSON(c.head), mapping);
            const anchor = relativePositionToAbsolutePosition(ydoc, frag, Y.createRelativePositionFromJSON(c.anchor), mapping);
            if (head === null || anchor === null) continue;
            const max = tr.doc.content.size;
            const h = Math.min(Math.max(head, 0), max);
            const a = Math.min(Math.max(anchor, 0), max);
            decos.push(Decoration.widget(h, () => caretEl(p.user.name, p.user.color), { key: `c${p.clientId}`, side: 10 }));
            if (a !== h) decos.push(Decoration.inline(Math.min(a, h), Math.max(a, h), { class: 'rt-peer-sel', style: `background-color: ${p.user.color}33` }));
          } catch {
            // Position nicht (mehr) auflösbar
          }
        }
        return DecorationSet.create(tr.doc, decos);
      },
    },
    props: { decorations: (state) => key.getState(state) },
    view(view) {
      let last = '';
      const publish = () => {
        const mapping = mappingOf(view.state);
        if (!mapping || !view.hasFocus()) return;
        const { anchor, head } = view.state.selection;
        try {
          const c: CaretState = {
            id,
            anchor: Y.relativePositionToJSON(absolutePositionToRelativePosition(anchor, frag, mapping)),
            head: Y.relativePositionToJSON(absolutePositionToRelativePosition(head, frag, mapping)),
          };
          const s = JSON.stringify(c);
          if (s === last) return;
          last = s;
          session.setLocalField(CARET_FIELD, c);
        } catch {
          // Mapping noch nicht bereit
        }
      };
      // nur neu zeichnen, wenn sich Schreibmarken in diesem Objekt ändern (nicht bei jeder Mausbewegung)
      let sig = '';
      const unsub = session.subscribe(() => {
        const next = JSON.stringify(session.getPeers().map((p) => [p.clientId, p.user.name, p.user.color, p.extra[CARET_FIELD]]).filter((x) => (x[3] as CaretState | null)?.id === id));
        if (next === sig || view.isDestroyed) return;
        sig = next;
        view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
      });
      queueMicrotask(publish);
      return {
        update: publish,
        destroy: () => {
          unsub();
          session.setLocalField(CARET_FIELD, null);
        },
      };
    },
  });
}
