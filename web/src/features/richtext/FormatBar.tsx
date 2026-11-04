// Schwebende Format-Leiste beim Bearbeiten: Schriftart, Größe, Fett/Kursiv/Unterstrichen/Durchgestrichen,
// Textfarbe, Markierung, Link, Listen, Ausrichtung. Marks gelten für die Textauswahl, ohne Auswahl für den ganzen Text.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { BoardObject, TextAlign, VerticalAlign } from '../../protocol';
import { INK_COLORS } from '../../board/colors';
import { colorName } from '../../ui/a11y';
import { typeDef } from '../../editor/ext/registry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { IconTextAlign, IconVAlign } from '../../editor/interaction/icons';
import { getActive, getPop, setApi, setPop, useActiveVersion, type ActiveEdit } from './active';
import { hasMarkAll, type PMDoc } from './doc';
import { setZoomSource } from './engine';
import { fitTextWidths, watchTextWidths } from './fit';
import { FONTS, fontOf, type FontKey } from './fonts';
import { IconBullets, IconCaret, IconChecklist, IconHighlight, IconLink, IconMore, IconNumbers, IconTextColor, IconUnlink } from './icons';
import { normalizeHref } from './links';
import { HIGHLIGHT_DEFAULT } from './render';

export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128];
export const TEXT_COLORS = INK_COLORS;
export const HIGHLIGHTS = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'];
const ALIGNS: { align: TextAlign; label: string }[] = [
  { align: 'left', label: 'Linksbündig' },
  { align: 'center', label: 'Zentriert' },
  { align: 'right', label: 'Rechtsbündig' },
];
const V_ALIGNS: { valign: VerticalAlign; label: string }[] = [
  { valign: 'top', label: 'Oben' },
  { valign: 'middle', label: 'Mitte' },
  { valign: 'bottom', label: 'Unten' },
];

/** Absatz-Stile (Text-Menü); Markdown-Kürzel `# `, `> `, ``` ``` ``` gehen weiterhin. */
type BlockKey = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';
const BLOCKS: { key: BlockKey; label: string; short: string }[] = [
  { key: 'p', label: 'Normaler Text', short: 'Aa' },
  { key: 'h1', label: 'Überschrift 1', short: 'H1' },
  { key: 'h2', label: 'Überschrift 2', short: 'H2' },
  { key: 'h3', label: 'Überschrift 3', short: 'H3' },
  { key: 'quote', label: 'Zitat', short: '❝' },
  { key: 'code', label: 'Code-Block', short: '</>' },
];

/** Aktueller Absatz-Stil an der Schreibmarke. */
function blockOf(ed: Editor): BlockKey {
  for (const l of [1, 2, 3] as const) if (ed.isActive('heading', { level: l })) return `h${l}`;
  if (ed.isActive('codeBlock')) return 'code';
  if (ed.isActive('blockquote')) return 'quote';
  return 'p';
}

/** Absatz-Stil setzen; nochmal derselbe schaltet zurück auf normalen Text. */
export function setBlock(ed: Editor, key: BlockKey) {
  const cur = blockOf(ed);
  const c = () => ed.chain().focus(undefined, { scrollIntoView: false });
  if (key === 'quote') {
    c().toggleBlockquote().run();
    return;
  }
  if (key === 'code') {
    c().toggleCodeBlock().run();
    return;
  }
  // Code-Block und Zitat erst auflösen, dann Überschrift bzw. Absatz
  if (cur === 'code') c().toggleCodeBlock().run();
  if (ed.isActive('blockquote') && key === 'p') c().lift('blockquote').run();
  if (key === 'p' || cur === key) c().setParagraph().run();
  else c().setHeading({ level: Number(key[1]) as 1 | 2 | 3 }).run();
}

/** Knöpfe nehmen keinen Fokus (der Cursor bleibt im Text). */
const keepFocus = (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
};

