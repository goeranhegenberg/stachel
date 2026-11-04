// Kern-Einträge der Kontextleiste (Reihenfolge 10–90). Feature-Module hängen eigene Gruppen dazwischen.
import type { ReactNode } from 'react';
import { STICKY_COLORS, type BoardObject, type DashStyle, type LineStyle, type TextAlign, type VerticalAlign } from '../../protocol';
import { INK_COLORS, SHAPE_FILLS } from '../../board/colors';
import { isWholeGroup } from '../../board/ops/groups';
import { align, distribute, type AlignMode } from '../../board/ops/arrange';
import { colorName } from '../../ui/a11y';
import { IconArrowEnd, IconBack, IconDuplicate, IconFront, IconLock, IconTrash, IconUnlock } from '../../ui/icons';
import {
  IconAlignBottom,
  IconAlignHCenter,
  IconAlignLeft,
  IconAlignMenu,
  IconAlignRight,
  IconAlignTop,
  IconAlignVCenter,
  IconArrowStart,
  IconBorder,
  IconDash,
  IconDistH,
  IconDistV,
  IconGroup,
  IconLineCurved,
  IconLineElbow,
  IconLineStraight,
  IconTextAlign,
  IconUngroup,
  IconVAlign,
} from '../interaction/icons';
import { PopBtn, Toggle } from '../ContextBar';
import { defineContextAction, shapeKinds, typeDef } from '../ext/registry';
import type { CtxInfo, CtxProps } from '../ext/types';
import { PEN_WIDTHS } from './tools';

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 160];
const CONNECTOR_WIDTHS = [1, 2, 4, 8];
const BORDER_WIDTHS = [0, 2, 4];

const LINE_STYLES: { style: LineStyle; label: string; icon: ReactNode }[] = [
  { style: 'straight', label: 'Gerade', icon: <IconLineStraight /> },
  { style: 'elbow', label: 'Gewinkelt', icon: <IconLineElbow /> },
  { style: 'curved', label: 'Geschwungen', icon: <IconLineCurved /> },
];
const DASHES: { dash: DashStyle; label: string }[] = [
  { dash: 'solid', label: 'Durchgezogen' },
  { dash: 'dashed', label: 'Gestrichelt' },
  { dash: 'dotted', label: 'Gepunktet' },
];
const ALIGNS: { mode: AlignMode; label: string; icon: ReactNode }[] = [
  { mode: 'left', label: 'Links ausrichten', icon: <IconAlignLeft /> },
  { mode: 'hcenter', label: 'Horizontal zentrieren', icon: <IconAlignHCenter /> },
  { mode: 'right', label: 'Rechts ausrichten', icon: <IconAlignRight /> },
  { mode: 'top', label: 'Oben ausrichten', icon: <IconAlignTop /> },
  { mode: 'vcenter', label: 'Vertikal zentrieren', icon: <IconAlignVCenter /> },
  { mode: 'bottom', label: 'Unten ausrichten', icon: <IconAlignBottom /> },
];
const TEXT_ALIGNS: { align: TextAlign; label: string }[] = [
  { align: 'left', label: 'Linksbündig' },
  { align: 'center', label: 'Zentriert' },
  { align: 'right', label: 'Rechtsbündig' },
];
const V_ALIGNS: { valign: VerticalAlign; label: string }[] = [
  { valign: 'top', label: 'Oben' },
  { valign: 'middle', label: 'Mitte' },
  { valign: 'bottom', label: 'Unten' },
];

// ---- Hilfen -------------------------------------------------------------------------------------------------------

const colorableOf = (sel: readonly BoardObject[]) => sel.filter((o) => typeDef(o).colorable !== false);

/** Gemeinsame Palette der Typen, sonst eine gemischte Auswahl. */
function paletteOf(objs: readonly BoardObject[]): readonly string[] {
  const palettes = new Set(objs.map((o) => typeDef(o).palette));
  const only = palettes.size === 1 ? [...palettes][0] : undefined;
  return only ?? [...new Set([...STICKY_COLORS.slice(0, 4), ...SHAPE_FILLS.slice(0, 5)])];
}

