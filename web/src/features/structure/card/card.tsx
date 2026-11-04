// Karten: Titel, Beschreibung, zuständige Person, Fälligkeit, Tags mit Farben, Status.
// Titel = Feld `text` (Suche, Zwischenablage); übrige Felder siehe model.ts.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../../protocol';
import { initials, textOn, userColor } from '../../../board/colors';
import { placeStyle } from '../../../editor/render/format';
import { useFontsVersion } from '../../../editor/textMeasure';
import { Editable } from '../../../editor/text/plainEngine';
import { defineContextAction, defineMenuItem, defineModal, defineObjectType, defineSlot } from '../../../editor/ext/registry';
import { PopBtn } from '../../../editor/ContextBar';
import type { CtxProps, EditorApi, ObjectViewProps, SlotProps } from '../../../editor/ext/types';
import { useSnapshot } from '../../../editor/ext/hooks';
import { Modal } from '../../../ui/Modal';
import { IconClose } from '../../../ui/icons';
import { colorName } from '../../../ui/a11y';
import type { CardPerson, CardTag } from '../model';
import { IconCalendar, IconDetails, IconPerson, IconStatus } from '../icons';
import { usePeople, useRegisterMe } from './people';
import { bindField, migrateToYText, stringFieldSource, yTextSource } from '../ytext';
import { STATUSES, statusOf } from './status';
import { CARD_COLORS, CARD_MIN_W, CARD_W, TAG_COLORS, TAG_MAX, formatDue, isOverdue, notesToCards } from './model';

export { STATUSES, statusOf };

export { CARD_COLORS, TAG_COLORS, formatDue, isOverdue };

export function Avatar({ person, size = 26 }: { person: CardPerson; size?: number }) {
  return (
    <span className="structure-avatar" style={{ background: userColor(person.key), width: size, height: size, fontSize: size * 0.42 }} title={person.name} aria-label={person.name}>
      {initials(person.name)}
    </span>
  );
}

// ---- Ansicht --------------------------------------------------------------------------------------------------------

