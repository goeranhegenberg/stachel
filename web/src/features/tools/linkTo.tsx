// Objekt-Links („Link zu …“): ein Objekt verweist auf ein anderes Objekt oder einen Rahmen desselben Boards.
// Am Objekt erscheint ein kleiner Pfeil-Knopf; ein Klick fährt zum Ziel und wählt es aus (auch in der Präsentation).
// Feld `linkTo` (Objekt-id), docs/features/tools.md.
import { useEffect, useSyncExternalStore } from 'react';
import type { BoardObject } from '../../protocol';
import { expand } from '../../board/geometry';
import { isInvisible } from '../../board/types';
import { PopBtn } from '../../editor/ContextBar';
import { defineContextAction, defineMenuItem, defineSlot } from '../../editor/ext/registry';
import type { CtxProps, EditorApi, SlotProps } from '../../editor/ext/types';
import { IconJump } from './icons';

/** Typen ohne Link (Linien, Striche) */
const NO_LINK = new Set(['connector', 'pen']);
export const linkable = (o: BoardObject) => !NO_LINK.has(o.type);

/** Name eines Ziels für Liste und Hinweis */
export function targetName(o: BoardObject): string {
  if (o.type === 'frame') return o.title?.trim() || 'Rahmen';
  const t = (o.text ?? '').trim().split('\n')[0];
  return t ? (t.length > 30 ? `${t.slice(0, 29)}…` : t) : 'Objekt';
}

/** Zum Ziel fahren und es auswählen. */
export function followLink(api: EditorApi, o: BoardObject) {
  const target = o.linkTo ? api.snapshot().byId.get(o.linkTo) : undefined;
  if (!target || isInvisible(target)) {
    api.toast('Das verlinkte Ziel gibt es nicht mehr.');
    return;
  }
  const r = api.bounds(target);
  if (r) api.fitTo(expand(r, Math.max(40, Math.max(r.w, r.h) * 0.15)), target.type === 'frame' ? 4 : 1.5);
  if (!api.presenting()) api.setSelection([target.id]);
}

// ---- Ziel wählen: nächster Klick aufs Board ---------------------------------------------------------------------

let picking: string[] | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const usePicking = () => useSyncExternalStore(subscribe, () => picking);

export function startPicking(api: EditorApi, ids: string[] = api.selection()) {
  const src = ids.filter((id) => {
    const o = api.snapshot().byId.get(id);
    return o && linkable(o) && !o.locked;
  });
  if (!src.length) return;
  picking = src;
  emit();
}
export function stopPicking() {
  if (!picking) return;
  picking = null;
  emit();
}

/** Link setzen bzw. entfernen (ein Undo-Schritt). */
export function setLink(api: EditorApi, ids: string[], target: string | undefined) {
  const valid = ids.filter((id) => id !== target);
  if (!valid.length) return;
  api.store.stopCapturing();
  api.store.updateMany(Object.fromEntries(valid.map((id) => [id, { linkTo: target }])));
  api.store.stopCapturing();
}

function objectAt(api: EditorApi, clientX: number, clientY: number, board: HTMLElement): BoardObject | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const hit = (el as HTMLElement).closest?.('.world [data-id]') as HTMLElement | null;
    if (hit && board.contains(hit)) {
      const o = api.snapshot().byId.get(hit.dataset.id!);
      if (o && !isInvisible(o)) return o;
    }
  }
  const r = board.getBoundingClientRect();
  return api.hitTest(api.toWorld({ x: clientX - r.left, y: clientY - r.top }), (o) => isInvisible(o));
}