const currentColor = (objs: readonly BoardObject[]) => objs[0]?.color ?? (objs[0] ? typeDef(objs[0]).defaultColor : undefined) ?? '#0a0a0a';

const isTextual = (o: BoardObject) => !!typeDef(o).textual;
const fontTargets = (sel: readonly BoardObject[]) => sel.filter(isTextual);
const allTextual = (c: CtxInfo) => !c.locked && c.selected.length > 0 && c.selected.every(isTextual);
const defaultAlign = (o: BoardObject): TextAlign => o.align ?? typeDef(o).textAlign ?? 'center';
const only = (c: CtxInfo, type: string) => c.types.size === 1 && c.types.has(type);

/** Angezeigte Schriftgröße der ersten Text-Auswahl (bei „Auto“ die automatisch berechnete der Einzelauswahl). */
function fontInfo(c: CtxInfo) {
  const first = fontTargets(c.selected)[0];
  const def = typeDef(first);
  const auto = !!def.autoFont && first.fontSize === undefined;
  const size = first.fontSize ?? (def.autoFont ? (c.single ? def.autoFont(c.single) : 24) : (def.defaultFontSize ?? 20));
  return { first, auto, size };
}

// ---- Farbe --------------------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.color',
  order: 10,
  when: (c) => !c.locked && colorableOf(c.selected).length > 0,
  Bar: (p) => (
    <div className="ctx-group ctx-colors">
      <PopBtn open={p.pop === 'color'} onToggle={p.togglePop('color')} label="Farbe">
        <span className="color-dot" style={{ background: currentColor(colorableOf(p.selected)) }} />
      </PopBtn>
    </div>
  ),
  pops: {
    color: {
      // 12 Notizfarben in zwei Reihen zu sechs
      className: 'ctx-pop--colors',
      label: 'Farben',
      Body: (p) => {
        const objs = colorableOf(p.selected);
        const current = currentColor(objs);
        return paletteOf(objs).map((c) => (
          <button key={c} className={`swatch${c === current ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Farbe ${colorName(c)}`} onClick={() => p.choose((o) => (typeDef(o).colorable === false ? null : { color: c }))} />
        ));
      },
    },
  },
});

// ---- Form & Rand ----------------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.shape',
  order: 20,
  when: (c) => !c.locked && only(c, 'shape'),
  Bar: (p) => (
    <div className="ctx-group">
      {shapeKinds.list().map((s) => (
        <button
          key={s.kind}
          className={`ctx-btn${p.first.shape === s.kind || (!p.first.shape && s.kind === 'rect') ? ' is-active' : ''}`}
          aria-label={s.label}
          title={s.label}
          onClick={() => p.patch(() => ({ shape: s.kind }))}
        >
          {s.icon}
        </button>
      ))}
      <PopBtn open={p.pop === 'border'} onToggle={p.togglePop('border')} label="Rand">
        <IconBorder />
      </PopBtn>
    </div>
  ),
  pops: {
    border: {
      className: 'ctx-pop--border',
      label: 'Rand',
      Body: ({ first, patch }) => (
        <>
          <div className="ctx-pop-swatches">
            {INK_COLORS.map((c) => (
              <button key={c} className={`swatch swatch--round${(first.stroke ?? '#0a0a0a') === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Randfarbe ${colorName(c)}`} onClick={() => patch(() => ({ stroke: c }))} />
            ))}
          </div>
          <div className="ctx-pop-row">
            {BORDER_WIDTHS.map((w) => (
              <button key={w} className={`ctx-chip${(first.strokeWidth ?? 2) === w ? ' is-active' : ''}`} aria-label={`Randstärke ${w}`} onClick={() => patch(() => ({ strokeWidth: w }))}>
                {w === 0 ? 'Ohne' : w}
              </button>
            ))}
            <button className={`ctx-chip${first.dash === 'dashed' ? ' is-active' : ''}`} aria-pressed={first.dash === 'dashed'} onClick={() => patch((o) => ({ dash: o.dash === 'dashed' ? undefined : 'dashed' }))}>
              Gestrichelt
            </button>
          </div>
        </>
      ),
    },
  },
});

