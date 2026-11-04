// Vorlagen-Galerie: Vorschau, Kategorien, Suche; „Einfügen“ legt die Vorlage in die Bildschirmmitte bzw.,
// wenn dort schon etwas liegt, an den nächsten freien Platz daneben. Kategorie „Meine Vorlagen“: eigene Vorlagen aus
// einer Auswahl (own.ts, ownApi.ts; gespeichert über „Auswahl als Vorlage speichern …“, saveTemplate.tsx). Dazu die
// Vorlagen der Instanz (packApi.ts) unter der Kategorie, die der Betrieb festlegt.
import { useMemo, useState } from 'react';
import type { BoardObject } from '../../../protocol';
import { errorText } from '../../../api';
import { defineMenuItem, defineModal, defineTool } from '../../../editor/ext/registry';
import type { EditorApi } from '../../../editor/ext/types';
import { Modal } from '../../../ui/Modal';
import { IconSearch } from '../../../ui/icons';
import { IconTemplates } from '../icons';
import { BoardPreview, previewBounds } from '../preview';
import { CATEGORIES, matchesSearch, TEMPLATES, type Template, type TemplateCategory } from './catalog';
import { ownMatches, type OwnTemplate } from './own';
import { deleteOwnTemplate, useOwnTemplates } from './ownApi';
import { packMatches, usePackTemplates } from './packApi';
import { freeSpot } from './place';
import { isInvisible } from '../../../board/types';

export const TEMPLATES_MODAL = 'structure.templates';

/** Kategorie der eigenen Vorlagen in der Galerie (Web und App). */
export const OWN_CATEGORY = 'Meine Vorlagen';
/** Eingebaute Kategorie, „Meine Vorlagen“ oder die Kategorie der Vorlagen der Instanz. */
type Cat = TemplateCategory | typeof OWN_CATEGORY | (string & {});

const KINDS: [string, string, string][] = [
  ['frame', 'Rahmen', 'Rahmen'],
  ['card', 'Karte', 'Karten'],
  ['sticky', 'Haftnotiz', 'Haftnotizen'],
  ['table', 'Tabelle', 'Tabellen'],
  ['timeline', 'Zeitleiste', 'Zeitleisten'],
  ['mindnode', 'Thema', 'Themen'],
  ['shape', 'Form', 'Formen'],
  ['connector', 'Verbinder', 'Verbinder'],
];

/** „1 Rahmen · 7 Karten · …“ */
function contents(objs: readonly BoardObject[]): string[] {
  return KINDS.flatMap(([type, one, many]) => {
    const n = objs.filter((o) => o.type === type).length;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  });
}

/** Objekte an einen freien Platz nahe der Bildmitte einfügen (ein Undo-Schritt) und ganz ins Bild holen. */
export function insertAtFreeSpot(api: EditorApi, objs: BoardObject[]) {
  const b = previewBounds(objs);
  const c0 = api.viewCenter();
  if (!b) return api.insertObjects(objs, c0);
  const c = freeSpot(b, c0, (r) => api.queryRect(r).some((o) => !isInvisible(o)));
  api.insertObjects(objs, c);
  const z = api.camera().z;
  const v = api.viewSize();
  const r = { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h };
  const tl = api.toScreen(r);
  const visible = tl.x >= 0 && tl.y >= 0 && tl.x + r.w * z <= v.w && tl.y + r.h * z <= v.h;
  // nur herauszoomen, nie hinein; daneben eingefügt: hinschwenken
  if (b.w * z > v.w * 0.86 || b.h * z > v.h * 0.8 || !visible) api.fitTo(r, z);
}

/** Vorlage einfügen (Bildmitte bzw. freier Platz daneben). */
export function insertTemplate(api: EditorApi, t: Template) {
  insertAtFreeSpot(api, t.build());
}

/** Eintrag der Galerie: eingebaute, eigene Vorlage oder Vorlage der Instanz (`key` = Vorlagen-ID, `own:<id>` bzw. `pack:<id>`). */
type Entry = { key: string; name: string; desc: string; category: Cat; objects: BoardObject[]; own?: OwnTemplate; pack?: boolean };

const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
};

