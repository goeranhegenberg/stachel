// Notiz-Stapel im Browser (Quick Win Q2, Modell in model.ts): Haftnotiz mittig auf eine andere ziehen legt sie auf den
// Stapel. Die oberste Notiz zeigt Papierkanten darunter und oben rechts die Anzahl (Klick = nächste Notiz, Mausrad bzw.
// Wischen über der Zahl blättert); ist der ganze Stapel gewählt, bietet die Kontextleiste Vorige/Nächste, Auffächern und
// Oberste abnehmen.
import { nanoid } from 'nanoid';
import { useMemo, type PointerEvent as RPointerEvent } from 'react';
import { worldToScreen } from '../../../board/geometry';
import { defineContextAction, defineObjectType, defineSlot, objectTypes } from '../../../editor/ext/registry';
import type { CtxProps, EditorApi, ObjectViewProps, SlotProps } from '../../../editor/ext/types';
import { placeStyle } from '../../../editor/render/format';
import { allStacks, cycleStack, dropNotes, inStack, selectedStack, spreadStack, stackOf, takeFromStack } from './model';
import './stack.css';

/** Eine Änderung als eigener Rückgängig-Schritt, danach `select` wählen (falls etwas geändert wurde). */
function step(api: EditorApi, fn: () => string[] | string | null) {
  api.store.stopCapturing();
  const r = fn();
  api.store.stopCapturing();
  if (r) api.setSelection(Array.isArray(r) ? r : stackOf(api.store.get(r) ?? undefined, api.snapshot()).map((o) => o.id));
}

export const stackCycle = (api: EditorApi, id: string, dir: 1 | -1) => step(api, () => (cycleStack(api.store, id, dir) ? id : null));
export const stackSpread = (api: EditorApi, id: string) => step(api, () => spreadStack(api.store, id));
export const stackTake = (api: EditorApi, id: string, which?: string) =>
  step(api, () => {
    const off = takeFromStack(api.store, id, which);
    return off ? [off] : null;
  });

// ---- Darstellung: Papierkanten unter der Notiz ----------------------------------------------------------------------

const base = objectTypes.get('sticky')!;
const BaseView = base.View;

function StackedStickyView(p: ObjectViewProps) {
  const o = p.o;
  const on = inStack(o);
  const fill = o.color ?? '#fff27a';
  // immer dieselbe Baumform: Stapeln während einer Bearbeitung baut die Notiz nicht neu auf
  return (
    <>
      {on && <div className="obj shapes-stack-edge shapes-stack-edge--2" style={placeStyle({ ...o, x: o.x + 10, y: o.y + 10 }, { background: fill })} aria-hidden="true" />}
      {on && <div className="obj shapes-stack-edge" style={placeStyle({ ...o, x: o.x + 5, y: o.y + 5 }, { background: fill })} aria-hidden="true" />}
      <BaseView {...p} />
    </>
  );
}

defineObjectType({
  ...base,
  View: StackedStickyView,
  // neue Notiz daneben (Plus-Griff, Tab) liegt nicht auf dem Stapel
  sibling: (o) => ({ ...(base.sibling?.(o) ?? {}), stacked: undefined }),
  // Ablegen auf einer anderen Haftnotiz → Stapel; aus einem Stapel herausgezogen → einzeln (im Schritt der Bewegung)
  afterMove: (moved, api, grabbed) => {
    const sel = dropNotes(
      api.store,
      moved.map((o) => o.id),
      grabbed,
      () => nanoid(10),
    );
    if (sel) api.setSelection(sel);
  },
});

// ---- Anzahl oben rechts (Bildschirm) ---------------------------------------------------------------------------------

const stopBoard = (e: RPointerEvent) => e.stopPropagation();