// ---- Schriftgröße ---------------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.font',
  order: 30,
  when: allTextual,
  Bar: (p) => {
    const { auto, size } = fontInfo(p);
    const step = (dir: 1 | -1) => {
      const idx = FONT_SIZES.findIndex((s) => s >= Math.round(size));
      const base = idx < 0 ? FONT_SIZES.length - 1 : FONT_SIZES[idx] > Math.round(size) && dir > 0 ? idx - 1 : idx;
      const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, base + dir))];
      p.patch((o) => (isTextual(o) ? { fontSize: next } : null));
    };
    return (
      <div className="ctx-group ctx-font" aria-label="Schriftgröße">
        <button className="ctx-btn" aria-label="Schrift kleiner" onClick={() => step(-1)}>
          <span className="ctx-a ctx-a--s">A</span>
        </button>
        <button className="ctx-num ctx-num--btn" data-testid="font-size" aria-label="Schriftgröße wählen" aria-expanded={p.pop === 'font'} onClick={p.togglePop('font')}>
          {auto ? 'Auto' : Math.round(size)}
        </button>
        <button className="ctx-btn" aria-label="Schrift größer" onClick={() => step(1)}>
          <span className="ctx-a">A</span>
        </button>
      </div>
    );
  },
  pops: {
    font: {
      className: 'ctx-pop--list',
      label: 'Schriftgrößen',
      Body: (p) => {
        const { auto, size } = fontInfo(p);
        return (
          <>
            {fontTargets(p.selected).every((o) => typeDef(o).autoFont) && (
              <button className={`ctx-chip${auto ? ' is-active' : ''}`} onClick={() => p.choose(() => ({ fontSize: undefined }))}>
                Auto
              </button>
            )}
            {FONT_SIZES.map((s) => (
              <button key={s} className={`ctx-chip${!auto && Math.round(size) === s ? ' is-active' : ''}`} onClick={() => p.choose((o) => (isTextual(o) ? { fontSize: s } : null))}>
                {s}
              </button>
            ))}
          </>
        );
      },
    },
  },
});

// ---- Format & Ausrichtung -------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.format',
  order: 40,
  when: allTextual,
  Bar: (p) => {
    const targets = fontTargets(p.selected);
    const allOn = (k: 'bold' | 'italic' | 'strike') => targets.every((o) => !!o[k]);
    const toggle = (k: 'bold' | 'italic' | 'strike') => {
      const on = !allOn(k);
      p.patch((o) => (isTextual(o) ? { [k]: on || undefined } : null));
    };
    return (
      <div className="ctx-group" aria-label="Format">
        <Toggle label="Fett (Strg B)" on={allOn('bold')} onClick={() => toggle('bold')}>
          <span className="ctx-fmt ctx-fmt--b">B</span>
        </Toggle>
        <Toggle label="Kursiv (Strg I)" on={allOn('italic')} onClick={() => toggle('italic')}>
          <span className="ctx-fmt ctx-fmt--i">I</span>
        </Toggle>
        <Toggle label="Durchgestrichen (Strg Umschalt S)" on={allOn('strike')} onClick={() => toggle('strike')}>
          <span className="ctx-fmt ctx-fmt--s">S</span>
        </Toggle>
        <PopBtn open={p.pop === 'talign'} onToggle={p.togglePop('talign')} label="Textausrichtung">
          <IconTextAlign align={defaultAlign(targets[0])} />
        </PopBtn>
      </div>
    );
  },
  pops: {
    talign: {
      className: 'ctx-pop--row',
      label: 'Textausrichtung',
      Body: (p) => {
        const targets = fontTargets(p.selected);
        const first = targets[0];
        if (!first) return null;
        return (
          <>
            {TEXT_ALIGNS.map((a) => (
              <button key={a.align} className={`ctx-btn${defaultAlign(first) === a.align ? ' is-active' : ''}`} aria-label={a.label} title={a.label} onClick={() => p.patch(() => ({ align: a.align }))}>
                <IconTextAlign align={a.align} />
              </button>
            ))}
            {targets.every((o) => typeDef(o).valign) && (
              <>
                <span className="ctx-pop-sep" />
                {V_ALIGNS.map((a) => (
                  <button key={a.valign} className={`ctx-btn${(first.valign ?? 'middle') === a.valign ? ' is-active' : ''}`} aria-label={a.label} title={a.label} onClick={() => p.patch(() => ({ valign: a.valign }))}>
                    <IconVAlign valign={a.valign} />
                  </button>
                ))}
              </>
            )}
          </>
        );
      },
    },
  },
});

