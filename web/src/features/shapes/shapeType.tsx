// Typ „shape“ mit Formen-Bibliothek: Deckkraft der Füllung, Randart gepunktet, offene Formen (Klammern),
// Startgröße je Bibliothekseintrag. Dazu die Kontextleiste der Form (ersetzt core.shape): Form, Füllung, Rand.
import { useState, type CSSProperties } from 'react';
import type { BoardObject, DashStyle, ShapeKind } from '../../protocol';
import { INK_COLORS, textOn } from '../../board/colors';
import { dashArray } from '../../board/connector';
import { defineContextAction, defineObjectType, objectTypes, shapeKinds } from '../../editor/ext/registry';
import { getToolOption } from '../../editor/ext/toolOptions';
import type { CtxProps, ObjectViewProps } from '../../editor/ext/types';
import { PopBtn } from '../../editor/ContextBar';
import { IconDash } from '../../editor/interaction/icons';
import { RemoteHint } from '../../editor/core/objectTypes';
import { shapeInsets, shapePath } from '../../editor/core/shapeKinds';
import { flexAlign, formatStyle, placeStyle, textFormat, valignOf } from '../../editor/render/format';
import { textEngine } from '../../editor/text/engine';
import { shapeFontSize, useFontsVersion } from '../../editor/textMeasure';
import { entryById, entryOfKind, matches } from './catalog';
import { isOpenKind } from './geometry';
import { ShapeIcon } from './kinds';
import { fillOpacityOf } from './model';
import { CustomColor, livePatch, nameOf, OpacitySlider, SHAPE_PALETTE, withAlpha } from './palette';

const BORDER_WIDTHS = [0, 1, 2, 4, 8];
const DASHES: { dash: DashStyle; label: string }[] = [
  { dash: 'solid', label: 'Durchgezogen' },
  { dash: 'dashed', label: 'Gestrichelt' },
  { dash: 'dotted', label: 'Gepunktet' },
];

/** Strichmuster des Rands (gepunktet: runde Punkte). */
export function borderDash(dash: string | undefined, sw: number): string | undefined {
  if (sw <= 0) return undefined;
  if (dash === 'dotted') return `0 ${Math.round((sw * 2 + 3) * 100) / 100}`;
  return dash === 'dashed' ? dashArray('dashed', sw) : undefined;
}

export function ShapeView({ o, editing, remoteName, cb }: ObjectViewProps) {
  useFontsVersion();
  const [foreign, setForeign] = useState(false);
  const sw = Math.max(0, o.strokeWidth ?? 2);
  const fill = o.color ?? '#ffffff';
  const open = isOpenKind(o.shape);
  const alpha = open ? 0 : fillOpacityOf(o);
  const [t, r, b, l] = shapeInsets(o.shape, o.w, o.h);
  const fs = shapeFontSize(o.text ?? '', o.fontSize ?? 20, o.w - l - r, o.h - t - b, textFormat(o));
  // durchscheinende Füllung: Text wie auf dem Board-Hintergrund
  const ink = alpha < 0.5 ? '#0a0a0a' : textOn(fill);
  const tStyle: CSSProperties = { fontSize: fs, color: ink, ...formatStyle(o, 600, 'center') };
  const inner: CSSProperties = { padding: `${t}px ${r}px ${b}px ${l}px`, alignItems: flexAlign(valignOf(o)) };
  const T = textEngine();
  return (
    <div className="obj obj-shape" data-id={o.id} data-type="shape" data-shape={o.shape ?? 'rect'} style={placeStyle(o)}>
      <svg width={o.w} height={o.h} className="shape-svg" aria-hidden="true">
        <path
          d={shapePath(o.shape, o.w, o.h, sw / 2)}
          fill={open ? 'none' : fill}
          fillOpacity={alpha < 1 ? alpha : undefined}
          stroke={sw > 0 ? (o.stroke ?? '#0a0a0a') : 'none'}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeLinecap={o.dash === 'dotted' || open ? 'round' : undefined}
          strokeDasharray={borderDash(o.dash, sw)}
        />
      </svg>
      <div className="shape-text-wrap" style={inner}>
        {editing ? <T.Edit o={o} variant="shape" className="shape-text" style={tStyle} cb={cb} onForeign={setForeign} /> : <T.View o={o} variant="shape" className="shape-text" style={tStyle} />}
      </div>
      {editing && foreign && <RemoteHint name={remoteName} />}
    </div>
  );
}

