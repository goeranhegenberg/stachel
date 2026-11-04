// Reaktionen: Knopf in der Kontextleiste (Emoji-Auswahl) und Emoji-Chips unter den Objekten mit Namen beim Überfahren.
import { worldToScreen } from '../../board/geometry';
import { isInvisible } from '../../board/types';
import type { CtxProps, SlotProps } from '../../editor/ext/types';
import { PopBtn } from '../../editor/ContextBar';
import { useY } from '../../editor/ext/hooks';
import { IconReact } from './icons';
import { EMOJIS, peopleText, reactionsByObject, reactionsMap, toggleReaction } from './reactions';

export const ReactBar = (p: CtxProps) => (
  <div className="ctx-group">
    <PopBtn open={p.pop === 'react'} onToggle={p.togglePop('react')} label="Reagieren">
      <IconReact size={20} />
    </PopBtn>
  </div>
);

export function ReactPicker(p: CtxProps) {
  const me = p.api.session.user;
  const groups = useY(reactionsMap(p.api.store), (m) => reactionsByObject(m, me.key));
  const ids = p.selected.map((o) => o.id);
  return (
    <>
      {EMOJIS.map((e) => {
        const on = ids.every((id) => groups.get(id)?.some((g) => g.emoji === e && g.mine));
        return (
          <button key={e} className={`collab-emoji-btn${on ? ' is-active' : ''}`} aria-label={`Reaktion ${e}`} aria-pressed={on} title={on ? 'Reaktion entfernen' : 'Reagieren'} onClick={() => toggleReaction(p.api.store, ids, e, me)}>
            {e}
          </button>
        );
      })}
    </>
  );
}

/** Slot: Chips unter Objekten mit Reaktionen (nur wenn das Objekt groß genug zu sehen ist). */
export function ReactionLayer({ api, cam, snap, width, height }: SlotProps) {
  const me = api.session.user;
  const byObj = useY(reactionsMap(api.store), (m) => reactionsByObject(m, me.key));
  if (!byObj.size) return null;
  const rows: React.ReactNode[] = [];
  for (const [id, groups] of byObj) {
    const o = snap.byId.get(id);
    if (!o || isInvisible(o)) continue;
    const r = api.bounds(o);
    if (!r) continue;
    const a = worldToScreen(cam, { x: r.x, y: r.y + r.h });
    const sw = r.w * cam.z;
    if (sw < 48 || a.x > width || a.y > height + 10 || a.x + sw < 0 || a.y < -40) continue;
    rows.push(
      <div key={id} className="collab-reactions" data-reactions={id} style={{ transform: `translate(${Math.round(a.x)}px, ${Math.round(a.y + 6)}px)`, maxWidth: Math.max(sw, 120) }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {groups.map((g) => (
          <button
            key={g.emoji}
            className={`collab-chip${g.mine ? ' is-mine' : ''}`}
            data-tip={`${peopleText(g.people, me.key)} ${g.people.length === 1 && !g.mine ? 'hat' : 'haben'} mit ${g.emoji} reagiert`.replace(/^du haben/, 'Du hast')}
            aria-label={`${g.emoji} ${g.people.length}: ${peopleText(g.people, me.key)}`}
            onClick={() => toggleReaction(api.store, [id], g.emoji, me)}
          >
            <span className="collab-chip__e">{g.emoji}</span>
            <span className="collab-chip__n">{g.people.length}</span>
          </button>
        ))}
      </div>,
    );
  }
  return <div className="collab-layer">{rows}</div>;
}