// ---- Verbinder ----------------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.connector',
  order: 50,
  when: (c) => !c.locked && only(c, 'connector'),
  Bar: ({ first, patch, pop, togglePop }) => (
    <div className="ctx-group">
      <PopBtn open={pop === 'lstyle'} onToggle={togglePop('lstyle')} label="Linienart">
        {LINE_STYLES.find((l) => l.style === (first.lineStyle ?? 'straight'))!.icon}
      </PopBtn>
      <Toggle label="Pfeil am Anfang" on={!!first.arrowStart} onClick={() => patch((o) => ({ arrowStart: o.arrowStart ? undefined : true }))}>
        <IconArrowStart />
      </Toggle>
      <Toggle label="Pfeil am Ende" on={first.arrowEnd !== false} onClick={() => patch((o) => ({ arrowEnd: o.arrowEnd === false }))}>
        <IconArrowEnd size={20} />
      </Toggle>
      <PopBtn open={pop === 'dash'} onToggle={togglePop('dash')} label="Linie">
        <IconDash dash={first.dash ?? 'solid'} />
      </PopBtn>
      <PopBtn open={pop === 'cwidth'} onToggle={togglePop('cwidth')} label="Linienstärke">
        <span className="ctx-num ctx-num--sm">{first.strokeWidth ?? 2}</span>
      </PopBtn>
    </div>
  ),
  pops: {
    lstyle: {
      className: 'ctx-pop--row',
      label: 'Linienart',
      Body: ({ first, choose }) =>
        LINE_STYLES.map((l) => (
          <button key={l.style} className={`ctx-btn${(first.lineStyle ?? 'straight') === l.style ? ' is-active' : ''}`} aria-label={l.label} title={l.label} onClick={() => choose(() => ({ lineStyle: l.style === 'straight' ? undefined : l.style }))}>
            {l.icon}
          </button>
        )),
    },
    dash: {
      className: 'ctx-pop--row',
      label: 'Linie',
      Body: ({ first, choose }) =>
        DASHES.map((d) => (
          <button key={d.dash} className={`ctx-btn${(first.dash ?? 'solid') === d.dash ? ' is-active' : ''}`} aria-label={d.label} title={d.label} onClick={() => choose(() => ({ dash: d.dash === 'solid' ? undefined : d.dash }))}>
            <IconDash dash={d.dash} />
          </button>
        )),
    },
    cwidth: {
      className: 'ctx-pop--row',
      label: 'Linienstärke',
      Body: ({ first, choose }) =>
        CONNECTOR_WIDTHS.map((w) => (
          <button key={w} className={`ctx-btn${(first.strokeWidth ?? 2) === w ? ' is-active' : ''}`} aria-label={`Linienstärke ${w}`} title={`${w} px`} onClick={() => choose(() => ({ strokeWidth: w }))}>
            <span className="ctx-line-w" style={{ height: w }} />
          </button>
        )),
    },
  },
});