/** Größe des gewählten Bibliothekseintrags (bzw. der ersten passenden Form). */
function entrySize(): { w: number; h: number } {
  const kind = getToolOption<ShapeKind>('shape', 'kind', 'rect');
  const e = entryById(getToolOption<string | undefined>('shape', 'entry', undefined));
  const pick = e?.kind === kind ? e : entryOfKind(kind);
  return pick ? { w: pick.w, h: pick.h } : { w: 180, h: 120 };
}

const core = objectTypes.get('shape')!;

defineObjectType({
  ...core,
  View: ShapeView,
  simpleStyle: (o) => {
    const base = core.simpleStyle?.(o) ?? {};
    if (isOpenKind(o.shape)) return { background: 'transparent', boxShadow: `inset ${Math.max(2, o.w * 0.06)}px 0 0 ${o.stroke ?? '#0a0a0a'}` };
    const a = fillOpacityOf(o);
    return a < 1 ? { ...base, background: withAlpha(o.color ?? '#ffffff', a) } : base;
  },
  // Startgröße folgt dem Eintrag aus der Bibliothek (Klick mit dem Formen-Werkzeug)
  defaultSize: {
    get w() {
      return entrySize().w;
    },
    get h() {
      return entrySize().h;
    },
  },
  create: (p) => {
    const { w, h } = entrySize();
    return {
      type: 'shape',
      shape: getToolOption<ShapeKind>('shape', 'kind', 'rect'),
      x: Math.round(p.x - w / 2),
      y: Math.round(p.y - h / 2),
      w,
      h,
      color: '#ffffff',
      stroke: '#0a0a0a',
      strokeWidth: 2,
      text: '',
      fontSize: 20,
    };
  },
  // Füllung hat eine eigene, größere Palette (Kontextleiste unten)
  colorable: false,
  palette: SHAPE_PALETTE,
});

// ---- Kontextleiste der Form -------------------------------------------------------------------------------------------

const onlyShapes = (c: { types: ReadonlySet<string> }) => c.types.size === 1 && c.types.has('shape');

function BorderIcon({ o }: { o: BoardObject }) {
  const sw = o.strokeWidth ?? 2;
  const stroke = o.stroke ?? '#0a0a0a';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth="2" />
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke={sw <= 0 ? 'none' : stroke === '#0a0a0a' ? 'currentColor' : stroke} strokeWidth={2.4} strokeDasharray={o.dash === 'dashed' ? '4 3' : o.dash === 'dotted' ? '0.1 3.6' : undefined} strokeLinecap="round" />
    </svg>
  );
}

function KindPop({ first, patch, closePop }: CtxProps) {
  const [q, setQ] = useState('');
  const list = shapeKinds.list().filter((s) => matches(q, s.label, entryOfKind(s.kind)?.keys));
  return (
    <>
      <input type="search" className="shapes-search shapes-search--pop" placeholder="Form suchen" aria-label="Form suchen" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
      <div className="shapes-kind-grid">
        {list.map((s) => (
          <button
            key={s.kind}
            className={`ctx-btn${(first.shape ?? 'rect') === s.kind ? ' is-active' : ''}`}
            aria-label={s.label}
            title={s.label}
            onClick={() => {
              patch(() => ({ shape: s.kind }));
              closePop();
            }}
          >
            {s.icon}
          </button>
        ))}
        {!list.length && <span className="shapes-empty">Keine Form gefunden</span>}
      </div>
    </>
  );
}

