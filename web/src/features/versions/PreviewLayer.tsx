// Overlay-Slot des Versionsverlaufs: Vorschau-Balken, Schreibschutz in der Vorschau, Bestätigen des Wiederherstellens
// und was nach dem Neuaufbau des Editors (Wechsel Live ↔ Vorschau) wiederhergestellt werden soll.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ConfirmDialog } from '../../ui/Modal';
import type { SlotProps } from '../../editor/ext/types';
import { restoreVersion } from './actions';
import { describe, whenLabel } from './format';
import { closePreview, confirmRestore, dropPreview, liveSession, pending, preview, SIDEBAR_ID } from './state';
import { IconHistory } from './icons';

const BODY_CLASS = 'versions-preview';

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
/** Bedienelemente außerhalb der Leinwand (Seitenleiste, Balken, Dialoge): Tasten gehen dort normal weiter. */
const inChrome = (t: EventTarget | null) => t instanceof Element && !!t.closest('.sidebar, .versions-bar, .modal, [role="menu"]');

/** In der Vorschau erlaubte Tasten: nur Ansicht (Zoomen, Einpassen, Verschieben), Hilfe und das Verlaufs-Kürzel. */
function viewKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', ' ', '?'].includes(e.key) || e.key.startsWith('Arrow')) return true;
  if (mod && ['+', '-', '=', '0'].includes(e.key)) return true;
  if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) return true;
  if (mod && e.altKey && e.code === 'KeyH') return true;
  return false;
}

export function VersionsLayer({ api }: SlotProps) {
  const pv = useSyncExternalStore(preview.subscribe, preview.get);
  const confirm = useSyncExternalStore(confirmRestore.subscribe, confirmRestore.get);
  const [busy, setBusy] = useState(false);
  const isPreview = !!pv && api.session === pv.session;

  // Nach dem Neuaufbau: Kamera, Seitenleiste und Hinweis übernehmen
  useEffect(() => {
    const cur = preview.get();
    // anderes Board geöffnet, während eine Vorschau lief: verwerfen
    if (cur && cur.live !== liveSession(api)) dropPreview();
    if (pending.cam) api.setCamera(pending.cam);
    if (pending.sidebar !== null) api.openSidebar(pending.sidebar ? SIDEBAR_ID : null);
    if (pending.toast) api.toast(pending.toast);
    pending.cam = null;
    pending.sidebar = null;
    pending.toast = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schreibschutz: nur Verschieben/Zoomen; Tasten, Einfügen, Ablegen und Kontextmenü erreichen den Editor nicht
  useEffect(() => {
    if (!isPreview) return;
    api.setSelection([]);
    api.setTool('hand');
    document.body.classList.add(BODY_CLASS);
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop') || editable(e.target)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closePreview(api);
        return;
      }
      if (viewKey(e) || inChrome(e.target)) return;
      e.stopImmediatePropagation();
    };
    const block = (e: Event) => {
      if (editable(e.target) || inChrome(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.button === 2 && !inChrome(e.target)) e.stopImmediatePropagation();
    };
    const types = ['paste', 'cut', 'drop', 'contextmenu'] as const;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    for (const t of types) window.addEventListener(t, block, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      for (const t of types) window.removeEventListener(t, block, true);
      document.body.classList.remove(BODY_CLASS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview]);

  // Werkzeug bleibt die Hand (z. B. nach Präsentation oder Kürzel)
  useEffect(() => {
    if (isPreview && api.tool() !== 'hand') api.setTool('hand');
  });

  // Der Dialog hängt (per Portal) im Board-Baum: Zeiger-Ereignisse nicht zum Board durchreichen (Pointer-Capture)
  const dialog = confirm && pv && (
    <div className="versions-dialog" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <ConfirmDialog
      title={`Stand von ${whenLabel(confirm.createdAt)} wiederherstellen?`}
      text={
        <>
          Das Board springt für alle sofort auf diesen Stand{confirm.name ? ` („${confirm.name}“)` : ''}. Der aktuelle Stand wird vorher als
          Version gesichert – du kannst also jederzeit zurück.
        </>
      }
      confirmLabel="Wiederherstellen"
      busy={busy}
      onCancel={() => confirmRestore.set(null)}
      onConfirm={async () => {
        setBusy(true);
        await restoreVersion(api, pv.boardId, confirm);
        setBusy(false);
        confirmRestore.set(null);
      }}
      />
    </div>
  );

  if (!isPreview || !pv) return dialog || null;
  const v = pv.version;
  const listOpen = api.sidebar() === SIDEBAR_ID;
  return (
    <>
      <div className="versions-bar panel" role="region" aria-label="Vorschau einer Version" data-testid="versions-bar" onPointerDown={(e) => e.stopPropagation()}>
        <span className="versions-bar__icon" aria-hidden="true">
          <IconHistory size={20} />
        </span>
        <span className="versions-bar__text">
          <strong>Vorschau: Stand von {whenLabel(v.createdAt)}</strong>
          <span className="versions-bar__sub">
            {v.name ? `„${v.name}“ · ` : ''}
            {describe(v)} · nur ansehen
          </span>
        </span>
        <span className="versions-bar__actions">
          {!listOpen && (
            <button className="btn btn--sm versions-ghost versions-bar__list" onClick={() => api.openSidebar(SIDEBAR_ID)}>
              Versionen
            </button>
          )}
          <button className="btn btn--green btn--sm" onClick={() => confirmRestore.set(v)}>
            Wiederherstellen
          </button>
          <button className="btn btn--sm versions-ghost versions-bar__close" aria-label="Zurück zum aktuellen Stand" title="Zurück zum aktuellen Stand (Esc)" onClick={() => closePreview(api)}>
            <span className="versions-bar__close-text">Zurück zum aktuellen Stand</span>
            <span className="versions-bar__close-x" aria-hidden="true">
              ✕
            </span>
          </button>
        </span>
      </div>
      {dialog}
    </>
  );
}