// ---- Stift --------------------------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.pen',
  order: 60,
  when: (c) => !c.locked && only(c, 'pen'),
  Bar: ({ first, patch }) => (
    <div className="ctx-group">
      {PEN_WIDTHS.map((w) => (
        <button key={w} className={`ctx-btn${(first.strokeWidth ?? 4) === w ? ' is-active' : ''}`} aria-label={`Strichstärke ${w}`} onClick={() => patch(() => ({ strokeWidth: w }))}>
          <span className="width-dot" style={{ width: w + 4, height: w + 4 }} />
        </button>
      ))}
    </div>
  ),
});

// ---- Ausrichten & Gruppieren ----------------------------------------------------------------------------------------

defineContextAction({
  id: 'core.arrange',
  order: 70,
  when: (c) => c.selected.length > 1,
  Bar: (p) => {
    const units = p.api.arrangeUnits().size;
    const snap = p.api.snapshot();
    const whole = isWholeGroup(
      p.selected.map((o) => o.id),
      snap.ordered,
      snap.byId,
    );
    return (
      <div className="ctx-group">
        {units >= 2 && (
          <PopBtn open={p.pop === 'arrange'} onToggle={p.togglePop('arrange')} label="Ausrichten">
            <IconAlignMenu />
          </PopBtn>
        )}
        {whole ? (
          <button className="ctx-btn is-active" aria-label="Gruppierung lösen" title="Gruppierung lösen (Strg Umschalt G)" onClick={p.api.ungroup}>
            <IconUngroup />
          </button>
        ) : (
          <button className="ctx-btn" aria-label="Gruppieren" title="Gruppieren (Strg G)" onClick={p.api.group}>
            <IconGroup />
          </button>
        )}
      </div>
    );
  },
  pops: {
    arrange: {
      className: 'ctx-pop--arrange',
      label: 'Ausrichten',
      Body: ({ api }) => {
        const units = api.arrangeUnits().size;
        return (
          <>
            {ALIGNS.map((a) => (
              <button key={a.mode} className="ctx-btn" aria-label={a.label} title={a.label} onClick={() => api.applyArrange((u) => align(u, a.mode))}>
                {a.icon}
              </button>
            ))}
            <button className="ctx-btn" aria-label="Horizontal verteilen" title="Horizontal verteilen" disabled={units < 3} onClick={() => api.applyArrange((u) => distribute(u, 'x'))}>
              <IconDistH />
            </button>
            <button className="ctx-btn" aria-label="Vertikal verteilen" title="Vertikal verteilen" disabled={units < 3} onClick={() => api.applyArrange((u) => distribute(u, 'y'))}>
              <IconDistV />
            </button>
          </>
        );
      },
    },
  },
});

// ---- Allgemein ----------------------------------------------------------------------------------------------------

function CommonBar({ api, locked }: CtxProps) {
  return (
    <div className="ctx-group">
      {!locked && (
        <>
          <button className="ctx-btn" aria-label="Nach vorne" title="Nach vorne" onClick={api.bringToFront}>
            <IconFront size={20} />
          </button>
          <button className="ctx-btn" aria-label="Nach hinten" title="Nach hinten" onClick={api.sendToBack}>
            <IconBack size={20} />
          </button>
        </>
      )}
      <button className="ctx-btn" aria-label="Duplizieren" title="Duplizieren (Strg D)" onClick={api.duplicate}>
        <IconDuplicate size={20} />
      </button>
      <button className={`ctx-btn${locked ? ' is-active' : ''}`} aria-label={locked ? 'Entsperren' : 'Sperren'} title={locked ? 'Entsperren' : 'Sperren'} onClick={api.toggleLock}>
        {locked ? <IconLock size={20} /> : <IconUnlock size={20} />}
      </button>
      {!locked && (
        <button className="ctx-btn ctx-btn--danger" aria-label="Löschen" title="Löschen (Entf)" onClick={api.deleteSelection}>
          <IconTrash size={20} />
        </button>
      )}
    </div>
  );
}

defineContextAction({ id: 'core.common', order: 90, when: () => true, Bar: CommonBar });
