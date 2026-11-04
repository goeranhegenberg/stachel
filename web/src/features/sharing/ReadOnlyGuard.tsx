// Schreibschutz im Editor für „Kann ansehen“ und „Kann kommentieren“ (Modus local). Vorbild: Versions-Vorschau.
// Werkzeugleiste und Kontextleiste sind ausgeblendet, das Werkzeug bleibt die Hand (beim Kommentieren auch das
// Kommentar-Werkzeug); Tasten, Einfügen, Ablegen, Doppelklick und Kontextmenü auf der Leinwand erreichen den Editor nicht.
// Der Server lehnt Änderungen ohnehin ab (access.ts); das hier verhindert, dass lokal etwas „geändert“ aussieht.
import { useEffect } from 'react';
import type { SlotProps } from '../../editor/ext/types';
import { useBoardRole } from './role';

const BODY_CLASS = 'share-readonly';
const COMMENT_TOOL = 'collab.comment';

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
/** Bedienelemente außerhalb der Leinwand (Seitenleiste, Dialoge, Menüs, Kommentare): dort normal weiter. */
const inChrome = (t: EventTarget | null) => t instanceof Element && !!t.closest('.sidebar, .modal, [role="menu"], .topbar, .collab-thread, .collab-pop, .zoombar');

/** Erlaubte Tasten: Ansicht (Zoomen, Einpassen, Verschieben), Hilfe; beim Kommentieren „c“ fürs Kommentar-Werkzeug. */
function viewKey(e: KeyboardEvent, comment: boolean): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', ' ', '?', 'Escape'].includes(e.key) || e.key.startsWith('Arrow')) return true;
  if (mod && ['+', '-', '=', '0', 'f', 'F'].includes(e.key)) return true;
  if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) return true;
  if (comment && !mod && (e.key === 'c' || e.key === 'C')) return true;
  return false;
}

export function ReadOnlyGuard({ api }: SlotProps) {
  const { role } = useBoardRole(api);
  const readOnly = role === 'view' || role === 'comment';
  const comment = role === 'comment';

  useEffect(() => {
    if (!readOnly) return;
    api.setSelection([]);
    if (api.tool() !== 'hand' && !(comment && api.tool() === COMMENT_TOOL)) api.setTool('hand');
    document.body.classList.add(BODY_CLASS);
    document.body.dataset.shareRole = role!;
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target) || inChrome(e.target) || document.querySelector('.modal-backdrop')) return;
      if (viewKey(e, comment)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const block = (e: Event) => {
      if (editable(e.target) || inChrome(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.button === 2 && !inChrome(e.target)) e.stopImmediatePropagation();
    };
    const types = ['paste', 'cut', 'drop', 'contextmenu', 'dblclick'] as const;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    for (const t of types) window.addEventListener(t, block, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      for (const t of types) window.removeEventListener(t, block, true);
      document.body.classList.remove(BODY_CLASS);
      delete document.body.dataset.shareRole;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, comment]);

  // Werkzeug bleibt Hand bzw. Kommentar (z. B. nach einem Kürzel oder dem Ende einer Präsentation); keine Auswahl
  useEffect(() => {
    if (!readOnly) return;
    const t = api.tool();
    if (t !== 'hand' && !(comment && t === COMMENT_TOOL)) api.setTool('hand');
    if (api.selection().length) api.setSelection([]);
  });

  if (!comment) return null;
  // Kommentieren: eigener Knopf statt der ausgeblendeten Werkzeugleiste
  const active = api.tool() === COMMENT_TOOL;
  return (
    <div className="share-commentbar panel" onPointerDown={(e) => e.stopPropagation()}>
      <button className={`share-commentbar__btn${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => api.setTool(active ? 'hand' : COMMENT_TOOL)} data-testid="comment-tool">
        {active ? 'Kommentieren: auf das Board tippen' : 'Kommentar hinzufügen'}
      </button>
    </div>
  );
}
