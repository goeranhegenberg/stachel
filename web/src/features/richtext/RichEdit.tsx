// Bearbeitung mit Tiptap + y-prosemirror direkt auf dem Y.XmlFragment `content` (live für alle). Nur das gerade
// bearbeitete Objekt hat eine Editor-Instanz; dieser Teil wird erst beim ersten Bearbeiten geladen.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import * as Y from 'yjs';
import { Editor, Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ySyncPlugin, ySyncPluginKey } from 'y-prosemirror';
import { useFontsVersion } from '../../editor/textMeasure';
import type { TextEditProps } from '../../editor/text/engine';
import { bumpActive, getApi, recentDown, setActive, setPop, takeLinkAll, takeTyped } from './active';
import { RICH_TEXT_FIELD } from '../../protocol';
import { ensureContent, fragmentToJson, plainOf, replaceFragment, richDoc, type PMDoc } from './doc';
import { richExtensions } from './extensions';
import { naturalWidth, needsDomFit, useFit } from './fit';
import { remoteCarets } from './carets';
import { textStyle } from './RichView';

/** Origin für das Nachziehen des Klartext-Spiegels nach fremden Änderungen (nicht im eigenen Undo). */
const MIRROR_ORIGIN = 'richtext:mirror';

export interface RichEditProps extends TextEditProps {
  /** Verbinder-Beschriftung: Enter beendet die Bearbeitung */
  label?: boolean;
}

