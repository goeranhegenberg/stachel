// Werkzeugleiste links (am Handy unten) aus dem Werkzeug-Register, dazu Rückgängig/Wiederholen.
// Am Handy passen 9 Knöpfe in die Leiste; weitere Werkzeuge (Feature-Module) landen hinter „Mehr“.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { IconEye, IconRedo, IconUndo } from '../ui/icons';
import { useMediaQuery } from '../ui/useMediaQuery';
import { defineMenuItem, defineShortcut, tools } from './ext/registry';
import type { EditorApi, ToolDef } from './ext/types';

/** Knöpfe in der waagerechten Handy-Leiste (inkl. „Mehr“). */
const COMPACT_MAX = 9;
/** Unter dieser Fensterhöhe passt die senkrechte Leiste (15 Knöpfe à 28 px + Kopfleiste + Rückgängig) nicht mehr:
 *  dann wie am Handy waagerecht unten (gleiche Schwelle wie in editor.css). */
export const LOW_HEIGHT = '(max-height: 650px)';

// ---- Oberfläche ausblenden (Fokus-Modus, Strg \) und Vollbild ------------------------------------------------------
/** Klasse am body (nicht am Editor-Element: React würde sie beim nächsten className-Wechsel überschreiben). */
const UI_HIDDEN = 'stachel-ui-hidden';
const UI_KEY = 'Strg \\';
export function toggleUi(api?: EditorApi) {
  const hidden = document.body.classList.toggle(UI_HIDDEN);
  if (hidden) api?.toast(matchMedia('(pointer: coarse)').matches ? 'Oberfläche ausgeblendet. Das Auge unten rechts holt sie zurück.' : `Oberfläche ausgeblendet. ${UI_KEY} holt sie zurück.`);
}
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
defineShortcut({
  id: 'view.hideUi',
  // Strg \ (US) bzw. die Taste an derselben Stelle (deutsch: #)
  keys: ['mod+\\', 'mod+Backslash'],
  run: (api) => toggleUi(api),
  help: { group: 'Ansicht', keys: UI_KEY, label: 'Oberfläche aus-/einblenden', order: 95 },
});
defineMenuItem({ id: 'view.hideUi', on: 'board', order: 56, item: (api) => ({ label: 'Oberfläche ausblenden', shortcut: UI_KEY, onSelect: () => toggleUi(api) }) });
defineMenuItem({
  id: 'view.fullscreen',
  on: 'board',
  order: 57,
  item: () => (document.fullscreenEnabled ? { label: document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild', onSelect: toggleFullscreen } : null),
});

/** Breite der rechten Kopfleiste als CSS-Variable `--tr-w` am Editor: Die linke (Board-Titel, Rahmen, Menü „···“)
 *  nimmt sich nur den Rest. Rechts kommen je nach Modul Timer, Abstimmung, Anwesende dazu, ein fester Wert passt nie. */
function useTopbarFit(navRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const editor = navRef.current?.closest<HTMLElement>('.editor');
    const right = editor?.querySelector<HTMLElement>('.topbar--right');
    if (!editor || !right) return;
    const set = () => editor.style.setProperty('--tr-w', `${Math.ceil(right.getBoundingClientRect().width)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(right);
    return () => {
      ro.disconnect();
      editor.style.removeProperty('--tr-w');
    };
  }, [navRef]);
}

interface ToolbarProps {
  api: EditorApi;
  tool: string;
  onTool: (t: string) => void;
  /** Handy-Leiste (waagerecht unten) */
  compact: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

/** Waagerechte Leiste unten: mittig, aber nie unter Rückgängig (links) bzw. Zoom/Übersichtskarte (rechts) –
 *  bei knapper Breite (Handy quer, Browser-Zoom) rückt sie in die Lücke dazwischen. Ergebnis als `--tb-left`/`--tb-max`. */
function useBottomFit(navRef: RefObject<HTMLElement | null>, compact: boolean) {
  useLayoutEffect(() => {
    const nav = navRef.current;
    const editor = nav?.closest<HTMLElement>('.editor');
    if (!nav || !editor) return;
    let last = '';
    const fit = () => {
      if (!compact) {
        if (last) for (const k of ['--tb-left', '--tb-shift', '--tb-max']) nav.style.removeProperty(k);
        last = '';
        return;
      }
      const e = editor.getBoundingClientRect();
      // natürliche Breite messen (ohne Begrenzung), Lage der Nachbarn in derselben Zeile
      const prev = nav.style.maxWidth;
      nav.style.maxWidth = 'none';
      const r = nav.getBoundingClientRect();
      nav.style.maxWidth = prev;
      const pad = 10;
      let lo = pad;
      let hi = e.width - pad;
      for (const el of editor.querySelectorAll('.history, .bottom-right > *')) {
        const b = el.getBoundingClientRect();
        if (!b.width || b.bottom <= r.top + 2 || b.top >= r.bottom - 2) continue;
        if (b.left + b.width / 2 - e.left < e.width / 2) lo = Math.max(lo, b.right - e.left + 8);
        else hi = Math.min(hi, b.left - e.left - 8);
      }
      const w = Math.min(r.width, hi - lo);
      const left = Math.round(Math.min(Math.max(e.width / 2 - w / 2, lo), hi - w));
      const key = `${left}/${Math.round(hi - lo)}`;
      if (key === last) return;
      last = key;
      nav.style.setProperty('--tb-left', `${left}px`);
      nav.style.setProperty('--tb-shift', '0px');
      nav.style.setProperty('--tb-max', `${Math.max(0, Math.floor(hi - lo))}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(editor);
    for (const el of editor.querySelectorAll('.history, .bottom-right')) ro.observe(el);
    // Seitenleiste auf/zu verschiebt Zoom und Übersichtskarte (Klasse has-sidebar am Editor)
    const mo = new MutationObserver(fit);
    mo.observe(editor, { attributes: true, attributeFilter: ['class'] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [navRef, compact]);
}

export function Toolbar(props: ToolbarProps) {
  const low = useMediaQuery(LOW_HEIGHT);
  const p = { ...props, compact: props.compact || low };
  const navRef = useRef<HTMLElement>(null);
  useTopbarFit(navRef);
  useBottomFit(navRef, p.compact);
  // Editor verlassen (oder Präsentation): Oberfläche wieder zeigen
  useEffect(() => () => document.body.classList.remove(UI_HIDDEN), []);
  const [moreOpen, setMoreOpen] = useState(false);
  // Optionen „auf Abruf“ (z. B. Auswählen → Lasso): zweiter Klick auf das aktive Werkzeug klappt sie auf
  const [demand, setDemand] = useState<string | null>(null);
  useEffect(() => setDemand(null), [p.tool]);
  // Handy: Unnötiges weglassen, Seltenes ans Ende (landet hinter „Weitere Werkzeuge“)
  const list = tools.list();
  const all = p.compact ? [...list.filter((t) => !t.phone), ...list.filter((t) => t.phone === 'more')] : list;
  const overflow = p.compact && all.length > COMPACT_MAX;
  const shown = overflow ? all.slice(0, COMPACT_MAX - 1) : all;
  const extra = overflow ? all.slice(COMPACT_MAX - 1) : [];
  // Untermenü auf Höhe des aktiven Knopfs (Werkzeuge mit Aktion zählen nicht mit)
  const pickable = shown.filter((t) => !t.action);
  const active = all.find((t) => t.id === p.tool && !t.action);
  const flyoutIndex = active ? pickable.indexOf(active) : -1;
  const activeExtra = extra.find((t) => t.id === p.tool);

  const run = (t: ToolDef) => {
    setMoreOpen(false);
    if (t.action) return t.action(p.api);
    setDemand(t.optionsOnDemand && p.tool === t.id && demand !== t.id ? t.id : null);
    p.onTool(t.id);
  };
  const showOptions = !!active?.Options && (!active.optionsOnDemand || demand === active.id);

  return (
    <>
      <nav ref={navRef} className="toolbar panel" aria-label="Werkzeuge" style={{ '--tb-n': shown.length + (overflow ? 1 : 0) } as CSSProperties} onPointerDown={(e) => e.stopPropagation()}>
        {shown.map((t) => (
          <Fragment key={t.id}>
            {t.sepBefore && <span className="tb-sep" />}
            {t.action ? (
              <button className="tb-btn" aria-label={t.label} data-tool={t.id} onClick={() => run(t)}>
                <t.Icon />
                <span className="tip">{t.label}</span>
              </button>
            ) : (
              <button
                className={`tb-btn${p.tool === t.id ? ' is-active' : ''}${t.optionsOnDemand ? ' tb-btn--options' : ''}`}
                aria-pressed={p.tool === t.id}
                aria-label={t.label}
                aria-expanded={t.optionsOnDemand ? demand === t.id && p.tool === t.id : undefined}
                data-tool={t.id}
                onClick={() => run(t)}
              >
                <t.Icon />
                <span className="tip">
                  {t.label}
                  {t.key && <kbd>{t.key.toUpperCase()}</kbd>}
                </span>
              </button>
            )}
          </Fragment>
        ))}
        {overflow && (
          <button className={`tb-btn${activeExtra ? ' is-active' : ''}`} aria-label="Weitere Werkzeuge" aria-expanded={moreOpen} data-tool="more" onClick={() => setMoreOpen((v) => !v)}>
            {activeExtra ? <activeExtra.Icon /> : <MoreIcon />}
            <span className="tip">Weitere Werkzeuge</span>
          </button>
        )}

        {moreOpen && (
          <div className="flyout flyout--more panel" role="group" aria-label="Weitere Werkzeuge">
            {extra.map((t) => (
              <button key={t.id} className={`fly-btn${p.tool === t.id ? ' is-active' : ''}`} aria-label={t.label} title={t.label} data-tool={t.id} onClick={() => run(t)}>
                <t.Icon />
                <span className="fly-label" aria-hidden="true">
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        )}
        {!moreOpen && showOptions && active?.Options && (
          <div className="flyout panel" style={{ top: `calc(8px + ${Math.max(0, flyoutIndex)} * (var(--tb-h) + 2px))` }} role="group" aria-label="Werkzeug-Optionen" onClick={() => active.optionsOnDemand && setDemand(null)}>
            <active.Options api={p.api} />
          </div>
        )}
      </nav>

      <button className="ui-restore panel" aria-label="Oberfläche einblenden" title="Oberfläche einblenden (Strg \)" onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleUi()}>
        <IconEye size={20} />
      </button>
      <div className="history panel" onPointerDown={(e) => e.stopPropagation()}>
        <button className="tb-btn" aria-label="Rückgängig" data-testid="undo" disabled={!p.canUndo} onClick={p.onUndo}>
          <IconUndo />
          <span className="tip tip--up">
            Rückgängig <kbd>Strg Z</kbd>
          </span>
        </button>
        <button className="tb-btn" aria-label="Wiederholen" data-testid="redo" disabled={!p.canRedo} onClick={p.onRedo}>
          <IconRedo />
          <span className="tip tip--up">
            Wiederholen <kbd>Strg Y</kbd>
          </span>
        </button>
      </div>
    </>
  );
}