/** Overlay: fängt beim Wählen den nächsten Klick ab und zeigt die Link-Knöpfe an verlinkten Objekten. */
export function LinkLayer({ api, cam, snap, width, height }: SlotProps) {
  const pick = usePicking();
  useEffect(() => {
    if (!pick) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      stopPicking();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [pick]);

  const badges: { o: BoardObject; x: number; y: number }[] = [];
  if (!pick)
    for (const o of snap.ordered) {
      if (!o.linkTo || isInvisible(o) || !linkable(o)) continue;
      const r = api.bounds(o);
      if (!r) continue;
      const p = api.toScreen({ x: r.x + r.w, y: r.y });
      if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20) continue;
      // bei sehr kleiner Darstellung kein Knopf
      if (r.w * cam.z < 24 && r.h * cam.z < 24) continue;
      badges.push({ o, x: p.x, y: p.y });
    }

  return (
    <>
      {badges.map(({ o, x, y }) => {
        const t = snap.byId.get(o.linkTo!);
        return (
          <button
            key={o.id}
            type="button"
            className={`tools-linkto${t && !isInvisible(t) ? '' : ' is-broken'}`}
            data-link-for={o.id}
            style={{ left: x, top: y }}
            aria-label={t ? `Gehe zu: ${targetName(t)}` : 'Link-Ziel fehlt'}
            title={t ? `Gehe zu: ${targetName(t)}` : 'Das verlinkte Ziel gibt es nicht mehr.'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              followLink(api, o);
            }}
          >
            <IconJump size={14} />
          </button>
        );
      })}
      {pick && (
        <>
          <div
            className="tools-linkto-catch"
            data-testid="linkto-catch"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              const board = e.currentTarget.closest<HTMLElement>('.board')!;
              const target = objectAt(api, e.clientX, e.clientY, board);
              const src = pick;
              stopPicking();
              if (!target) return;
              if (src.includes(target.id) && src.length === 1) return api.toast('Ein Objekt kann nicht auf sich selbst verlinken.');
              setLink(api, src, target.id);
              api.setSelection(src);
              api.toast(`Verlinkt mit „${targetName(target)}“.`);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              stopPicking();
            }}
          />
          <div className="tools-painter-pill panel" role="status" onPointerDown={(e) => e.stopPropagation()}>
            <IconJump size={18} />
            <span>Link-Ziel anklicken (Objekt oder Rahmen)</span>
            <button className="tools-painter-pill__done" onClick={stopPicking}>
              Abbrechen
            </button>
          </div>
        </>
      )}
    </>
  );
}

defineSlot({ id: 'tools.linkTo', slot: 'overlay', order: 61, Component: LinkLayer, presenting: true });

// ---- Kontextleiste: Link zu Rahmen/Objekt ---------------------------------------------------------------------

function LinkBar(p: CtxProps) {
  const linked = p.selected.some((o) => o.linkTo);
  return (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'linkTo'} onToggle={p.togglePop('linkTo')} label="Link zu Rahmen oder Objekt" active={linked}>
        <IconJump />
      </PopBtn>
    </div>
  );
}

function LinkPop(p: CtxProps) {
  const ids = p.selected.map((o) => o.id);
  const frames = p.api.snapshot().ordered.filter((o) => o.type === 'frame' && !isInvisible(o) && !ids.includes(o.id));
  const current = p.single?.linkTo ? p.api.snapshot().byId.get(p.single.linkTo) : undefined;
  return (
    <div className="tools-linkto-pop">
      {current && (
        <div className="tools-linkto-pop__current">
          <span>Verlinkt mit „{targetName(current)}“</span>
        </div>
      )}
      {frames.length > 0 && (
        <div className="tools-linkto-pop__list" role="group" aria-label="Rahmen">
          {frames.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tools-linkto-pop__item${p.single?.linkTo === f.id ? ' is-active' : ''}`}
              onClick={() => {
                p.closePop();
                setLink(p.api, ids, f.id);
              }}
            >
              {targetName(f)}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="tools-linkto-pop__item tools-linkto-pop__pick"
        onClick={() => {
          p.closePop();
          startPicking(p.api, ids);
        }}
      >
        Ziel auf dem Board wählen …
      </button>
      {p.selected.some((o) => o.linkTo) && (
        <button
          type="button"
          className="tools-linkto-pop__item tools-linkto-pop__remove"
          onClick={() => {
            p.closePop();
            setLink(p.api, ids, undefined);
          }}
        >
          Link entfernen
        </button>
      )}
    </div>
  );
}

defineContextAction({
  id: 'tools.linkTo',
  order: 88,
  when: (c) => !c.locked && c.selected.every(linkable),
  Bar: LinkBar,
  pops: { linkTo: { className: 'tools-linkto-popwrap', label: 'Link zu Rahmen oder Objekt', Body: LinkPop } },
});

defineMenuItem({
  id: 'tools.linkTo',
  on: 'object',
  order: 77,
  item: (api) => {
    const sel = api.selected();
    const linked = sel.find((o) => o.linkTo);
    return {
      label: 'Link zu …',
      disabled: !sel.length || !sel.every(linkable) || sel.every((o) => o.locked),
      items: [
        { label: 'Ziel auf dem Board wählen', onSelect: () => startPicking(api) },
        ...(linked ? [{ label: 'Zum Ziel springen', onSelect: () => followLink(api, linked) }] : []),
        ...(linked ? [{ label: 'Link entfernen', onSelect: () => setLink(api, api.selection(), undefined) }] : []),
      ],
    };
  },
});
