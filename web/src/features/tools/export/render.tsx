// Board-Ausschnitt als Bild rendern – vollständig im Browser, ohne externe Dienste:
// Objekte mit derselben ObjectLayer wie der Editor in ein verstecktes Element zeichnen, als SVG-<foreignObject>
// (mit eingebettetem CSS, Schriften und Bildern als data:-URLs) in ein <img> laden und auf ein Canvas malen.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { BoardObject } from '../../../protocol';
import type { Snapshot } from '../../../board/store';
import type { Rect } from '../../../board/geometry';
import { ObjectLayer } from '../../../editor/ObjectLayer';
import type { EditCallbacks } from '../../../editor/ext/types';

export interface RenderJob {
  /** zu zeichnende Objekte, von unten nach oben */
  objects: readonly BoardObject[];
  /** alle Objekte (Verbinder brauchen ihre Andock-Ziele) */
  byId: ReadonlyMap<string, BoardObject>;
  /** Weltausschnitt */
  rect: Rect;
  /** Pixel je Welteinheit */
  scale: number;
  /** Hintergrundfarbe; null = durchsichtig */
  background: string | null;
  imageSrc: (imageId: string) => string;
}

/** Größte Kantenlänge und Pixelzahl eines Exports (Canvas-Grenzen der Browser, Speicher). */
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 36_000_000;

/** Maßstab so begrenzen, dass das Bild in die Canvas-Grenzen passt. */
export function clampScale(rect: Rect, wanted: number, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS): number {
  const w = Math.max(1, rect.w);
  const h = Math.max(1, rect.h);
  return Math.max(0.01, Math.min(wanted, maxSide / w, maxSide / h, Math.sqrt(maxPixels / (w * h))));
}

const noop = () => {};
const NO_CB: EditCallbacks = { onTextChange: noop, onTitleChange: noop, onEditDone: noop };

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const dataCache = new Map<string, Promise<string>>();
/** Datei (Bild, Schrift) als data:-URL; Fehler → ''. Ergebnisse bleiben im Speicher (Bilder sind unveränderlich). */
function inline(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return Promise.resolve(url);
  let p = dataCache.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(blobToDataUrl)
      .catch(() => {
        dataCache.delete(url);
        return '';
      });
    dataCache.set(url, p);
  }
  return p;
}

// ---- CSS & Schriften -----------------------------------------------------------------------------------------------

interface FontRule {
  family: string;
  weight: string;
  style: string;
  css: string;
  url: string | null;
}

/** Alle CSS-Regeln der Seite (ohne @font-face) und die Schrift-Regeln getrennt. */
function readCss(): { rules: string; fonts: FontRule[] } {
  const rules: string[] = [];
  const fonts: FontRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // fremde Stylesheets (gibt es nicht, aber sicher ist sicher)
    }
    const base = sheet.href ?? document.baseURI;
    for (const r of Array.from(list)) {
      if (r instanceof CSSFontFaceRule) {
        const src = r.style.getPropertyValue('src');
        const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src);
        // nur lateinische Schnitte (Umlaute stecken in latin, Sonderzeichen in latin-ext)
        if (m && /cyrillic|greek|vietnamese/.test(m[2])) continue;
        fonts.push({
          family: r.style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase(),
          weight: r.style.getPropertyValue('font-weight').trim() || '400',
          style: r.style.getPropertyValue('font-style').trim() || 'normal',
          css: r.cssText,
          url: m ? new URL(m[2], base).href : null,
        });
      } else rules.push(r.cssText);
    }
  }
  return { rules: rules.join('\n'), fonts };
}

