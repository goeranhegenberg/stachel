// Kontextleiste für ausgewählte Text-Objekte (ohne Bearbeitung): Format fürs ganze Objekt.
// Ersetzt 'core.format' (Fett/Kursiv/Durchgestrichen bleiben Objektfelder, der Rest wirkt auf den ganzen Rich-Text).
import type { BoardObject } from '../../protocol';
import { colorName } from '../../ui/a11y';
import { IconTextAlign, IconVAlign } from '../../editor/interaction/icons';
import { PopBtn, Toggle } from '../../editor/ContextBar';
import { defineContextAction, typeDef } from '../../editor/ext/registry';
import type { CtxInfo, CtxProps } from '../../editor/ext/types';
import { firstMark, richDoc, type ListKind } from './doc';
import { fitTextWidths } from './fit';
import { FONTS, fontOf, type FontKey } from './fonts';
import { HIGHLIGHTS, TEXT_COLORS } from './FormatBar';
import { IconBullets, IconCaret, IconChecklist, IconHighlight, IconNumbers, IconTextColor } from './icons';
import { allMarked, isAllList, listAll, markAll, setTextColorIn, textTargets } from './ops';
import { HIGHLIGHT_DEFAULT } from './render';

const allTextual = (c: CtxInfo) => !c.locked && c.selected.length > 0 && c.selected.every((o) => !!typeDef(o).textual);
const defaultAlign = (o: BoardObject) => o.align ?? typeDef(o).textAlign ?? 'center';

const LISTS: { kind: ListKind; label: string; Icon: typeof IconBullets }[] = [
  { kind: 'bulletList', label: 'Aufzählung', Icon: IconBullets },
  { kind: 'orderedList', label: 'Nummerierte Liste', Icon: IconNumbers },
  { kind: 'taskList', label: 'Checkliste', Icon: IconChecklist },
];

/** Textfarbe des ersten Objekts: Mark, bei Text-Objekten sonst die Objektfarbe. */
function textColorOf(o: BoardObject) {
  const m = firstMark(richDoc(o), 'textStyle', (a) => !!a?.color)?.attrs?.color as string | undefined;
  return m ?? (o.type === 'text' ? (o.color ?? '#0a0a0a') : '#0a0a0a');
}
const highlightOf = (o: BoardObject) => {
  const m = firstMark(richDoc(o), 'highlight');
  return m ? ((m.attrs?.color as string | undefined) ?? HIGHLIGHT_DEFAULT) : 'transparent';
};

function FormatGroup(p: CtxProps) {
  const targets = textTargets(p.selected);
  const allOn = (k: 'bold' | 'italic' | 'strike') => targets.every((o) => !!o[k]);
  const toggle = (k: 'bold' | 'italic' | 'strike') => {
    const on = !allOn(k);
    p.patch((o) => (typeDef(o).textual ? { [k]: on || undefined } : null));
  };
  const underline = allMarked(targets, 'underline');
  const first = targets[0];
  if (!first) return null;
  return (
    <>
      <div className="ctx-group" aria-label="Format">
        <Toggle label="Fett (Strg B)" on={allOn('bold')} onClick={() => toggle('bold')}>
          <span className="ctx-fmt ctx-fmt--b">B</span>
        </Toggle>
        <Toggle label="Kursiv (Strg I)" on={allOn('italic')} onClick={() => toggle('italic')}>
          <span className="ctx-fmt ctx-fmt--i">I</span>
        </Toggle>
        <Toggle label="Unterstrichen (Strg U)" on={underline} onClick={() => markAll(p.api, targets, 'underline', underline ? null : {})}>
          <span className="ctx-fmt richtext-fmt--u">U</span>
        </Toggle>
        <Toggle label="Durchgestrichen (Strg Umschalt S)" on={allOn('strike')} onClick={() => toggle('strike')}>
          <span className="ctx-fmt ctx-fmt--s">S</span>
        </Toggle>
      </div>
      <div className="ctx-group">
        <PopBtn open={p.pop === 'rt-color'} onToggle={p.togglePop('rt-color')} label="Textfarbe">
          <IconTextColor color={textColorOf(first)} />
        </PopBtn>
        <PopBtn open={p.pop === 'rt-highlight'} onToggle={p.togglePop('rt-highlight')} label="Markierung">
          <IconHighlight color={highlightOf(first)} />
        </PopBtn>
        <PopBtn open={p.pop === 'rt-list'} onToggle={p.togglePop('rt-list')} label="Liste" active={LISTS.some((l) => isAllList(targets, l.kind))}>
          {(() => {
            const L = LISTS.find((l) => isAllList(targets, l.kind)) ?? LISTS[0];
            return <L.Icon />;
          })()}
        </PopBtn>
        <PopBtn open={p.pop === 'talign'} onToggle={p.togglePop('talign')} label="Textausrichtung">
          <IconTextAlign align={defaultAlign(first)} />
        </PopBtn>
      </div>
    </>
  );
}

