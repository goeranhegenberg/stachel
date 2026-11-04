// Welt-Slot des Moduls: Dateiname rechts über dem Dokument (links steht bei fremder Auswahl der Name der Person) und
// Seitenleiste „‹ 3 / 12 ›“ unten im Dokument (gleich groß bei jedem Zoom, drehen mit), Platzhalter laufender Uploads,
// Nachladen fehlender Seiten und Spiegel-`imageId` richtigstellen.
import { useEffect, useMemo, type CSSProperties, type SyntheticEvent } from 'react';
import type { BoardObject } from '../../protocol';
import type { SlotProps } from '../../editor/ext/types';
import { isInvisible } from '../../board/types';
import { setEditorApi } from './active';
import { isDoc, stepPage } from './actions';
import { ensurePage } from './files';
import { currentPage, pageCount, pageImage, pageLabel } from './pages';
import { useUploads } from './uploads';
import { repairMirror } from './yjs';
import { IconDoc, IconNext, IconPrev } from './icons';

/** ab dieser Bildschirmbreite (px) Seitenleiste und Namen zeigen */
const MIN_SCREEN_W = 120;
/** so lange warten, bevor ich eine fehlende Seite selbst erzeuge (die Hochladende:r ist meist schneller) */
const LAZY_FILL_MS = 1500;

const stop = (e: SyntheticEvent) => e.stopPropagation();

function visibleDocs({ snap, cam, width, height }: Pick<SlotProps, 'snap' | 'cam' | 'width' | 'height'>): BoardObject[] {
  const vx = -cam.x / cam.z;
  const vy = -cam.y / cam.z;
  const vw = width / cam.z;
  const vh = height / cam.z;
  return snap.ordered.filter(
    (o) => isDoc(o) && !isInvisible(o) && o.x + o.w > vx - o.w && o.x < vx + vw + o.w && o.y + o.h > vy - o.h && o.y < vy + vh + o.h,
  );
}

export function DocumentControls({ api, snap, cam, width, height }: SlotProps) {
  setEditorApi(api);
  const uploads = useUploads();
  const docs = useMemo(() => visibleDocs({ snap, cam, width, height }), [snap, cam, width, height]);
  const s = 1 / cam.z;

  // Spiegel-imageId richtigstellen und fehlende aktuelle Seiten (sichtbar) nach kurzer Wartezeit selbst erzeugen
  const wanted = docs
    .filter((o) => !pageImage(o, currentPage(o)) || o.imageId !== pageImage(o, currentPage(o)))
    .map((o) => `${o.id}:${currentPage(o)}`)
    .join(',');
  useEffect(() => {
    if (!wanted) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const key of wanted.split(',')) {
      const [id, p] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
      repairMirror(api.store, id);
      timers.push(
        setTimeout(() => {
          const o = api.store.get(id);
          if (o && currentPage(o) === p && !pageImage(o, p)) void ensurePage(api, id, p).catch(() => {});
        }, LAZY_FILL_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [api, wanted]);

  if (!docs.length && !uploads.length) return null;
  return (
    <div className="documents-layer">
      {uploads.map((u) => (
        <div key={u.key} className="documents-upload" style={{ transform: `translate(${u.rect.x}px, ${u.rect.y}px)`, width: u.rect.w, height: u.rect.h }} data-testid="documents-upload">
          <div className="documents-upload__label" style={{ transform: `scale(${Math.min(s, u.rect.w / 220)})` }}>
            <IconDoc size={28} />
            <span>{u.name}</span>
            <span>wird vorbereitet …</span>
          </div>
        </div>
      ))}
      {docs.map((o) => {
        if (o.w * cam.z < MIN_SCREEN_W) return null;
        const n = pageCount(o);
        const p = currentPage(o);
        const rot = o.rotation ?? 0;
        const center: CSSProperties = { transform: `translate(${o.x + o.w / 2}px, ${o.y + o.h / 2}px) rotate(${rot}deg)` };
        return (
          <div key={o.id} className="documents-ctl" style={center} data-doc={o.id}>
            <div className="documents-name" style={{ transform: `translate(${o.w / 2}px, ${-o.h / 2}px) scale(${s}) translate(-100%, calc(-100% - 4px))`, maxWidth: o.w * cam.z * 0.7 }} title={o.docName}>
              <IconDoc size={14} />
              <span>{o.docName ?? 'PDF'}</span>
            </div>
            {n > 1 && (
              <div
                className="documents-pager"
                role="group"
                aria-label={`Seiten von ${o.docName ?? 'PDF'}`}
                style={{ transform: `translate(0, ${o.h / 2}px) scale(${s}) translate(-50%, calc(-100% - 10px))` }}
                onPointerDown={stop}
                onDoubleClick={stop}
              >
                <button type="button" aria-label="Vorige Seite" title="Vorige Seite" disabled={p <= 0} onClick={() => stepPage(api, o.id, -1)}>
                  <IconPrev size={18} />
                </button>
                <span className="documents-pager__n" data-testid="documents-page">
                  {pageLabel(p, n)}
                </span>
                <button type="button" aria-label="Nächste Seite" title="Nächste Seite" disabled={p >= n - 1} onClick={() => stepPage(api, o.id, 1)}>
                  <IconNext size={18} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
