// Vollbild-Ansicht zum Durchblättern (nur bei mir, ändert die Seite am Objekt nicht). Pfeiltasten, Bild auf/ab,
// Pos1/Ende, Wischen am Handy, Esc schließt. Fehlende Seiten werden erzeugt (dann auch für alle auf dem Board).
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { EditorApi } from '../../editor/ext/types';
import { trapTab } from '../../ui/Modal';
import { downloadPdf, isDoc } from './actions';
import { ensurePage } from './files';
import { currentPage, pageCount, pageImage, pageLabel } from './pages';
import { IconClose, IconDownload, IconNext, IconPrev } from './icons';

export function DocumentViewer({ api, props, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const id = (props as { id?: string } | null)?.id ?? '';
  const o = useSyncExternalStore(api.store.subscribe, () => api.store.get(id));
  const [page, setPage] = useState(() => (o ? currentPage(o) : 0));
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const n = o ? pageCount(o) : 1;
  const p = Math.min(page, n - 1);
  const img = o ? pageImage(o, p) : undefined;
  const src = img ? api.session.imageSrc(img) : undefined;

  // Dokument gelöscht (auch von anderen) → schließen
  useEffect(() => {
    if (!isDoc(o)) onClose();
  }, [o, onClose]);

  // fehlende Seite erzeugen; Nachbarseiten vorladen
  useEffect(() => {
    setFailed(false);
    if (!o) return;
    if (!img) {
      let alive = true;
      ensurePage(api, id, p)
        .then((r) => alive && !r && setFailed(true))
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }
    for (const q of [p + 1, p - 1]) {
      const near = q >= 0 && q < n ? pageImage(o, q) : undefined;
      if (near) new Image().src = api.session.imageSrc(near);
    }
  }, [api, id, p, img]);

  // Tastatur (vor dem Editor), Fokus im Dialog halten, Hintergrund sperren
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const go = (d: number | 'first' | 'last') => {
        e.preventDefault();
        e.stopPropagation();
        setPage((cur) => (d === 'first' ? 0 : d === 'last' ? Number.MAX_SAFE_INTEGER : Math.max(0, cur + d)));
      };
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Home') go('first');
      else if (e.key === 'End') go('last');
      else trapTab(e, ref.current);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (root) root.inert = wasInert;
      if (prev?.isConnected) prev.focus?.();
    };
  }, []);
  // „Ende“ setzt eine sehr große Zahl: auf die letzte Seite begrenzen
  useEffect(() => {
    if (page > n - 1) setPage(n - 1);
  }, [page, n]);

  if (!o) return null;
  const name = o.docName ?? 'PDF';
  const onDown = (e: RPointerEvent) => {
    if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: RPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) setPage((cur) => Math.max(0, Math.min(n - 1, cur + (dx < 0 ? 1 : -1))));
  };

  return createPortal(
    <div className="documents-viewer" role="dialog" aria-modal="true" aria-label={`${name} – Vollbild`} ref={ref} tabIndex={-1} data-testid="documents-viewer">
      <header className="documents-viewer__bar">
        <span className="documents-viewer__name" title={name}>
          {name}
        </span>
        <span className="documents-viewer__n" data-testid="documents-viewer-page">
          {pageLabel(p, n)}
        </span>
        <span className="documents-viewer__actions">
          <button type="button" className="documents-viewer__btn" aria-label="PDF herunterladen" title="PDF herunterladen" onClick={() => downloadPdf(o)}>
            <IconDownload />
          </button>
          <button type="button" className="documents-viewer__btn" aria-label="Schließen" title="Schließen (Esc)" onClick={onClose}>
            <IconClose />
          </button>
        </span>
      </header>
      <div className="documents-viewer__stage" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
        {src ? (
          <img key={src} src={src} alt={`${name}, Seite ${p + 1} von ${n}`} draggable={false} />
        ) : (
          <div className="documents-viewer__wait">{failed ? 'Diese Seite lässt sich gerade nicht anzeigen.' : `Seite ${p + 1} wird vorbereitet …`}</div>
        )}
      </div>
      <button type="button" className="documents-viewer__nav is-prev" aria-label="Vorige Seite" disabled={p <= 0} onClick={() => setPage(Math.max(0, p - 1))}>
        <IconPrev size={30} />
      </button>
      <button type="button" className="documents-viewer__nav is-next" aria-label="Nächste Seite" disabled={p >= n - 1} onClick={() => setPage(Math.min(n - 1, p + 1))}>
        <IconNext size={30} />
      </button>
    </div>,
    document.body,
  );
}