function CardView({ o, editing, selected, cb }: ObjectViewProps) {
  useFontsVersion();
  const ref = useRef<HTMLDivElement>(null);
  // Höhe folgt dem Inhalt: Abweichung melden (nur ausgewählt, sonst schreiben mehrere Clients gegeneinander)
  useLayoutEffect(() => {
    if (editing || !selected || !cb.onMeasured || !ref.current) return;
    const h = Math.ceil(ref.current.offsetHeight);
    if (Math.abs(h - o.h) > 2) cb.onMeasured(o.id, h);
  });
  const color = o.color ?? CARD_COLORS[0];
  const st = statusOf(o.status);
  const overdue = isOverdue(o);
  const hasFoot = !!(st || o.due || o.tags?.length || o.assignee);
  return (
    <div className={`obj structure-card${o.status === 'done' ? ' is-done' : ''}`} data-id={o.id} data-type="card" style={placeStyle(o, { '--card': color } as CSSProperties)}>
      <div className="structure-card__inner" ref={ref}>
        {editing ? (
          <Editable id={o.id} className="structure-card__title" initial={o.text ?? ''} current={o.text ?? ''} placeholder="Titel der Karte" cb={cb} />
        ) : (
          <div className="structure-card__title">{o.text || <span className="structure-card__ph">Titel der Karte</span>}</div>
        )}
        {o.desc && <div className="structure-card__desc">{o.desc}</div>}
        {hasFoot && (
          <div className="structure-card__foot">
            {st && (
              <span className="structure-chip structure-chip--status" style={{ '--chip': st.color } as CSSProperties}>
                {st.label}
              </span>
            )}
            {o.due && (
              <span className={`structure-chip structure-chip--due${overdue ? ' is-overdue' : ''}`} title={overdue ? 'Überfällig' : 'Fällig'}>
                <IconCalendar size={13} />
                {formatDue(o.due)}
              </span>
            )}
            {o.tags?.map((t, i) => (
              <span key={i} className="structure-chip structure-chip--tag" style={{ background: t.color, color: textOn(t.color) }}>
                {t.label}
              </span>
            ))}
            {o.assignee && (
              <span className="structure-card__who">
                <Avatar person={o.assignee} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

defineObjectType({
  type: 'card',
  label: 'Karte',
  View: CardView,
  simpleStyle: (o) => ({ background: '#fff', borderLeft: `${Math.max(6, o.w * 0.04)}px solid ${o.color ?? CARD_COLORS[0]}`, borderRadius: 8 }),
  defaultSize: { w: CARD_W, h: 96 },
  create: (p) => ({ type: 'card', x: Math.round(p.x - CARD_W / 2), y: Math.round(p.y - 48), w: CARD_W, h: 96, text: '', color: CARD_COLORS[0] }),
  edit: 'text',
  measure: '.structure-card__inner',
  onEditDone: (o, api, el) => {
    const inner = el?.querySelector('.structure-card__inner') as HTMLElement | null;
    if (inner) api.store.update(o.id, { h: Math.max(40, Math.ceil(inner.offsetHeight)) });
  },
  palette: CARD_COLORS,
  defaultColor: CARD_COLORS[0],
  anchorable: true,
  addHandles: true,
  // neue Karte daneben (Plus-Griff, Tab): leer, ohne Beschreibung, Person, Datum, Tags und Status
  sibling: () => ({ desc: undefined, assignee: undefined, due: undefined, tags: undefined, status: undefined }),
  handles: () => ['e', 'w'],
  sideResize: 'width',
  resize: (_o, base, ctx) => (ctx.widthOnly ? { ...base, w: Math.max(CARD_MIN_W, base.w ?? CARD_W) } : base),
  plainText: (o) => [o.text, o.desc].filter(Boolean).join('\n'),
});


// ---- Ändern ---------------------------------------------------------------------------------------------------------

/** Felder einer Karte ändern (ein Undo-Schritt je Aufruf bzw. Tippfolge), Höhe danach messen. */
export function patchCard(api: EditorApi, id: string, patch: Partial<BoardObject>) {
  api.store.update(id, patch);
  api.remeasure([id], false);
}

defineMenuItem({
  id: 'structure.toCard',
  on: 'object',
  order: 77,
  item: (api) => {
    const notes = api.selected().filter((o) => o.type === 'sticky' && !o.locked);
    if (!notes.length || notes.length !== api.selected().length) return null;
    return {
      label: notes.length > 1 ? 'In Karten umwandeln' : 'In Karte umwandeln',
      onSelect: () => {
        const ids = notesToCards(api.store, notes, () => nanoid());
        api.setSelection(ids);
        api.remeasure(ids);
      },
    };
  },
});

// ---- Kontextleiste ----------------------------------------------------------------------------------------------------

const onlyCards = (c: { selected: readonly BoardObject[]; locked: boolean }) => !c.locked && c.selected.length > 0 && c.selected.every((o) => o.type === 'card');

function StatusBody(p: CtxProps) {
  const cur = p.first.status;
  return (
    <>
      {STATUSES.map((x) => (
        <button key={x.s} className={`ctx-chip structure-status-chip${cur === x.s ? ' is-active' : ''}`} style={{ '--chip': x.color } as CSSProperties} onClick={() => p.choose(() => ({ status: x.s }))}>
          {x.label}
        </button>
      ))}
      <button className={`ctx-chip${!cur ? ' is-active' : ''}`} onClick={() => p.choose(() => ({ status: undefined }))}>
        Ohne
      </button>
    </>
  );
}

function PeopleList({ api, current, onPick }: { api: EditorApi; current?: string; onPick: (p: CardPerson | undefined) => void }) {
  const people = usePeople(api);
  return (
    <div className="structure-people" role="listbox" aria-label="Zuständig">
      {people.map((p) => (
        <button key={p.key} role="option" aria-selected={current === p.key} className={`structure-people__item${current === p.key ? ' is-active' : ''}`} onClick={() => onPick(p)}>
          <Avatar person={p} size={24} />
          <span>{p.name}</span>
        </button>
      ))}
      <button role="option" aria-selected={!current} className={`structure-people__item${!current ? ' is-active' : ''}`} onClick={() => onPick(undefined)}>
        <span className="structure-avatar structure-avatar--none" style={{ width: 24, height: 24 }}>
          <IconPerson size={14} />
        </span>
        <span>Niemand</span>
      </button>
    </div>
  );
}

function DueBody(p: CtxProps) {
  return (
    <div className="structure-due">
      <input
        type="date"
        className="structure-due__input"
        aria-label="Fälligkeitsdatum"
        defaultValue={p.first.due ?? ''}
        onChange={(e) => p.patch(() => ({ due: e.target.value || undefined }))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') p.closePop();
        }}
      />
      {p.first.due && (
        <button className="ctx-chip" onClick={() => p.choose(() => ({ due: undefined }))}>
          Entfernen
        </button>
      )}
    </div>
  );
}

defineContextAction({
  id: 'structure.card',
  order: 76,
  when: onlyCards,
  Bar: (p) => {
    const st = statusOf(p.first.status);
    return (
      <div className="ctx-group">
        <PopBtn open={p.pop === 'cardStatus'} onToggle={p.togglePop('cardStatus')} label="Status">
          <span className="structure-status-ico" style={st ? { color: st.color } : undefined}>
            <IconStatus />
          </span>
        </PopBtn>
        <PopBtn open={p.pop === 'cardWho'} onToggle={p.togglePop('cardWho')} label="Zuständig">
          {p.first.assignee ? <Avatar person={p.first.assignee} size={24} /> : <IconPerson />}
        </PopBtn>
        <PopBtn open={p.pop === 'cardDue'} onToggle={p.togglePop('cardDue')} label="Fällig am" active={!!p.first.due}>
          <IconCalendar />
        </PopBtn>
        {p.single && (
          <button className="ctx-btn" aria-label="Karte öffnen" title="Details" onClick={() => p.api.openModal('structure.card', { id: p.single!.id })}>
            <IconDetails />
          </button>
        )}
      </div>
    );
  },
  pops: {
    cardStatus: { className: 'ctx-pop--list structure-pop-status', label: 'Status', Body: StatusBody },
    cardWho: { className: 'ctx-pop--row structure-pop-people', label: 'Zuständig', Body: (p) => <PeopleList api={p.api} current={p.first.assignee?.key} onPick={(who) => p.choose(() => ({ assignee: who }))} /> },
    cardDue: { className: 'ctx-pop--row', label: 'Fällig am', Body: DueBody },
  },
});

// ---- Details-Dialog -------------------------------------------------------------------------------------------------

function CardDialog({ api, id, onClose }: { api: EditorApi; id: string; onClose: () => void }) {
  useSnapshot(api);
  const o = api.store.get(id);
  const [tag, setTag] = useState('');
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const exists = !!o;
  // Titel und Beschreibung live: fremde Eingaben erscheinen sofort, gleichzeitiges Tippen geht nicht verloren (ytext.ts)
  useLayoutEffect(() => {
    if (!exists) return;
    const { store } = api;
    const map = () => store.objects.get(id);
    migrateToYText(store, map(), 'desc');
    const after = () => api.remeasure([id], false);
    const offs = [
      titleRef.current && bindField(titleRef.current, stringFieldSource(store, id, 'text', after), store.subscribe),
      descRef.current && bindField(descRef.current, yTextSource(store, map, 'desc', after), store.subscribe),
    ];
    return () => offs.forEach((off) => off && off());
  }, [api, id, exists]);
  if (!o) return null;
  const set = (patch: Partial<BoardObject>) => {
    patchCard(api, id, patch);
  };
  const addTag = () => {
    const label = tag.trim();
    if (!label) return;
    api.store.stopCapturing();
    set({ tags: [...(o.tags ?? []), { label: label.slice(0, TAG_MAX), color: tagColor }] });
    setTag('');
  };
  const tags: CardTag[] = o.tags ?? [];
  return (
    <Modal title="Karte" onClose={onClose}>
      <div className="structure-carddlg" style={{ '--card': o.color ?? CARD_COLORS[0] } as CSSProperties} onKeyDown={(e) => e.stopPropagation()}>
        <div className="field">
          <label htmlFor="card-title">Titel</label>
          <input id="card-title" ref={titleRef} className="input" data-autofocus defaultValue={o.text ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="card-desc">Beschreibung</label>
          <textarea id="card-desc" ref={descRef} className="input structure-carddlg__desc" rows={4} defaultValue={o.desc ?? ''} />
        </div>
        <div className="field">
          <span className="structure-carddlg__label">Status</span>
          <div className="structure-seg" role="radiogroup" aria-label="Status">
            {STATUSES.map((x) => (
              <button
                key={x.s}
                role="radio"
                aria-checked={o.status === x.s}
                className={`structure-seg__btn${o.status === x.s ? ' is-active' : ''}`}
                style={{ '--chip': x.color } as CSSProperties}
                onClick={() => set({ status: o.status === x.s ? undefined : x.s })}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="structure-carddlg__row">
          <div className="field">
            <label htmlFor="card-who">Zuständig</label>
            <PeopleSelect api={api} value={o.assignee} onChange={(who) => set({ assignee: who })} />
          </div>
          <div className="field">
            <label htmlFor="card-due">Fällig am</label>
            <input id="card-due" type="date" className="input" value={o.due ?? ''} onChange={(e) => set({ due: e.target.value || undefined })} />
          </div>
        </div>
        <div className="field">
          <span className="structure-carddlg__label">Tags</span>
          <div className="structure-carddlg__tags">
            {tags.map((t, i) => (
              <span key={i} className="structure-chip structure-chip--tag structure-chip--big" style={{ background: t.color, color: textOn(t.color) }}>
                {t.label}
                <button aria-label={`Tag ${t.label} entfernen`} onClick={() => set({ tags: tags.filter((_, j) => j !== i).length ? tags.filter((_, j) => j !== i) : undefined })}>
                  <IconClose size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="structure-carddlg__addtag">
            <div className="structure-carddlg__tagrow">
              <input
              className="input"
              placeholder="Neuer Tag"
              aria-label="Neuer Tag"
              value={tag}
              maxLength={40}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
              <button className="btn btn--ghost btn--sm" onClick={addTag} disabled={!tag.trim()}>
                Hinzufügen
              </button>
            </div>
            <div className="structure-carddlg__swatches">
              {TAG_COLORS.map((c) => (
                <button key={c} className={`swatch swatch--round${tagColor === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Tagfarbe ${colorName(c)}`} onClick={() => setTagColor(c)} />
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <span className="structure-carddlg__label">Farbe</span>
          <div className="structure-carddlg__swatches">
            {CARD_COLORS.map((c) => (
              <button key={c} className={`swatch${(o.color ?? CARD_COLORS[0]) === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Kartenfarbe ${colorName(c)}`} onClick={() => set({ color: c })} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn--primary btn--sm" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PeopleSelect({ api, value, onChange }: { api: EditorApi; value?: CardPerson; onChange: (p: CardPerson | undefined) => void }) {
  const people = usePeople(api);
  const list = value && !people.some((p) => p.key === value.key) ? [value, ...people] : people;
  return (
    <select id="card-who" className="input" value={value?.key ?? ''} onChange={(e) => onChange(list.find((p) => p.key === e.target.value))}>
      <option value="">Niemand</option>
      {list.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

defineModal({
  id: 'structure.card',
  Component: ({ api, props, onClose }) => <CardDialog api={api} id={(props as { id: string }).id} onClose={onClose} />,
});

// Eigenen Namen im Board vermerken (Auswahl „zuständig“)
function RegisterMe({ api }: SlotProps) {
  useRegisterMe(api);
  return null;
}
defineSlot({ id: 'structure.people', slot: 'overlay', order: 2, presenting: true, Component: RegisterMe });