function StackBadges({ api, cam, snap, selection, width, height }: SlotProps) {
  const stacks = useMemo(() => allStacks(snap), [snap]);
  const sel = selectedStack(selection, snap);
  const items: { id: string; top: string; n: number; x: number; y: number; active: boolean }[] = [];
  for (const [g, members] of stacks) {
    const top = members[members.length - 1]!;
    if (top.w * cam.z < 40 || api.editingId() === top.id) continue;
    const s = worldToScreen(cam, { x: top.x + top.w, y: top.y });
    if (s.x < -40 || s.y < -40 || s.x > width + 40 || s.y > height + 40) continue;
    items.push({ id: g, top: top.id, n: members.length, x: s.x, y: s.y, active: !!sel && sel[0]!.groupId === g });
  }
  if (!items.length) return null;
  return (
    <div className="shapes-stack-layer">
      {items.map((it) => (
        <span key={it.id} className={`shapes-stack-badge${it.active ? ' is-active' : ''}`} style={{ transform: `translate(${Math.round(it.x - 6)}px, ${Math.round(it.y + 6)}px) translate(-100%, 0)` }} data-testid="stack-badge">
          {it.active && (
            <button className="shapes-stack-badge__btn" aria-label="Vorige Notiz" title="Vorige Notiz" onPointerDown={stopBoard} onClick={() => stackCycle(api, it.top, -1)}>
              ‹
            </button>
          )}
          <button
            className="shapes-stack-badge__n"
            aria-label={`Stapel mit ${it.n} Notizen – nächste Notiz zeigen`}
            title="Nächste Notiz"
            onPointerDown={stopBoard}
            onClick={() => stackCycle(api, it.top, 1)}
            onWheel={(e) => {
              e.stopPropagation();
              if (Math.abs(e.deltaY) + Math.abs(e.deltaX) > 4) stackCycle(api, it.top, e.deltaY + e.deltaX > 0 ? 1 : -1);
            }}
          >
            {it.n}
          </button>
          {it.active && (
            <button className="shapes-stack-badge__btn" aria-label="Nächste Notiz" title="Nächste Notiz" onPointerDown={stopBoard} onClick={() => stackCycle(api, it.top, 1)}>
              ›
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

defineSlot({ id: 'shapes.stacks', slot: 'overlay', order: 40, Component: StackBadges });

// ---- Kontextleiste: ganzer Stapel gewählt bzw. eine Notiz daraus ------------------------------------------------------

function IconSpread() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
    </svg>
  );
}

function IconTake() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round">
      <rect x="3" y="7" width="10" height="10" />
      <path d="M5 5h10v10" opacity=".6" />
      <path d="M15 12h6m-2.5-2.5L21 12l-2.5 2.5" />
    </svg>
  );
}

function StackBar({ api, selected }: CtxProps) {
  const snap = api.snapshot();
  const whole = selectedStack(
    selected.map((o) => o.id),
    snap,
  );
  const one = !whole && selected.length === 1 && stackOf(selected[0], snap).length ? selected[0]! : null;
  if (!whole && !one) return null;
  const id = (whole ?? [one!])[0]!.id;
  return (
    <div className="ctx-group" data-testid="stack-bar">
      {whole && (
        <>
          <button className="ctx-btn" aria-label="Vorige Notiz" title="Vorige Notiz" onClick={() => stackCycle(api, id, -1)}>
            ‹
          </button>
          <span className="shapes-stack-count" title={`${whole.length} Notizen im Stapel`}>
            {whole.length}
          </span>
          <button className="ctx-btn" aria-label="Nächste Notiz" title="Nächste Notiz" onClick={() => stackCycle(api, id, 1)}>
            ›
          </button>
          <button className="ctx-btn" aria-label="Stapel auffächern" title="Auffächern" onClick={() => stackSpread(api, id)}>
            <IconSpread />
          </button>
        </>
      )}
      <button className="ctx-btn" aria-label={whole ? 'Oberste Notiz abnehmen' : 'Vom Stapel nehmen'} title={whole ? 'Oberste abnehmen' : 'Vom Stapel nehmen'} onClick={() => stackTake(api, id, one?.id)}>
        <IconTake />
      </button>
    </div>
  );
}

defineContextAction({
  id: 'shapes.stack',
  order: 22,
  when: (c) => !c.locked && c.types.size === 1 && c.types.has('sticky') && c.selected.some((o) => inStack(o)),
  Bar: StackBar,
});