export function Btn({ label, on, onClick, children, className = 'ctx-btn', testId, expanded, pop }: { label: string; on?: boolean; onClick: () => void; children: ReactNode; className?: string; testId?: string; expanded?: boolean; pop?: string }) {
  return (
    <button
      type="button"
      className={`${className}${on ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={on === undefined ? undefined : on}
      aria-expanded={expanded}
      data-testid={testId}
      data-pop={pop}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Mark-Befehl: auf die Auswahl, ohne Auswahl auf den ganzen Text (Cursor bleibt stehen). */
function runMark(ed: Editor, fn: (c: ChainedCommands) => ChainedCommands) {
  const { empty, from, to } = ed.state.selection;
  const c = ed.chain().focus(undefined, { scrollIntoView: false });
  (empty ? fn(c.selectAll()).setTextSelection({ from, to }) : fn(c)).run();
}

function markOn(ed: Editor, mark: string): boolean {
  if (ed.state.selection.empty) return hasMarkAll(ed.getJSON() as PMDoc, mark);
  return ed.isActive(mark);
}

/** Faktor einer Teil-Schriftgröße (`1.5em`); sonst 1. */
const emOf = (v: unknown) => {
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)em$/.exec(v) : null;
  return m ? Number(m[1]) : 1;
};

/** Ist ein Teil des Textes markiert (nicht leer, nicht alles)? */
function partSelected(ed: Editor): boolean {
  const { empty, from, to } = ed.state.selection;
  if (empty) return false;
  const doc = ed.state.doc;
  return doc.textBetween(from, to, '\n') !== doc.textBetween(0, doc.content.size, '\n');
}

/** Hat irgendein Textteil eine eigene Schriftgröße? */
function hasInlineSize(ed: Editor): boolean {
  let found = false;
  ed.state.doc.descendants((n) => {
    if (found) return false;
    if (n.marks.some((m) => m.type.name === 'textStyle' && m.attrs.fontSize)) found = true;
    return !found;
  });
  return found;
}

/** Editor-Ansicht, falls (noch) eingehängt. */
const viewOf = (ed: Editor) => (ed.isDestroyed ? null : ((ed as unknown as { editorView: Editor['view'] | null }).editorView ?? null));

/** Overlay-Slot: meldet die Editor-API und zeigt die Leiste, solange ein Text bearbeitet wird. */
export function FormatBarSlot({ api }: SlotProps) {
  setApi(api);
  watchTextWidths(api);
  setZoomSource(() => api.camera().z);
  useActiveVersion();
  const a = getActive();
  const o = a ? api.store.get(a.id) : undefined;
  if (!a || !o || !viewOf(a.editor)) return null;
  return createPortal(<FormatBar a={a} o={o} api={api} />, document.body);
}

/** Schmaler Bildschirm (Handy): Leiste unten angedockt, folgt Drehen und Fenstergröße. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const upd = () => setNarrow(window.innerWidth < 700);
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);
  return narrow;
}

/**
 * Am Handy: Abstand der angedockten Leiste zum unteren Rand, damit sie über der Bildschirmtastatur sitzt, und die
 * sichtbare Höhe (für Popover). Die Tastatur verkleinert je nach Browser nur den sichtbaren Ausschnitt (iOS, Chrome ab
 * 108) oder das ganze Fenster; `visualViewport` deckt beides ab.
 */
function useKeyboardInset(on: boolean): { kb: number; vh: number } {
  const [v, setV] = useState({ kb: 0, vh: window.innerHeight });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) return;
    const upd = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const vh = Math.round(vv.height);
      setV((p) => (p.kb === kb && p.vh === vh ? p : { kb, vh }));
    };
    upd();
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    window.addEventListener('resize', upd);
    return () => {
      vv.removeEventListener('resize', upd);
      vv.removeEventListener('scroll', upd);
      window.removeEventListener('resize', upd);
    };
  }, [on]);
  return v;
}

function FormatBar({ a, o, api }: { a: ActiveEdit; o: BoardObject; api: EditorApi }) {
  const ed = a.editor;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [popLeft, setPopLeft] = useState(0);
  const pop = getPop();
  const narrow = useNarrow();
  const { kb, vh } = useKeyboardInset(narrow);

  useLayoutEffect(() => {
    const bar = ref.current;
    const view = viewOf(ed);
    if (!bar || narrow || !view) return;
    const dom = view.dom as HTMLElement;
    const anchor = (dom.closest('.obj') ?? dom.closest('.richtext-label-edit') ?? dom).getBoundingClientRect();
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const left = Math.round(Math.min(Math.max(anchor.left + anchor.width / 2 - bw / 2, 8), window.innerWidth - bw - 8));
    const above = anchor.top - bh - 16;
    const top = Math.round(above >= 64 ? above : Math.min(anchor.bottom + 16, window.innerHeight - bh - 8));
    if (!pos || pos.left !== left || pos.top !== top) setPos({ left, top });
  });

  // Handy: Schreibmarke über Leiste und Tastatur halten (Board fährt beim Öffnen der Tastatur mit)
  useEffect(() => {
    const bar = ref.current;
    const view = viewOf(ed);
    if (!narrow || !bar || !view) return;
    let caret: { top: number; bottom: number };
    try {
      caret = view.coordsAtPos(ed.state.selection.head);
    } catch {
      return;
    }
    const limit = bar.getBoundingClientRect().top - 12;
    const top = (window.visualViewport?.offsetTop ?? 0) + 120;
    let dy = 0;
    if (caret.bottom > limit) dy = caret.bottom - limit;
    else if (caret.top < top && caret.bottom < limit) dy = Math.max(caret.top - top, caret.bottom - limit);
    if (Math.abs(dy) < 2) return;
    const cam = api.camera();
    api.setCamera({ ...cam, y: cam.y - dy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow, kb, vh, a.id]);

  const toggle = (key: string) => () => setPop(pop === key ? null : key);
  // Popover unter seinem Knopf (auch nach Strg K)
  useLayoutEffect(() => {
    const bar = ref.current;
    const b = pop ? bar?.querySelector(`[data-pop="${pop}"]`) : null;
    if (!bar || !b) return;
    const left = Math.round(Math.max(0, Math.min(b.getBoundingClientRect().left - bar.getBoundingClientRect().left, bar.offsetWidth - 250)));
    if (left !== popLeft) setPopLeft(left);
  }, [pop, popLeft]);
  const patch = (p: Partial<BoardObject>) => {
    api.patchSelection(() => p);
    ed.commands.focus(undefined, { scrollIntoView: false });
  };

  const def = typeDef(o);
  const auto = !!def.autoFont && o.fontSize === undefined;
  const size = o.fontSize ?? (def.autoFont ? def.autoFont(o) : (def.defaultFontSize ?? (a.variant === 'label' ? 14 : 20)));
  const font = fontOf(o.fontFamily);
  const color = (ed.getAttributes('textStyle').color as string | undefined) ?? (o.type === 'text' ? (o.color ?? '#0a0a0a') : '#0a0a0a');
  const hl = (ed.getAttributes('highlight').color as string | undefined) ?? (ed.isActive('highlight') ? HIGHLIGHT_DEFAULT : 'transparent');
  const align = o.align ?? def.textAlign ?? 'center';
  // Text und Form: Größe für den markierten Teil, gespeichert relativ zur Objektgröße (em)
  const partSize = (a.variant === 'text' || a.variant === 'shape') && partSelected(ed);
  const em = partSize ? emOf(ed.getAttributes('textStyle').fontSize) : 1;
  const shownSize = Math.round(size * em);
  const objectFormat = a.variant !== 'label';
  const block = blockOf(ed);
  const curBlock = BLOCKS.find((b) => b.key === block)!;

  let popEl: ReactNode = null;
  if (pop === 'family')
    popEl = (
      <div className="ctx-pop ctx-pop--list richtext-pop richtext-pop--fonts panel" role="group" aria-label="Schriftart">
        {FONTS.map((f) => (
          <button key={f.key} type="button" className={`richtext-font${f.key === font.key ? ' is-active' : ''}`} style={{ fontFamily: f.css }} onClick={() => choose({ fontFamily: f.key === 'barlow' ? undefined : (f.key as FontKey) })}>
            {f.label}
          </button>
        ))}
      </div>
    );
  else if (pop === 'block')
    popEl = (
      <div className="ctx-pop ctx-pop--list richtext-pop richtext-pop--fonts richtext-pop--blocks panel" role="group" aria-label="Absatz">
        {BLOCKS.map((b) => (
          <button key={b.key} type="button" className={`richtext-font richtext-block richtext-block--${b.key}${b.key === block ? ' is-active' : ''}`} aria-pressed={b.key === block} onClick={() => chooseBlock(b.key)}>
            {b.label}
          </button>
        ))}
      </div>
    );
  else if (pop === 'size')
    popEl = (
      <div className="ctx-pop ctx-pop--list richtext-pop panel" role="group" aria-label="Schriftgröße">
        {def.autoFont && (
          <button type="button" className={`ctx-chip${auto ? ' is-active' : ''}`} onClick={() => choose({ fontSize: undefined })}>
            Auto
          </button>
        )}
        {FONT_SIZES.map((s) => (
          <button key={s} type="button" className={`ctx-chip${!auto && shownSize === s ? ' is-active' : ''}`} onClick={() => setSize(s)}>
            {s}
          </button>
        ))}
      </div>
    );
  else if (pop === 'color')
    popEl = (
      <div className="ctx-pop richtext-pop richtext-pop--swatches panel" role="group" aria-label="Textfarbe">
        {TEXT_COLORS.map((c) => (
          <button key={c} type="button" className={`swatch swatch--round${c === color ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Textfarbe ${colorName(c)}`} onClick={() => mark((x) => x.setColor(c))} />
        ))}
        <button type="button" className="ctx-chip richtext-chip-wide" onClick={() => mark((x) => x.unsetColor())}>
          Automatisch
        </button>
      </div>
    );
  else if (pop === 'highlight')
    popEl = (
      <div className="ctx-pop richtext-pop richtext-pop--swatches panel" role="group" aria-label="Markierung">
        {HIGHLIGHTS.map((c) => (
          <button key={c} type="button" className={`swatch${c === hl ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Markierung ${colorName(c)}`} onClick={() => mark((x) => x.setHighlight({ color: c }))} />
        ))}
        <button type="button" className="ctx-chip richtext-chip-wide" onClick={() => mark((x) => x.unsetHighlight())}>
          Ohne
        </button>
      </div>
    );
  else if (pop === 'link') popEl = <LinkPop ed={ed} />;
  else if (pop === 'align')
    popEl = (
      <div className="ctx-pop ctx-pop--row richtext-pop panel" role="group" aria-label="Ausrichtung">
        {ALIGNS.map((x) => (
          <Btn key={x.align} label={x.label} on={align === x.align} onClick={() => patch({ align: x.align })}>
            <IconTextAlign align={x.align} />
          </Btn>
        ))}
        {def.valign && (
          <>
            <span className="ctx-pop-sep" />
            {V_ALIGNS.map((x) => (
              <Btn key={x.valign} label={x.label} on={(o.valign ?? 'middle') === x.valign} onClick={() => patch({ valign: x.valign })}>
                <IconVAlign valign={x.valign} />
              </Btn>
            ))}
          </>
        )}
      </div>
    );

  function setSize(s: number) {
    if (!partSize) {
      // ganzer Text: Objektgröße, Teil-Größen entfallen
      if (hasInlineSize(ed)) runMark(ed, (c) => c.unsetFontSize());
      choose({ fontSize: s });
      return;
    }
    const k = Math.round((s / size) * 1000) / 1000;
    mark((c) => (Math.abs(k - 1) < 0.01 ? c.unsetFontSize() : c.setFontSize(`${k}em`)));
  }
  function choose(p: Partial<BoardObject>) {
    setPop(null);
    patch(p);
    if ('fontFamily' in p) fitTextWidths(api, [o.id]);
  }
  function chooseBlock(key: BlockKey) {
    setPop(null);
    setBlock(ed, key);
    if (a.variant === 'text') fitTextWidths(api, [o.id]);
  }
  function mark(fn: (c: ChainedCommands) => ChainedCommands) {
    setPop(null);
    runMark(ed, fn);
  }
  const list = (kind: 'bulletList' | 'orderedList' | 'taskList') => {
    const c = ed.chain().focus(undefined, { scrollIntoView: false });
    (kind === 'bulletList' ? c.toggleBulletList() : kind === 'orderedList' ? c.toggleOrderedList() : c.toggleTaskList()).run();
  };

  const familyBtn = objectFormat && (
    <button type="button" className="richtext-family-btn" aria-label="Schriftart" title="Schriftart" aria-expanded={pop === 'family'} data-pop="family" style={{ fontFamily: font.css }} onClick={toggle('family')}>
      <span>{font.label}</span>
      <IconCaret />
    </button>
  );
  const blockBtn = objectFormat && (
    <button type="button" className="ctx-num ctx-num--btn richtext-block-btn" data-testid="richtext-block" aria-label={`Absatz: ${curBlock.label}`} title="Überschrift, Zitat, Code" aria-expanded={pop === 'block'} data-pop="block" onClick={toggle('block')}>
      {curBlock.short}
    </button>
  );
  const sizeBtn = objectFormat && (
    <button type="button" className="ctx-num ctx-num--btn" data-testid="richtext-size" aria-label="Schriftgröße" title="Schriftgröße" aria-expanded={pop === 'size'} data-pop="size" onClick={toggle('size')}>
      {auto ? 'Auto' : shownSize}
    </button>
  );
  const boldBtns = (
    <>
      <Btn label="Fett (Strg B)" on={markOn(ed, 'bold')} onClick={() => mark((c) => c.toggleBold())}>
        <span className="ctx-fmt ctx-fmt--b">B</span>
      </Btn>
      <Btn label="Kursiv (Strg I)" on={markOn(ed, 'italic')} onClick={() => mark((c) => c.toggleItalic())}>
        <span className="ctx-fmt ctx-fmt--i">I</span>
      </Btn>
      <Btn label="Unterstrichen (Strg U)" on={markOn(ed, 'underline')} onClick={() => mark((c) => c.toggleUnderline())}>
        <span className="ctx-fmt richtext-fmt--u">U</span>
      </Btn>
    </>
  );
  const strikeBtn = (
    <Btn label="Durchgestrichen (Strg Umschalt S)" on={markOn(ed, 'strike')} onClick={() => mark((c) => c.toggleStrike())}>
      <span className="ctx-fmt ctx-fmt--s">S</span>
    </Btn>
  );
  const colorBtns = (
    <>
      <Btn label="Textfarbe" expanded={pop === 'color'} pop="color" onClick={toggle('color')}>
        <IconTextColor color={color} />
      </Btn>
      <Btn label="Markierung" expanded={pop === 'highlight'} pop="highlight" onClick={toggle('highlight')}>
        <IconHighlight color={hl} />
      </Btn>
      <Btn label="Link (Strg K)" on={ed.isActive('link')} expanded={pop === 'link'} pop="link" onClick={toggle('link')}>
        <IconLink />
      </Btn>
    </>
  );
  const listBtns = (
    <>
      <Btn label="Aufzählung" on={ed.isActive('bulletList')} onClick={() => list('bulletList')}>
        <IconBullets />
      </Btn>
      <Btn label="Nummerierte Liste" on={ed.isActive('orderedList')} onClick={() => list('orderedList')}>
        <IconNumbers />
      </Btn>
      <Btn label="Checkliste" on={ed.isActive('taskList')} onClick={() => list('taskList')}>
        <IconChecklist />
      </Btn>
    </>
  );

  // Handy: alles Seltenere in „Mehr“ (ein Popover über der Leiste, ohne seitliches Wischen)
  if (narrow && pop === 'more')
    popEl = (
      <div className="ctx-pop richtext-pop richtext-pop--more panel" role="group" aria-label="Mehr Formate">
        {objectFormat && (
          <div className="richtext-more-row richtext-more-fonts" role="group" aria-label="Absatz">
            {BLOCKS.map((b) => (
              <button key={b.key} type="button" className={`ctx-chip${b.key === block ? ' is-active' : ''}`} aria-pressed={b.key === block} aria-label={b.label} title={b.label} onClick={() => chooseBlock(b.key)}>
                {b.short}
              </button>
            ))}
          </div>
        )}
        <div className="richtext-more-row">
          {strikeBtn}
          <span className="ctx-pop-sep" />
          {listBtns}
        </div>
        {objectFormat && (
          <div className="richtext-more-row" role="group" aria-label="Ausrichtung">
            {ALIGNS.map((x) => (
              <Btn key={x.align} label={x.label} on={align === x.align} onClick={() => patch({ align: x.align })}>
                <IconTextAlign align={x.align} />
              </Btn>
            ))}
            {def.valign && (
              <>
                <span className="ctx-pop-sep" />
                {V_ALIGNS.map((x) => (
                  <Btn key={x.valign} label={x.label} on={(o.valign ?? 'middle') === x.valign} onClick={() => patch({ valign: x.valign })}>
                    <IconVAlign valign={x.valign} />
                  </Btn>
                ))}
              </>
            )}
          </div>
        )}
        {objectFormat && (
          <div className="richtext-more-row richtext-more-fonts" role="group" aria-label="Schriftart">
            {FONTS.map((f) => (
              <button key={f.key} type="button" className={`ctx-chip${f.key === font.key ? ' is-active' : ''}`} aria-pressed={f.key === font.key} style={{ fontFamily: f.css }} onClick={() => choose({ fontFamily: f.key === 'barlow' ? undefined : (f.key as FontKey) })}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  const moreActive = block !== 'p' || markOn(ed, 'strike') || ed.isActive('bulletList') || ed.isActive('orderedList') || ed.isActive('taskList');

  return (
    <div
      ref={ref}
      className={`richtext-bar panel${narrow ? ' richtext-bar--docked' : ''}`}
      role="toolbar"
      aria-label="Text formatieren"
      data-testid="richtext-bar"
      style={narrow ? ({ '--rt-kb': `${kb}px`, '--rt-vh': `${vh}px` } as React.CSSProperties) : pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      onMouseDown={keepFocus}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setPop(null);
          ed.commands.focus(undefined, { scrollIntoView: false });
        }
      }}
    >
      {narrow ? (
        <>
          {sizeBtn && <div className="ctx-group">{sizeBtn}</div>}
          <div className="ctx-group" aria-label="Format">
            {boldBtns}
          </div>
          <div className="ctx-group">{colorBtns}</div>
          <div className="ctx-group">
            <Btn label="Mehr Formate" on={moreActive} expanded={pop === 'more'} pop="more" testId="richtext-more" onClick={toggle('more')}>
              <IconMore />
            </Btn>
          </div>
        </>
      ) : (
        <>
          {objectFormat && (
            <div className="ctx-group">
              {familyBtn}
              {blockBtn}
              {sizeBtn}
            </div>
          )}
          <div className="ctx-group" aria-label="Format">
            {boldBtns}
            {strikeBtn}
          </div>
          <div className="ctx-group">{colorBtns}</div>
          <div className="ctx-group">
            {listBtns}
            {objectFormat && (
              <Btn label="Ausrichtung" expanded={pop === 'align'} pop="align" onClick={toggle('align')}>
                <IconTextAlign align={align} />
              </Btn>
            )}
          </div>
        </>
      )}
      {popEl && (
        <div className="richtext-pop-wrap" style={narrow ? undefined : { left: popLeft }}>
          {popEl}
        </div>
      )}
    </div>
  );
}

function LinkPop({ ed }: { ed: Editor }) {
  const current = (ed.getAttributes('link').href as string | undefined) ?? '';
  const [value, setValue] = useState(current);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  const apply = () => {
    const href = normalizeHref(value);
    if (!href) {
      setError(true);
      return;
    }
    const c = ed.chain().focus(undefined, { scrollIntoView: false });
    if (!ed.state.selection.empty) c.setLink({ href }).run();
    else if (ed.isActive('link')) c.extendMarkRange('link').setLink({ href }).run();
    else c.insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link').run();
    setPop(null);
  };
  const remove = () => {
    ed.chain().focus(undefined, { scrollIntoView: false }).extendMarkRange('link').unsetLink().run();
    setPop(null);
  };
  return (
    <form
      className="ctx-pop richtext-pop richtext-pop--link panel"
      aria-label="Link"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <input
        ref={input}
        className={`richtext-link-input${error ? ' is-error' : ''}`}
        value={value}
        placeholder="Link einfügen, z. B. example.org"
        aria-label="Linkadresse"
        aria-invalid={error}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            setPop(null);
            ed.commands.focus(undefined, { scrollIntoView: false });
          }
        }}
      />
      <button type="submit" className="btn btn--green richtext-link-ok">
        Übernehmen
      </button>
      {current && (
        <button type="button" className="ctx-btn" aria-label="Link entfernen" title="Link entfernen" onClick={remove}>
          <IconUnlink />
        </button>
      )}
      {error && <span className="richtext-link-error">Das ist kein gültiger Link.</span>}
    </form>
  );
}