/** Benutzte Schriftschnitte im gerenderten Inhalt (Familie|Gewicht|Stil). */
function usedFonts(root: HTMLElement): Set<string> {
  const used = new Set<string>();
  const walk = (el: Element) => {
    if (el instanceof HTMLElement && el.childNodes.length) {
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (hasText || el.isContentEditable) {
        const cs = getComputedStyle(el);
        const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
        used.add(`${family}|${cs.fontWeight}|${cs.fontStyle === 'italic' ? 'italic' : 'normal'}`);
      }
    }
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(root);
  return used;
}

/** Passt eine @font-face-Regel zu einem benutzten Schnitt? (Gewichtsbereiche wie „100 900“ berücksichtigt) */
function fontMatches(f: FontRule, used: Set<string>): boolean {
  const [lo, hi = lo] = f.weight.split(/\s+/).map((w) => (w === 'normal' ? 400 : w === 'bold' ? 700 : Number(w)));
  for (const u of used) {
    const [family, weight, style] = u.split('|');
    if (family !== f.family || style !== (f.style === 'italic' ? 'italic' : 'normal')) continue;
    const w = Number(weight);
    if (w >= lo && w <= hi) return true;
  }
  return false;
}

async function fontCss(fonts: FontRule[], used: Set<string>): Promise<string> {
  const out = await Promise.all(
    fonts
      .filter((f) => f.url && fontMatches(f, used))
      .map(async (f) => {
        const data = await inline(f.url!);
        if (!data) return '';
        // „block“: das SVG-Bild wartet auf die Schrift statt mit einer Ersatzschrift zu zeichnen
        return f.css.replace(/src:[^;}]*/, `src: url("${data}") format("woff2")`).replace(/font-display:[^;}]*/, 'font-display: block');
      }),
  );
  return out.filter(Boolean).join('\n');
}

// ---- Rendern -------------------------------------------------------------------------------------------------------

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function snapshotOf(objects: readonly BoardObject[], byId: ReadonlyMap<string, BoardObject>): Snapshot {
  return { version: -1, byId, ordered: objects, rank: new Map(objects.map((o, i) => [o.id, i])), topZ: null, bottomZ: null };
}

/** SVG-Quelltext des Ausschnitts (für Tests sichtbar; renderToCanvas malt ihn). */
export async function renderToSvg(job: RenderJob): Promise<{ svg: string; width: number; height: number }> {
  const { rect, scale: s } = job;
  const width = Math.max(1, Math.round(rect.w * s));
  const height = Math.max(1, Math.round(rect.h * s));

  // Bilder vorab als data:-URL (im SVG-Bild lädt der Browser nichts nach)
  const images = new Map<string, string>();
  await Promise.all(
    [...new Set(job.objects.map((o) => o.imageId).filter((id): id is string => !!id))].map(async (id) => images.set(id, await inline(job.imageSrc(id)))),
  );

  const host = document.createElement('div');
  host.className = 'tools-export-host';
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;visibility:hidden;pointer-events:none;z-index:-1;contain:strict`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const cam = { x: -rect.x * s, y: -rect.y * s, z: s };
    flushSync(() =>
      root.render(
        <div className="world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${s})` }}>
          <ObjectLayer
            snap={snapshotOf(job.objects, job.byId)}
            cam={cam}
            width={width}
            height={height}
            keep={new Set()}
            editingId={null}
            imageSrc={(id) => images.get(id) ?? ''}
            peers={[]}
            ownsImageZoom={false}
            {...NO_CB}
          />
        </div>,
      ),
    );
    await document.fonts.ready;
    await nextFrame();
    await nextFrame();
    const world = host.firstElementChild as HTMLElement;
    const { rules, fonts } = readCss();
    const faces = await fontCss(fonts, usedFonts(world));
    const html = new XMLSerializer().serializeToString(world);
    const bg = job.background ? `background:${job.background};` : '';
    // Grundschrift wie <body> (im SVG-Bild gibt es kein body, Texte erben sonst die Standardschrift)
    const b = getComputedStyle(document.body);
    const base = `font-family:${b.fontFamily.replace(/"/g, "'")};font-size:${b.fontSize};line-height:${b.lineHeight};color:${b.color};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;`;
    const css = `${faces}\n${rules}\n.tools-export-root .world{will-change:auto}`.replace(/]]>/g, ']] >');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" class="tools-export-root" style="position:relative;overflow:hidden;width:${width}px;height:${height}px;${bg}${base}">` +
      `<style><![CDATA[${css}]]></style>${html}</div></foreignObject></svg>`;
    return { svg, width, height };
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Ausschnitt als Canvas (Hintergrund gefüllt bzw. durchsichtig). */
export async function renderToCanvas(job: RenderJob): Promise<HTMLCanvasElement> {
  const { svg, width, height } = await renderToSvg(job);
  const img = new Image();
  img.decoding = 'sync';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  // Schriften im SVG-Bild brauchen einen Moment, bis sie sicher gezeichnet werden
  await nextFrame();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kein Canvas verfügbar.');
  if (job.background) {
    ctx.fillStyle = job.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden.'))), type, quality));