function Gallery({ api, onClose }: { api: EditorApi; onClose: () => void }) {
  const built = useMemo(() => new Map(TEMPLATES.map((t) => [t.id, t.build()])), []);
  const own = useOwnTemplates();
  const pack = usePackTemplates();
  const [cat, setCat] = useState<Cat | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);
  const entries: Entry[] = [
    ...TEMPLATES.filter((t) => (!cat || t.category === cat) && matchesSearch(t, q)).map((t) => ({ key: t.id, name: t.name, desc: t.desc, category: t.category, objects: built.get(t.id)! })),
    ...(pack.category ? pack.list : [])
      .filter((t) => (!cat || cat === pack.category) && packMatches(t, pack.category!, q))
      .map((t): Entry => ({ key: `pack:${t.id}`, name: t.name, desc: t.desc, category: pack.category!, objects: t.objects, pack: true })),
    ...own.list
      .filter((t) => (!cat || cat === OWN_CATEGORY) && ownMatches(t, q))
      .map((t): Entry => ({ key: `own:${t.id}`, name: t.name, desc: `Gespeichert am ${dateText(t.createdAt)}. Nur du siehst sie.`, category: OWN_CATEGORY, objects: t.objects, own: t })),
  ];
  const cur = entries.find((t) => t.key === sel) ?? entries[0];
  const use = (e: Entry) => {
    onClose();
    if (e.own || e.pack) insertAtFreeSpot(api, e.objects);
    else insertTemplate(api, TEMPLATES.find((t) => t.id === e.key)!);
  };
  const remove = async (e: Entry) => {
    if (!e.own || busy) return;
    setBusy(true);
    try {
      await deleteOwnTemplate(e.own.id);
      api.toast(`Vorlage „${e.name}“ gelöscht.`);
    } catch (err) {
      api.toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const none = cat === OWN_CATEGORY && !q.trim() ? (own.loaded ? 'Noch keine eigenen Vorlagen. Wähle Objekte auf dem Board aus und speichere sie über das Kontextmenü „Auswahl als Vorlage speichern …“.' : 'Lädt …') : 'Keine Vorlage gefunden.';
  return (
    <Modal title="Vorlagen" onClose={onClose}>
      <div className="structure-gallery">
        <div className="structure-gallery__bar">
          <label className="structure-gallery__search">
            <IconSearch size={18} />
            <input type="search" placeholder="Vorlage suchen" aria-label="Vorlage suchen" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
          </label>
          <div className="structure-gallery__cats" role="tablist" aria-label="Kategorien">
            {([null, ...CATEGORIES, ...(pack.category ? [pack.category] : []), OWN_CATEGORY] as (Cat | null)[]).map((c) => (
              <button key={c ?? 'all'} role="tab" aria-selected={cat === c} className={`structure-gallery__cat${cat === c ? ' is-active' : ''}`} onClick={() => setCat(c)}>
                {c ?? 'Alle'}
              </button>
            ))}
          </div>
        </div>
        <div className="structure-gallery__body">
          <div className="structure-gallery__grid" role="listbox" aria-label="Vorlagen">
            {entries.map((t) => (
              <button
                key={t.key}
                role="option"
                aria-selected={cur?.key === t.key}
                className={`structure-tpl${cur?.key === t.key ? ' is-active' : ''}${t.category === 'Events' ? ' is-events' : ''}${t.pack ? ' is-pack' : ''}${t.own ? ' is-own' : ''}`}
                data-template={t.key}
                onClick={() => setSel(t.key)}
                onDoubleClick={() => use(t)}
              >
                <span className="structure-tpl__thumb" data-badge={t.pack ? t.category : undefined}>
                  <BoardPreview objects={t.objects} className="structure-tpl__svg" />
                </span>
                <span className="structure-tpl__name">{t.name}</span>
                <span className="structure-tpl__cat">{t.category}</span>
              </button>
            ))}
            {!entries.length && <p className="structure-gallery__none">{none}</p>}
          </div>
          {cur && (
            <aside className="structure-gallery__detail" aria-label={`Vorschau ${cur.name}`}>
              <div className="structure-gallery__big">
                <BoardPreview objects={cur.objects} className="structure-tpl__svg" label={`Vorschau ${cur.name}`} />
              </div>
              <div className="structure-gallery__info">
                <span className="structure-gallery__kicker">{cur.category}</span>
                <h3>{cur.name}</h3>
                <p>{cur.desc}</p>
                <ul className="structure-gallery__parts" aria-label="Enthält">
                  {contents(cur.objects).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="structure-gallery__actions">
                {cur.own && (
                  <button className="btn btn--ghost btn--sm structure-gallery__delete" onClick={() => void remove(cur)} disabled={busy}>
                    Löschen
                  </button>
                )}
                <button className="btn btn--primary structure-gallery__use" onClick={() => use(cur)}>
                  Einfügen
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>
    </Modal>
  );
}

defineModal({ id: TEMPLATES_MODAL, Component: ({ api, onClose }) => <Gallery api={api} onClose={onClose} /> });

defineTool({ id: 'structure.templates', label: 'Vorlagen', order: 101, Icon: () => <IconTemplates />, action: (api) => api.openModal(TEMPLATES_MODAL) });

defineMenuItem({ id: 'structure.templates', on: 'board', order: 20, item: (api) => ({ label: 'Vorlage einfügen …', onSelect: () => api.openModal(TEMPLATES_MODAL) }) });
defineMenuItem({ id: 'structure.templatesCanvas', on: 'canvas', order: 35, item: (api) => ({ label: 'Vorlage einfügen …', sep: true, onSelect: () => api.openModal(TEMPLATES_MODAL) }) });
