import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Offene Dialoge zählen: solange einer offen ist, ist der App-Root `inert`. */
let openCount = 0;
function lockBackground(on: boolean) {
  const root = document.getElementById('root');
  openCount = Math.max(0, openCount + (on ? 1 : -1));
  if (root) root.inert = openCount > 0;
}

/** Tab/Umschalt+Tab bleiben im Dialog (zyklisch). */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export function Modal({ title, children, onClose, labelledBy = 'modal-title' }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose kommt oft als Inline-Funktion; per Ref halten, damit der Effekt nur beim Öffnen läuft
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    lockBackground(true);
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else trapTab(e, ref.current);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      lockBackground(false);
      if (prev?.isConnected) prev.focus?.();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <h2 id={labelledBy}>{title}</h2>
        {/* Inhalt scrollt, Titel und Knopfleiste (sticky) bleiben sichtbar */}
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{text}</p>
      <div className="modal-actions">
        <button className="btn btn--ghost btn--sm" onClick={onCancel} data-autofocus>
          Abbrechen
        </button>
        <button className={`btn btn--sm ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