function FillPop({ api, first, patch }: CtxProps) {
  const current = first.color ?? '#ffffff';
  return (
    <>
      <div className="shapes-swatches">
        {SHAPE_PALETTE.map((c) => (
          <button key={c} className={`swatch${c === current ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Füllfarbe ${nameOf(c)}`} onClick={() => patch(() => ({ color: c }))} />
        ))}
      </div>
      <div className="shapes-pop-row">
        <CustomColor
          value={current}
          label="Eigene Füllfarbe"
          onPick={(hex) => {
            livePatch(api, () => ({ color: hex }));
          }}
        />
        <button className={`ctx-chip${fillOpacityOf(first) === 0 ? ' is-active' : ''}`} onClick={() => patch(() => ({ fillOpacity: 0 }))}>
          Ohne Füllung
        </button>
      </div>
      <OpacitySlider api={api} value={fillOpacityOf(first)} field="fillOpacity" />
    </>
  );
}

function BorderPop({ api, first, patch }: CtxProps) {
  const stroke = first.stroke ?? '#0a0a0a';
  const sw = first.strokeWidth ?? 2;
  const dash = first.dash === 'dashed' || first.dash === 'dotted' ? first.dash : 'solid';
  return (
    <>
      <div className="ctx-pop-swatches">
        {INK_COLORS.map((c) => (
          <button key={c} className={`swatch swatch--round${stroke === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Randfarbe ${nameOf(c)}`} onClick={() => patch(() => (sw === 0 ? { stroke: c, strokeWidth: 2 } : { stroke: c }))} />
        ))}
      </div>
      <div className="shapes-pop-row">
        <CustomColor value={stroke} label="Eigene Randfarbe" onPick={(hex) => livePatch(api, () => ({ stroke: hex }))} />
        {BORDER_WIDTHS.map((w) => (
          <button key={w} className={`ctx-chip${sw === w ? ' is-active' : ''}`} aria-label={`Randstärke ${w}`} onClick={() => patch(() => ({ strokeWidth: w }))}>
            {w === 0 ? 'Ohne' : w}
          </button>
        ))}
      </div>
      <div className="shapes-pop-row" role="group" aria-label="Randart">
        {DASHES.map((d) => (
          <button key={d.dash} className={`ctx-btn${dash === d.dash ? ' is-active' : ''}`} aria-label={d.label} title={d.label} aria-pressed={dash === d.dash} onClick={() => patch(() => ({ dash: d.dash === 'solid' ? undefined : d.dash }))}>
            <IconDash dash={d.dash} />
          </button>
        ))}
      </div>
    </>
  );
}

defineContextAction({
  id: 'core.shape',
  order: 10,
  when: (c) => !c.locked && onlyShapes(c),
  Bar: (p) => {
    const fill = p.first.color ?? '#ffffff';
    const a = isOpenKind(p.first.shape) ? 0 : fillOpacityOf(p.first);
    return (
      <div className="ctx-group">
        <PopBtn open={p.pop === 'shapes.kind'} onToggle={p.togglePop('shapes.kind')} label="Form">
          <ShapeIcon kind={p.first.shape ?? 'rect'} size={22} />
        </PopBtn>
        <PopBtn open={p.pop === 'shapes.fill'} onToggle={p.togglePop('shapes.fill')} label="Füllfarbe">
          <span className={`color-dot shapes-fill-dot${a < 1 ? ' is-translucent' : ''}`}>
            <span style={{ background: fill, opacity: a }} />
          </span>
        </PopBtn>
        <PopBtn open={p.pop === 'border'} onToggle={p.togglePop('border')} label="Rand">
          <BorderIcon o={p.first} />
        </PopBtn>
      </div>
    );
  },
  pops: {
    'shapes.kind': { className: 'shapes-pop shapes-pop--kinds', label: 'Form ändern', Body: KindPop },
    'shapes.fill': { className: 'shapes-pop shapes-pop--fill', label: 'Füllfarbe', Body: FillPop },
    border: { className: 'ctx-pop--border shapes-pop--border', label: 'Rand', Body: BorderPop },
  },
});
