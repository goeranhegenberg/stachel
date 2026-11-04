// Rich-Text-Engine für den Kern (setTextEngine): statische Anzeige sofort, Editor (Tiptap) lazy nachgeladen.
import { lazy, Suspense } from 'react';
import type { BoardObject } from '../../protocol';
import type { EditorApi } from '../../editor/ext/types';
import type { LabelEditProps, TextEditProps, TextEngine } from '../../editor/text/engine';
import { markTyped } from './active';
import { appendText, ensureContent } from './doc';
import { RichView } from './RichView';

const load = () => import('./RichEdit');
const LazyEdit = lazy(load);
/**
 * Editor-Code gleich mit dem Board laden. Die Seite wartet darauf (TextEngine.ready), damit das erste Tippen nie in
 * die statische Anzeige geht und Zeichen verloren gehen.
 */
let Loaded: typeof import('./RichEdit').default | null = null;
export const editorReady: Promise<unknown> =
  typeof window === 'undefined'
    ? Promise.resolve()
    : load()
        .then((m) => void (Loaded = m.default))
        .catch(() => {});

function RichEditBox(p: TextEditProps) {
  // schon geladen: direkt (ohne Suspense-Umweg, der einen Tastendruck lang die statische Anzeige zeigen könnte)
  if (Loaded) return <Loaded {...p} />;
  return (
    <Suspense fallback={<RichView {...p} />}>
      <LazyEdit {...p} />
    </Suspense>
  );
}

/** Beschriftung eines Verbinders in der Linienmitte bearbeiten (Bildschirmebene, mit dem Zoom skaliert). */
function RichLabelEdit({ o, at, cb }: LabelEditProps) {
  const z = Math.min(3, Math.max(0.8, getZoom()));
  const fs = Math.max(12, o.fontSize ?? 14 + (o.strokeWidth ?? 2));
  return (
    <div
      className="richtext-label-edit"
      style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%) scale(${z})`, fontSize: fs, color: o.color ?? '#0a0a0a' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {Loaded ? (
        <Loaded o={o} variant="label" className="conn-label-text" placeholder="Beschriftung" cb={cb} label />
      ) : (
        <Suspense fallback={<RichView o={o} variant="label" className="conn-label-text" />}>
          <LazyEdit o={o} variant="label" className="conn-label-text" placeholder="Beschriftung" cb={cb} label />
        </Suspense>
      )}
    </div>
  );
}

let zoomOf: () => number = () => 1;
export const setZoomSource = (fn: () => number) => {
  zoomOf = fn;
};
const getZoom = () => zoomOf();

/** Tippen auf ein ausgewähltes Objekt: Zeichen ans Ende von `content` (und `text`), dann startet die Bearbeitung. */
function typeInto(o: BoardObject, ch: string, api: EditorApi) {
  const store = api.store;
  store.transact(() => {
    const f = ensureContent(store, o.id, null);
    if (f) appendText(f, ch);
    store.update(o.id, api.adjustPatch(o, { text: (o.text ?? '') + ch }));
  });
  markTyped(o.id);
}

export const richEngine: Partial<TextEngine> = {
  ready: editorReady,
  View: RichView,
  Edit: RichEditBox,
  LabelEdit: RichLabelEdit,
  typeInto,
};