export default function RichEdit({ o, variant, className, style, placeholder, cb, onForeign, label }: RichEditProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fv = useFontsVersion();
  const doc: PMDoc | null = richDoc(o);
  const fit = useFit(ref, o, variant, doc, fv, o.text ?? '');
  const id = o.id;
  // Callbacks aktuell halten, ohne den Editor neu zu bauen
  // Neu binden, wenn ein anderer Client `content` gleichzeitig angelegt hat (Migration aus `text`, das Feld gewinnt nur einer)
  const [gen, setGen] = useState(0);
  const carryRef = useRef<{ doc: PMDoc; base: string } | null>(null);
  const cbRef = useRef({ cb, onForeign });
  cbRef.current = { cb, onForeign };

  useLayoutEffect(() => {
    const api = getApi();
    const el = ref.current;
    if (!api || !el) return;
    const store = api.store;
    // y-prosemirror schreibt mit eigenem Origin: in den Board-UndoManager aufnehmen (Vertrag)
    store.trackOrigin(ySyncPluginKey);
    const typed = takeTyped(id);
    const frag = ensureContent(store, id);
    if (!frag) return;
    const carry = carryRef.current;
    carryRef.current = null;
    const base = plainOf(fragmentToJson(frag));
    // Eigenes Getipptes aus dem abgehängten Fragment übernehmen, solange im gültigen noch niemand geschrieben hat
    if (carry && base === carry.base && plainOf(carry.doc) !== base) {
      store.docOf(id).transact(() => {
        replaceFragment(frag, carry.doc);
        cbRef.current.cb.onTextChange(id, plainOf(carry.doc));
      }, ySyncPluginKey);
    }
    const ymap = store.mapOf(id);
    const onSwap = (ev: Y.YMapEvent<unknown>) => {
      if (ev.transaction.local || !ev.keysChanged.has(RICH_TEXT_FIELD) || carryRef.current) return;
      const cur = ymap?.get(RICH_TEXT_FIELD);
      if (cur === frag || !(cur instanceof Y.XmlFragment)) return;
      carryRef.current = { doc: editor.state.doc.toJSON() as PMDoc, base };
      setGen((g) => g + 1);
    };
    // Rückgängig im Editor nur für Schritte dieser Bearbeitung (getippter Startbuchstabe zählt dazu)
    if (!typed) store.stopCapturing();
    const startDepth = store.undoDepth() - (typed ? 1 : 0);
    let redoable = 0;
    let ready = false;
    let done = false;
    let widthFrame = 0;

    const objEl = () => (label ? null : (el.closest('.obj') as HTMLElement | null));
    const end = () => {
      if (done) return;
      done = true;
      // kein Spiegel-Nachziehen hier: hat ein alter Client inzwischen nur `text` geändert, gilt dessen Text (Vertrag)
      cbRef.current.onForeign?.(false);
      cbRef.current.cb.onEditDone(id, objEl());
    };
    const finish = () => {
      if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      else end();
    };

    /** Klartext-Spiegel schreiben, falls er abweicht (Vertrag: `text` = Klartext von `content`). */
    const syncMirror = (origin: unknown, pm?: PMNode) => {
      const o = store.get(id);
      if (!o) return;
      const plain = plainOf((pm ?? editor.state.doc).toJSON() as PMDoc);
      if (plain === (o.text ?? '')) return;
      if (origin === null) cbRef.current.cb.onTextChange(id, plain);
      else store.docOf(id).transact(() => cbRef.current.cb.onTextChange(id, plain), origin);
    };

    /** Breite von Text mit autoWidth aus dem DOM, wenn die Canvas-Messung (Barlow, schlicht) nicht reicht. */
    const fitWidth = () => {
      cancelAnimationFrame(widthFrame);
      widthFrame = requestAnimationFrame(() => {
        const cur = store.get(id);
        if (done || !cur || cur.type !== 'text' || !cur.autoWidth || !needsDomFit(cur, richDoc(cur))) return;
        const w = naturalWidth(el);
        if (Math.abs(w - cur.w) > 1) store.update(id, { w });
      });
    };

    const finishKey = () => {
      finish();
      return true;
    };
    const redo = () => {
      if (redoable > 0 && store.getHistory().canRedo) {
        redoable--;
        store.redo();
      }
      return true;
    };
    const Stachel = Extension.create({
      name: 'stachel',
      priority: 1000,
      addKeyboardShortcuts: () => ({
        'Mod-z': () => {
          if (store.undoDepth() > startDepth) {
            store.undo();
            redoable++;
          }
          return true;
        },
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        'Mod-k': () => {
          setPop('link');
          return true;
        },
        // Textanfang/-ende (Chrome springt in zentrierten Notizen sonst nicht zuverlässig)
        'Mod-Home': () => editor.commands.focus('start', { scrollIntoView: false }),
        'Mod-End': () => editor.commands.focus('end', { scrollIntoView: false }),
        Escape: finishKey,
        'Mod-Enter': finishKey,
        ...(label ? { Enter: finishKey } : {}),
      }),
      addProseMirrorPlugins: () => [ySyncPlugin(frag), remoteCarets(api, id, frag)],
    });

    const editor = new Editor({
      // ProseMirror nutzt dieses Element selbst als Editierfläche (Klassen setzt ProseMirror)
      element: { mount: el } as unknown as HTMLElement,
      extensions: [...richExtensions(placeholder), Stachel],
      injectCSS: false,
      autofocus: false,
      editorProps: {
        attributes: {
          class: `${className} editing rt`,
          'aria-label': label ? 'Beschriftung des Verbinders' : 'Text bearbeiten',
          'aria-multiline': 'true',
          spellcheck: 'true',
          'data-variant': variant,
        },
        // Das Board scrollt nie, die Kamera folgt nicht dem Cursor
        handleScrollToSelection: () => true,
      },
    });

    // Eigene Änderungen: Klartext-Spiegel im selben Y-Transact wie der Inhalt (ein Undo-Schritt, keine Lücke für andere)
    const binding = ySyncPluginKey.getState(editor.state)?.binding as { _prosemirrorChanged(doc: PMNode): void } | undefined;
    if (binding) {
      const orig = binding._prosemirrorChanged.bind(binding);
      let synced = editor.state.doc;
      binding._prosemirrorChanged = (pm: PMNode) =>
        store.docOf(id).transact(() => {
          orig(pm);
          // nur bei echter Inhaltsänderung (y-prosemirror ruft das auch bei reinen Auswahl-Änderungen auf)
          if (pm !== synced) syncMirror(null, pm);
          synced = pm;
        }, ySyncPluginKey);
    }

    editor.on('update', ({ transaction }) => {
      if (!ready) return;
      const meta = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined;
      if (meta?.isChangeOrigin) {
        // fremde Änderung: Spiegel nachziehen, damit `text` nach gleichzeitigem Tippen wieder zu `content` passt
        if (!meta.isUndoRedoOperation) cbRef.current.onForeign?.(true);
        syncMirror(MIRROR_ORIGIN);
      }
      fitWidth();
      // Höhe gemessener Typen (Text) auch bei reinen Format-Änderungen nachziehen (Klartext bleibt gleich)
      if (!label && !done) api.remeasure([id], false);
    });
    editor.on('transaction', bumpActive);
    editor.on('blur', ({ event }) => {
      const to = event.relatedTarget as HTMLElement | null;
      // Klick in die Format-Leiste (Link-Feld) beendet die Bearbeitung nicht
      if (to?.closest?.('.richtext-bar')) return;
      if (carryRef.current) return; // Neu-Binden (s. onSwap) beendet die Bearbeitung nicht
      end();
    });

    // Tasten gehören dem Text (wie beim Klartext): nicht zum Board durchreichen (Enter/Esc würden sonst dort wirken).
    // Bleibt bewusst angemeldet: beendet Esc/Enter die Bearbeitung, muss es für genau diese Taste noch greifen.
    el.addEventListener('keydown', (e) => e.stopPropagation());

    // Cursor: an die Klickstelle (Doppelklick) bzw. ans Ende (getippt, neu angelegt)
    const down = typed ? null : recentDown();
    const at = down ? editor.view.posAtCoords({ left: down.x, top: down.y }) : null;
    editor.commands.focus(at && !carry ? at.pos : 'end', { scrollIntoView: false });
    // Tiptap fokussiert erst im nächsten Frame: bis dahin gingen schnell getippte Tasten noch ans Board (Werkzeugknopf
    // fokussiert) und landeten vor der Schreibmarke („allo welth“). ProseMirror sofort fokussieren (Auswahl steht schon).
    editor.view.focus();
    ymap?.observe(onSwap);
    // Fett/Kursiv laden ihre Schriftschnitte erst bei Bedarf: danach Breite und Höhe neu messen (sonst bleibt der
    // Rahmen auf dem Maß der Ersatzschrift stehen, z. B. 3 px zu hoch, wenn der Text kurz umbrach)
    const onFonts = () => {
      if (done) return;
      fitWidth();
      // Höhe erst messen, wenn die neue Breite (fitWidth, nächster Frame) gesetzt ist
      if (!label) requestAnimationFrame(() => requestAnimationFrame(() => !done && api.remeasure([id], false)));
    };
    document.fonts?.addEventListener('loadingdone', onFonts);
    ready = true;
    setActive({ id, variant, editor, finish });
    // Strg K auf dem ausgewählten Objekt: Link für den ganzen Text
    let alive = true;
    if (takeLinkAll(id))
      requestAnimationFrame(() => {
        if (!alive) return;
        editor.commands.selectAll();
        setPop('link');
      });

    return () => {
      alive = false;
      ymap?.unobserve(onSwap);
      document.fonts?.removeEventListener('loadingdone', onFonts);
      cancelAnimationFrame(widthFrame);
      setActive(null);
      editor.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, gen]);

  const s: CSSProperties = textStyle(style, o.fontFamily, fit);
  return <div ref={ref} style={s} data-align={s.textAlign as string | undefined} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />;
}
