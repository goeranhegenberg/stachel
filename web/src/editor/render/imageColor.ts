// Durchschnittsfarbe von Bildern: Fläche beim Herauszoomen statt Bild-Decodierung.
const cache = new Map<string, string>();

const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** Mittlere Farbe eines geladenen Bildes als #rrggbb (null, wenn der Canvas sie nicht lesen darf). */
export function averageColor(img: CanvasImageSource): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 4, 4);
    const d = ctx.getImageData(0, 0, 4, 4).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let i = 0; i < d.length; i += 4) {
      const w = d[i + 3] / 255;
      r += d[i] * w;
      g += d[i + 1] * w;
      b += d[i + 2] * w;
      a += w;
    }
    if (a === 0) return null;
    return `#${hex(r / a)}${hex(g / a)}${hex(b / a)}`;
  } catch {
    return null;
  }
}

/** Merkt die Farbe eines geladenen Bildes (per Quelle), damit die Fläche beim Herauszoomen passt. */
export function rememberColor(src: string, img: HTMLImageElement) {
  if (!src || cache.has(src)) return;
  const c = averageColor(img);
  if (!c) return;
  cache.set(src, c);
}

export const knownColor = (src: string | undefined) => (src ? cache.get(src) : undefined);


/** Maße und Durchschnittsfarbe einer Bilddatei in einem Durchgang (Platzhalter beim Hochladen, `color` am Bild). */
export async function imageInfo(file: Blob): Promise<{ width: number; height: number; color: string | null } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, color: averageColor(img) };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
