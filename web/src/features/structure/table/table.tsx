// Tabellen: Zellen per Doppelklick/Tippen bearbeiten (Tab, Enter wandern), Zeilen/Spalten
// hinzufügen und löschen, Spaltenbreite an der Grenze ziehen, Kopfzeile/-spalte.
import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import type { BoardObject } from '../../../protocol';
import { textOn } from '../../../board/colors';
import { placeStyle } from '../../../editor/render/format';
import { useFontsVersion } from '../../../editor/textMeasure';
import { defineContextAction, defineObjectType, defineSlot } from '../../../editor/ext/registry';
import { PopBtn } from '../../../editor/ContextBar';
import type { CtxProps, EditCallbacks, EditorApi, ObjectViewProps, SlotProps } from '../../../editor/ext/types';
import { editorApi } from '../bridge';
import type { TableData } from '../model';
import { IconColAdd, IconColDel, IconHead, IconRowAdd, IconRowDel } from '../icons';
import { cellText, colWidths, matrix, MIN_COL_PX, nextCell, rowHeights, safeTable } from './model';
import { hasHeadCol, hasHeadRow, headOf, headPatch, newTable, TABLE_HEAD_COLORS, TABLE_HEADS, tableEnv, tableResize } from './create';
import { cellMeasure } from './measure';
import { addCol, addRow, cellSource, migrateCell, removeCol, removeRow, resizeCol } from './yjs';
import { bindField } from '../ytext';

export { cellMeasure };

export { TABLE_HEAD_COLORS, newTable, tableEnv };

// ---- Aktive Zelle (lokal, je Tabelle) --------------------------------------------------------------------------------

type Cell = { r: string; c: string };
const activeCells = new Map<string, Cell>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function setActiveCell(id: string, cell: Cell) {
  activeCells.set(id, cell);
  listeners.forEach((fn) => fn());
}
/** Aktive Zelle; ungültige (gelöschte) fallen auf die erste Zelle zurück. */
export function activeCell(o: BoardObject, d: TableData = safeTable(o.table)): Cell {
  const a = activeCells.get(o.id);
  if (a && d.rows.includes(a.r) && d.cols.includes(a.c)) return a;
  return { r: d.rows[0], c: d.cols[0] };
}
const useActive = (o: BoardObject, d: TableData) => {
  useSyncExternalStore(subscribe, () => activeCells.get(o.id));
  return activeCell(o, d);
};
/** Beim Tippen auf eine ausgewählte Tabelle: Zeichen, die in die Zelle gehören */
const typed = new Map<string, string>();

// ---- Ansicht --------------------------------------------------------------------------------------------------------

function TableView({ o, editing, selected, cb }: ObjectViewProps) {
  useFontsVersion();
  const d = safeTable(o.table);
  const widths = colWidths(d, o.w);
  const raw = rowHeights(d, widths, cellMeasure, hasHeadRow(o));
  // andere Schrift-Metrik bzw. fremde Änderung: Zeilen auf die gespeicherte Höhe strecken
  const k = o.h / (raw.reduce((a, b) => a + b, 0) || 1);
  const heights = raw.map((h) => h * k);
  const act = useActive(o, d);
  const head = o.color ?? TABLE_HEAD_COLORS[0];
  const headRow = hasHeadRow(o);
  const headCol = hasHeadCol(o);
  return (
    <div className={`obj structure-table${selected ? ' is-selected' : ''}`} data-id={o.id} data-type="table" style={placeStyle(o, { '--head': head, '--head-ink': textOn(head) } as CSSProperties)}>
      <div className="structure-table__grid" style={{ gridTemplateColumns: widths.map((w) => `${w}px`).join(' '), gridTemplateRows: heights.map((h) => `${h}px`).join(' ') }}>
        {d.rows.map((r, i) =>
          d.cols.map((c, j) => {
            const isAct = (selected || editing) && act.r === r && act.c === c;
            const cls = ['structure-table__cell', headRow && i === 0 && 'is-head', headCol && j === 0 && !(headRow && i === 0) && 'is-headcol', isAct && 'is-active', editing && isAct && 'is-editing']
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={`${r}:${c}`}
                className={cls}
                data-cell={`${i}:${j}`}
                onPointerDown={(e) => {
                  setActiveCell(o.id, { r, c });
                  // beim Bearbeiten: andere Zelle übernehmen, statt die Bearbeitung zu beenden
                  if (editing) e.stopPropagation();
                }}
              >
                {cellText(d, r, c)}
              </div>
            );
          }),
        )}
      </div>
      {editing && <CellEditor o={o} d={d} widths={widths} heights={heights} cell={act} cb={cb} />}
      {selected && !editing && !o.locked && <ColGrips o={o} d={d} widths={widths} />}
    </div>
  );
}

