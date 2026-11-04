// Verkleinerte Bildvarianten (docs/contract.md §3): `GET /api/images/:id?w=256|1024`.
// Nur feste Stufen (kein beliebiges w, sonst ließe sich der Server mit Rechenarbeit und Plattenplatz fluten). Jede
// Variante wird beim ersten Abruf einmal mit sharp (libvips) erzeugt und als WebP-Datei unter
// `data/image-variants/<id>-<w>.webp` abgelegt; danach nur noch ausgeliefert.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** erlaubte Breiten in Pixeln (Board-Übersicht/kleine Bilder bzw. bildschirmfüllend bei normalem Zoom) */
export const IMAGE_VARIANT_WIDTHS = [256, 1024] as const;
export type VariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

/** Gleich wie die Upload-Grenze: mehr Pixel dekodiert libvips gar nicht erst (Dekompressionsbombe). */
const LIMIT_INPUT_PIXELS = 100_000_000;
/** höchstens so viele Bilder gleichzeitig dekodieren (ein 100-MP-Bild belegt beim Verkleinern einige 100 MB) */
const MAX_PARALLEL = 2;

// libvips: keinen Zwischenspeicher für Ergebnisse halten (jede Variante wird nur einmal gebaut), wenige Threads
sharp.cache(false);
sharp.concurrency(2);

export function parseVariantWidth(w: unknown): VariantWidth | null | 'invalid' {
  if (w === undefined) return null;
  const n = typeof w === 'string' && /^\d{1,5}$/.test(w) ? Number(w) : NaN;
  return (IMAGE_VARIANT_WIDTHS as readonly number[]).includes(n) ? (n as VariantWidth) : 'invalid';
}

export class ImageVariants {
  /** laufende Erzeugungen je Datei (zwei gleichzeitige Abrufe bauen die Variante nur einmal) */
  private inflight = new Map<string, Promise<string | null>>();
  /** Bilder, die sich nicht verkleinern ließen: nicht bei jedem Abruf erneut versuchen */
  private failed = new Set<string>();
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    readonly dir: string,
    private readonly log: (msg: string, err?: unknown) => void = () => {},
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  file(id: string, w: VariantWidth) {
    return path.join(this.dir, `${id}-${w}.webp`);
  }

  /**
   * Pfad der Variante (erzeugt sie bei Bedarf) oder null = Original ausliefern: GIF (Animation bliebe sonst stehen),
   * Original nicht breiter als die Stufe, oder das Verkleinern ist fehlgeschlagen.
   */
  async get(id: string, original: string, info: { mime: string; width: number }, w: VariantWidth): Promise<string | null> {
    if (info.mime === 'image/gif' || info.width <= w) return null;
    const out = this.file(id, w);
    if (this.failed.has(out)) return null;
    if (fs.existsSync(out)) return out;
    let p = this.inflight.get(out);
    if (!p) {
      p = this.limit(() => this.build(original, out, w)).finally(() => this.inflight.delete(out));
      this.inflight.set(out, p);
    }
    return p;
  }

  /** alle Varianten eines Bildes löschen (Bild gelöscht) */
  async remove(id: string) {
    await Promise.all(IMAGE_VARIANT_WIDTHS.map((w) => fs.promises.rm(this.file(id, w), { force: true })));
  }

  private async build(original: string, out: string, w: VariantWidth): Promise<string | null> {
    const tmp = `${out}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      // failOn 'warning': schon bei kleinen Dekodierfehlern lieber das Original (der Browser zeigt es so gut er kann)
      await sharp(original, { limitInputPixels: LIMIT_INPUT_PIXELS, sequentialRead: true, failOn: 'warning', animated: false })
        // EXIF-Drehung anwenden wie der Browser beim Original (die Variante trägt keine Metadaten mehr)
        .rotate()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toFile(tmp);
      await fs.promises.rename(tmp, out);
      return out;
    } catch (e) {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      this.failed.add(out);
      this.log(`Bildvariante ${path.basename(out)} ließ sich nicht erzeugen`, e);
      return null;
    }
  }

  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