defineContextAction({
  id: 'core.format',
  order: 40,
  when: allTextual,
  Bar: FormatGroup,
  pops: {
    'rt-color': {
      className: 'richtext-pop--swatches',
      label: 'Textfarbe',
      Body: (p) => {
        const targets = textTargets(p.selected);
        const cur = targets[0] ? textColorOf(targets[0]) : undefined;
        const set = (c: string | null) => {
          // Text-Objekte: Objektfarbe ist die Textfarbe; sonst Mark auf den ganzen Text (ein Undo-Schritt)
          setTextColorIn(p.api.store, targets, c);
          p.closePop();
        };
        return (
          <>
            {TEXT_COLORS.map((c) => (
              <button key={c} className={`swatch swatch--round${c === cur ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Textfarbe ${colorName(c)}`} onClick={() => set(c)} />
            ))}
            <button className="ctx-chip richtext-chip-wide" onClick={() => set(null)}>
              Automatisch
            </button>
          </>
        );
      },
    },
    'rt-highlight': {
      className: 'richtext-pop--swatches',
      label: 'Markierung',
      Body: (p) => {
        const targets = textTargets(p.selected);
        const cur = targets[0] ? highlightOf(targets[0]) : undefined;
        const set = (c: string | null) => {
          markAll(p.api, targets, 'highlight', c ? { color: c } : null);
          p.closePop();
        };
        return (
          <>
            {HIGHLIGHTS.map((c) => (
              <button key={c} className={`swatch${c === cur ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Markierung ${colorName(c)}`} onClick={() => set(c)} />
            ))}
            <button className="ctx-chip richtext-chip-wide" onClick={() => set(null)}>
              Ohne
            </button>
          </>
        );
      },
    },
    'rt-list': {
      className: 'ctx-pop--row',
      label: 'Liste',
      Body: (p) => {
        const targets = textTargets(p.selected);
        return LISTS.map((l) => (
          <button
            key={l.kind}
            className={`ctx-btn${isAllList(targets, l.kind) ? ' is-active' : ''}`}
            aria-label={l.label}
            title={l.label}
            aria-pressed={isAllList(targets, l.kind)}
            onClick={() => {
              listAll(p.api, targets, l.kind);
              p.closePop();
            }}
          >
            <l.Icon />
          </button>
        ));
      },
    },
    talign: {
      className: 'ctx-pop--row',
      label: 'Textausrichtung',
      Body: (p) => {
        const targets = textTargets(p.selected);
        const first = targets[0];
        if (!first) return null;
        return (
          <>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                className={`ctx-btn${defaultAlign(first) === a ? ' is-active' : ''}`}
                aria-label={a === 'left' ? 'Linksbündig' : a === 'center' ? 'Zentriert' : 'Rechtsbündig'}
                title={a === 'left' ? 'Linksbündig' : a === 'center' ? 'Zentriert' : 'Rechtsbündig'}
                onClick={() => p.patch(() => ({ align: a }))}
              >
                <IconTextAlign align={a} />
              </button>
            ))}
            {targets.every((o) => typeDef(o).valign) && (
              <>
                <span className="ctx-pop-sep" />
                {(['top', 'middle', 'bottom'] as const).map((v) => (
                  <button key={v} className={`ctx-btn${(first.valign ?? 'middle') === v ? ' is-active' : ''}`} aria-label={v === 'top' ? 'Oben' : v === 'middle' ? 'Mitte' : 'Unten'} title={v === 'top' ? 'Oben' : v === 'middle' ? 'Mitte' : 'Unten'} onClick={() => p.patch(() => ({ valign: v }))}>
                    <IconVAlign valign={v} />
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

// ---- Schriftart (vor der Schriftgröße) --------------------------------------------------------------------------

defineContextAction({
  id: 'richtext.family',
  order: 29,
  when: allTextual,
  Bar: (p) => {
    const f = fontOf(textTargets(p.selected)[0]?.fontFamily);
    return (
      <div className="ctx-group">
        <button type="button" className="richtext-family-btn" aria-label="Schriftart" title="Schriftart" aria-expanded={p.pop === 'rt-family'} style={{ fontFamily: f.css }} onClick={p.togglePop('rt-family')}>
          <span>{f.label}</span>
          <IconCaret />
        </button>
      </div>
    );
  },
  pops: {
    'rt-family': {
      className: 'ctx-pop--list richtext-pop--fonts',
      label: 'Schriftart',
      Body: (p) => {
        const targets = textTargets(p.selected);
        const cur = fontOf(targets[0]?.fontFamily).key;
        return FONTS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`richtext-font${f.key === cur ? ' is-active' : ''}`}
            style={{ fontFamily: f.css }}
            onClick={() => {
              p.choose((o) => (typeDef(o).textual ? { fontFamily: f.key === 'barlow' ? undefined : (f.key as FontKey) } : null));
              fitTextWidths(
                p.api,
                targets.map((o) => o.id),
              );
            }}
          >
            {f.label}
          </button>
        ));
      },
    },
  },
});
