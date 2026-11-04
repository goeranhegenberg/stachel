// Darstellung des Dokument-Objekts: das Bild der aktuellen Seite (Bildstufe nach Bildschirmgröße wie bei Bildern),
// darunter eine Papierfläche. Seitenleiste, Dateiname und Platzhalter liegen im Welt-Slot (controls.tsx).
import { useState, useSyncExternalStore } from 'react';
import type { ObjectViewProps } from '../../editor/ext/types';
import { placeStyle } from '../../editor/render/format';
import { chooseVariant, getImageZoom, markVariantLoaded, subscribeImageZoom, variantSrc } from '../../editor/render/imageVariant';
import { imageUrl } from '../../api';
import { editorApi } from './active';
import { currentPage, pageCount, pageImage, pageRatio } from './pages';
import { IconDoc } from './icons';

/** Adresse des Seitenbilds: aus dem ObjectLayer (gespiegelte `imageId`, im Export eine data:-URL), sonst aus der Sitzung. */
export function pageSrc(o: ObjectViewProps['o'], i: number, imageSrc?: string): string | undefined {
  const id = pageImage(o, i);
  if (!id) return undefined;
  if (id === o.imageId && imageSrc) return imageSrc;
  return editorApi()?.session.imageSrc(id) ?? imageUrl(id);
}

function useVariant(src: string | undefined, w: number): number {
  return useSyncExternalStore(subscribeImageZoom, () => (src ? chooseVariant(src, w * getImageZoom() * (window.devicePixelRatio || 1)) : 0));
}

function PageImage({ src, w, label }: { src: string; w: number; label: string }) {
  const variant = useVariant(src, w);
  const [failed, setFailed] = useState<string | null>(null);
  const tier = variantSrc(src, variant);
  const shown = tier === failed ? src : tier;
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <img
      src={shown}
      alt={label}
      draggable={false}
      decoding="async"
      loading="lazy"
      className={loaded === shown ? undefined : 'is-loading'}
      onLoad={() => {
        markVariantLoaded(src, shown === src ? 0 : variant);
        setLoaded(shown);
      }}
      onError={() => shown !== src && setFailed(shown)}
    />
  );
}

export function DocumentView({ o, imageSrc, far }: ObjectViewProps) {
  const page = currentPage(o);
  const n = pageCount(o);
  const src = pageSrc(o, page, imageSrc);
  // andere Seitenformate (quer in hochkant) mittig einpassen
  const r = pageRatio(o, page);
  const box = o.w / o.h;
  const fit = r > box ? { width: '100%', height: `${(box / r) * 100}%` } : { width: `${(r / box) * 100}%`, height: '100%' };
  return (
    <div className="obj documents-doc" data-id={o.id} data-type="document" data-page={page + 1} data-pages={n} style={placeStyle(o)}>
      <div className="documents-sheet" style={fit}>
        {src && !far ? (
          <PageImage src={src} w={o.w} label={`${o.docName ?? 'PDF'}, Seite ${page + 1} von ${n}`} />
        ) : (
          <div className={`documents-missing${src ? ' is-far' : ''}`}>
            {!src && !far && (
              <>
                <IconDoc size={Math.max(18, Math.min(64, o.w / 8))} />
                <span>Seite {page + 1} wird vorbereitet …</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