function CellEditor({ o, d, widths, heights, cell, cb }: { o: BoardObject; d: TableData; widths: number[]; heights: number[]; cell: Cell; cb: EditCallbacks }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = `${cell.r}:${cell.c}`;
  // Zelle live an Yjs binden (ytext.ts): fremde Eingaben erscheinen sofort, gleichzeitiges Tippen wird zusammengeführt
  useLayoutEffect(() => {
    const el = ref.current;
    const api = editorApi();
    if (!el || !api) return;
    const { store } = api;
    migrateCell(store, o.id, cell.r, cell.c);
    const src = cellSource(store, o.id, cell.r, cell.c, tableEnv);
    // erstes Zeichen beim Tippen auf die ausgewählte Tabelle
    const extra = typed.get(o.id) ?? '';
    typed.delete(o.id);
    if (extra) src.write({ index: src.read().length, del: 0, ins: extra });
    const off = bindField(el, src, store.subscribe);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id, key]);
  const ci = d.cols.indexOf(cell.c);
  const ri = d.rows.indexOf(cell.r);
  const left = widths.slice(0, ci).reduce((a, b) => a + b, 0);
  const top = heights.slice(0, ri).reduce((a, b) => a + b, 0);
  const go = (next: Cell | null) => {
    if (next) setActiveCell(o.id, next);
    else ref.current?.blur();
  };
  return (
    <textarea
      ref={ref}
      className={`structure-table__editor${hasHeadRow(o) && ri === 0 ? ' is-head' : ''}${hasHeadCol(o) && ci === 0 && !(hasHeadRow(o) && ri === 0) ? ' is-headcol' : ''}`}
      style={{ left, top, width: widths[ci], height: heights[ri] }}
      defaultValue={cellText(d, cell.r, cell.c)}
      aria-label={`Zelle Zeile ${ri + 1}, Spalte ${ci + 1}`}
      spellCheck
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          e.preventDefault();
          let next = nextCell(d, cell.r, cell.c, e.shiftKey ? 'prev' : 'next');
          // Tab in der letzten Zelle: neue Zeile (wie in Tabellenprogrammen)
          const api = editorApi();
          const now = api?.store.get(o.id);
          if (!next && !e.shiftKey && api && now) next = { r: addRow(api.store, now, tableEnv(now)), c: d.cols[0] };
          go(next);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          go(nextCell(d, cell.r, cell.c, 'down'));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onBlur={(e) => cb.onEditDone(o.id, e.currentTarget.closest('.obj'))}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/** Spaltengrenzen ziehen (Gesamtbreite bleibt). */
function ColGrips({ o, d, widths }: { o: BoardObject; d: TableData; widths: number[] }) {
  let x = 0;
  return (
    <>
      {widths.slice(0, -1).map((w, i) => {
        x += w;
        return (
          <div
            key={d.cols[i]}
            className="structure-table__grip"
            style={{ left: x }}
            role="separator"
            aria-orientation="vertical"
            aria-label={`Breite Spalte ${i + 1}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const api = editorApi();
              if (!api) return;
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const start = e.clientX;
              const base = widths.slice();
              api.store.stopCapturing();
              const move = (ev: PointerEvent) => {
                const dx = (ev.clientX - start) / api.camera().z;
                const a = Math.max(MIN_COL_PX, Math.min(base[i] + base[i + 1] - MIN_COL_PX, base[i] + dx));
                const px = base.slice();
                px[i] = a;
                px[i + 1] = base[i] + base[i + 1] - a;
                const now = api.store.get(o.id);
                if (now) resizeCol(api.store, now, tableEnv(now), i, px);
              };
              const up = () => {
                el.removeEventListener('pointermove', move);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
                api.store.stopCapturing();
              };
              el.addEventListener('pointermove', move);
              el.addEventListener('pointerup', up);
              el.addEventListener('pointercancel', up);
            }}
          />
        );
      })}
    </>
  );
}

defineObjectType({
  type: 'table',
  label: 'Tabelle',
  View: TableView,
  simpleStyle: (o) => ({ background: '#fff', boxShadow: `inset 0 ${Math.max(6, Math.min(o.h * 0.2, 40))}px 0 ${o.color ?? TABLE_HEAD_COLORS[0]}, inset 0 0 0 2px #d9d9d3`, borderRadius: 6 }),
  defaultSize: { w: 480, h: 126 },
  create: (p) => newTable(p),
  edit: 'text',
  // Tippen auf die ausgewählte Tabelle: Zeichen in die aktive Zelle statt ins Feld `text`
  adjustPatch: (o, p) => {
    if (!('text' in p)) return p;
    typed.set(o.id, (typed.get(o.id) ?? '') + (p.text ?? '').slice((o.text ?? '').length));
    const { text: _t, ...rest } = p;
    return rest;
  },
  onEditDone: (o, api) => {
    // Rich-Text-Engines schreiben evtl. trotzdem `text`: nicht im Tabellenobjekt lassen
    if (o.text !== undefined || o.content !== undefined) api.store.update(o.id, { text: undefined, content: undefined });
  },
  palette: TABLE_HEAD_COLORS,
  defaultColor: TABLE_HEAD_COLORS[0],
  anchorable: true,
  handles: () => ['e', 'w'],
  sideResize: 'width',
  resize: (o, base) => ({ ...base, ...tableResize(o, base.w ?? o.w) }),
  plainText: (o) =>
    matrix(safeTable(o.table))
      .map((r) => r.join('\t'))
      .join('\n'),
});


// ---- Kontextleiste ----------------------------------------------------------------------------------------------------

function withTable(p: CtxProps, fn: (api: EditorApi, o: BoardObject, cell: Cell) => void) {
  const o = p.api.store.get(p.single!.id);
  if (!o) return;
  p.api.store.stopCapturing();
  fn(p.api, o, activeCell(o));
  p.api.store.stopCapturing();
}

defineContextAction({
  id: 'structure.table',
  order: 74,
  when: (c) => !!c.single && c.single.type === 'table' && !c.locked,
  Bar: (p) => {
    const d = safeTable(p.single!.table);
    return (
      <div className="ctx-group">
        <button className="ctx-btn" aria-label="Zeile einfügen" title="Zeile darunter einfügen" onClick={() => withTable(p, (api, o, c) => setActiveCell(o.id, { r: addRow(api.store, o, tableEnv(o), c.r), c: c.c }))}>
          <IconRowAdd />
        </button>
        <button className="ctx-btn" aria-label="Spalte einfügen" title="Spalte rechts einfügen" onClick={() => withTable(p, (api, o, c) => setActiveCell(o.id, { r: c.r, c: addCol(api.store, o, tableEnv(o), c.c) }))}>
          <IconColAdd />
        </button>
        <button className="ctx-btn" aria-label="Zeile löschen" title="Zeile löschen" disabled={d.rows.length <= 1} onClick={() => withTable(p, (api, o, c) => removeRow(api.store, o, tableEnv(o), c.r))}>
          <IconRowDel />
        </button>
        <button className="ctx-btn" aria-label="Spalte löschen" title="Spalte löschen" disabled={d.cols.length <= 1} onClick={() => withTable(p, (api, o, c) => removeCol(api.store, o, tableEnv(o), c.c))}>
          <IconColDel />
        </button>
        <PopBtn open={p.pop === 'tableHead'} onToggle={p.togglePop('tableHead')} label="Kopfbereich">
          <IconHead />
        </PopBtn>
      </div>
    );
  },
  pops: {
    tableHead: {
      className: 'ctx-pop--row',
      label: 'Kopfbereich',
      Body: (p) => (
        <>
          {TABLE_HEADS.map((h) => (
            <button
              key={h.head}
              className={`ctx-chip${headOf(p.first) === h.head ? ' is-active' : ''}`}
              onClick={() =>
                p.choose((o) => headPatch(o, h.head))
              }
            >
              {h.label}
            </button>
          ))}
        </>
      ),
    },
  },
});

// ---- Plus-Knöpfe am Rand (Bildschirm-Ebene) ----------------------------------------------------------------------------

function TableAdd({ api, snap, selection, cam }: SlotProps) {
  const o = selection.length === 1 ? snap.byId.get(selection[0]) : undefined;
  if (!o || o.type !== 'table' || o.locked || o.rotation) return null;
  const tl = api.toScreen({ x: o.x, y: o.y });
  const w = o.w * cam.z;
  const h = o.h * cam.z;
  const add = (fn: (o: BoardObject) => void) => () => {
    const now = api.store.get(o.id);
    if (!now) return;
    api.store.stopCapturing();
    fn(now);
    api.store.stopCapturing();
  };
  return (
    <>
      <button
        className="structure-table-add structure-table-add--col"
        style={{ transform: `translate(${tl.x + w + 14}px, ${tl.y + h / 2}px) translate(-50%, -50%)` }}
        aria-label="Spalte anhängen"
        title="Spalte anhängen"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={add((t) => addCol(api.store, t, tableEnv(t)))}
      >
        +
      </button>
      <button
        className="structure-table-add structure-table-add--row"
        style={{ transform: `translate(${tl.x + w / 2}px, ${tl.y + h + 14}px) translate(-50%, -50%)` }}
        aria-label="Zeile anhängen"
        title="Zeile anhängen"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={add((t) => addRow(api.store, t, tableEnv(t)))}
      >
        +
      </button>
    </>
  );
}

defineSlot({ id: 'structure.tableAdd', slot: 'overlay', order: 20, Component: TableAdd });
