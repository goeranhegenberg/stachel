// Notiz-Tags: farbige Schlagwörter unten auf Haftnotizen. Gleiches Feld `tags` wie bei Karten (structure),
// die Tag-Liste des Boards ergibt sich aus allen vergebenen Tags (Notizen und Karten), ohne eigene Y-Struktur.
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { BoardObject } from '../../protocol';
import { textOn } from '../../board/colors';
import type { Patch } from '../../board/store';
import { PopBtn } from '../../editor/ContextBar';
import { defineContextAction, defineObjectType, objectTypes } from '../../editor/ext/registry';
import type { CtxProps, ObjectViewProps } from '../../editor/ext/types';
import { placeStyle } from '../../editor/render/format';
import { colorName } from '../../ui/a11y';
import { IconTag } from './icons';

export interface NoteTag {
  label: string;
  color: string;
}

/** Tag-Farben (wie bei Karten) */
export const TAG_COLORS = ['#c9e14a', '#ec4e92', '#1763b5', '#ffd08a', '#9fd3ff', '#e2d5ff', '#ffb3d1', '#0a0a0a'];
export const TAG_MAX_LEN = 40;
/** mehr passt auf einer Notiz nicht sinnvoll nebeneinander */
export const TAG_MAX = 8;

const coarse = () => {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
};
const key = (label: string) => label.trim().toLocaleLowerCase('de');
const tagsOf = (o: BoardObject): NoteTag[] => (Array.isArray(o.tags) ? o.tags.filter((t) => t && typeof t.label === 'string' && t.label.trim()) : []);

/** Alle Tags des Boards (Notizen und Karten), je Name einmal, erste Farbe gewinnt; alphabetisch. */
export function boardTags(objects: readonly BoardObject[]): NoteTag[] {
  const seen = new Map<string, NoteTag>();
  for (const o of objects) for (const t of tagsOf(o)) if (!seen.has(key(t.label))) seen.set(key(t.label), { label: t.label.trim(), color: t.color });
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/** Patch: Tag an- bzw. abschalten (Vergleich ohne Groß-/Kleinschreibung). */
export function toggleTag(o: BoardObject, tag: NoteTag, on: boolean): Patch | null {
  const list = tagsOf(o);
  const has = list.some((t) => key(t.label) === key(tag.label));
  if (on === has) return null;
  if (on) return list.length >= TAG_MAX ? null : { tags: [...list, { label: tag.label.trim().slice(0, TAG_MAX_LEN), color: tag.color }] };
  const rest = list.filter((t) => key(t.label) !== key(tag.label));
  return { tags: rest.length ? rest : undefined };
}

// ---- Darstellung auf der Haftnotiz -------------------------------------------------------------------------------

const coreSticky = objectTypes.get('sticky')!;
const CoreStickyView = coreSticky.View!;

function StickyWithTags(p: ObjectViewProps) {
  const tags = tagsOf(p.o);
  // immer dieselbe Baumform: ein Tag von jemand anderem darf eine laufende Bearbeitung nicht neu aufbauen
  return (
    <>
      <CoreStickyView {...p} />
      {tags.length > 0 && (
        // eigene Ebene in derselben Lage (dreht mit), klickt durch auf die Notiz
        <div className="tools-tags-layer" data-tags-for={p.o.id} style={placeStyle(p.o)} aria-hidden="true">
          <div className="tools-tags" style={{ fontSize: Math.max(9, Math.min(14, p.o.w / 16)) }}>
            {tags.map((t, i) => (
              <span key={i} className="tools-tag" style={{ background: t.color, color: textOn(t.color) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

defineObjectType({
  ...coreSticky,
  View: StickyWithTags,
  // neue Notiz daneben (Plus-Griff, Tab) ohne Tags
  sibling: (o) => ({ ...(coreSticky.sibling?.(o) ?? {}), tags: undefined }),
});

// ---- Kontextleiste ----------------------------------------------------------------------------------------------

function TagsBar(p: CtxProps) {
  const any = p.selected.some((o) => tagsOf(o).length);
  return (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'tags'} onToggle={p.togglePop('tags')} label="Tags" active={any}>
        <IconTag />
      </PopBtn>
    </div>
  );
}

function TagsPop(p: CtxProps) {
  const all = useMemo(() => boardTags(p.api.snapshot().ordered), [p.api, p.selected]);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const nextColor = TAG_COLORS[all.length % TAG_COLORS.length];
  const on = (t: NoteTag) => p.selected.every((o) => tagsOf(o).some((x) => key(x.label) === key(t.label)));
  const full = p.selected.some((o) => tagsOf(o).length >= TAG_MAX);
  const add = () => {
    const l = label.trim().slice(0, TAG_MAX_LEN);
    if (!l) return;
    // gleicher Name wie ein vorhandener Tag: dessen Farbe (ein Tag = eine Farbe auf dem Board)
    const known = all.find((t) => key(t.label) === key(l));
    const tag = known ?? { label: l, color: color ?? nextColor };
    p.patch((o) => toggleTag(o, tag, true));
    setLabel('');
    setColor(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // Tippen gehört dem Feld, nicht dem Board
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Escape') p.closePop();
  };
  return (
    <div className="tools-tags-pop">
      {all.length > 0 && (
        <div className="tools-tags-pop__list" role="group" aria-label="Tags des Boards">
          {all.map((t) => {
            const active = on(t);
            return (
              <button
                key={t.label}
                type="button"
                className={`tools-tag tools-tag--btn${active ? ' is-on' : ''}`}
                style={{ background: t.color, color: textOn(t.color) }}
                aria-pressed={active}
                disabled={!active && full}
                onClick={() => p.patch((o) => toggleTag(o, t, !active))}
              >
                {active ? '✓ ' : ''}
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="tools-tags-pop__new">
        <input
          className="tools-tags-pop__input"
          value={label}
          maxLength={TAG_MAX_LEN}
          placeholder="Neuer Tag"
          aria-label="Neuer Tag"
          // am Handy nicht sofort die Tastatur aufklappen (sie würde Leiste und Tag-Liste verdecken)
          autoFocus={!coarse()}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" className="btn btn--green tools-tags-pop__add" disabled={!label.trim() || full} onClick={add}>
          Hinzufügen
        </button>
      </div>
      <div className="tools-tags-pop__colors" role="group" aria-label="Farbe des neuen Tags">
        {TAG_COLORS.map((c) => (
          <button key={c} type="button" className={`swatch swatch--round${(color ?? nextColor) === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Tagfarbe ${colorName(c)}`} onClick={() => setColor(c)} />
        ))}
      </div>
    </div>
  );
}

defineContextAction({
  id: 'tools.tags',
  order: 84,
  when: (c) => !c.locked && c.selected.every((o) => o.type === 'sticky'),
  Bar: TagsBar,
  pops: { tags: { className: 'tools-tags-popwrap', label: 'Tags', Body: TagsPop } },
});
