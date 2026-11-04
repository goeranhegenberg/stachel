// Bildgröße nach Bildschirmbedarf (docs/contract.md §3): der Server liefert `/api/images/:id?w=256|1024` als kleinere
// WebP-Fassung. Ein Bild, das auf dem Bildschirm 150 px breit ist, braucht kein 4000-px-Foto (Leitung, Dekodierzeit,
// Grafikspeicher). Die Stufe ergibt sich aus Objektbreite × Zoom × devicePixelRatio.

/** feste Stufen des Servers (andere `w` lehnt er ab) */
export const IMAGE_VARIANT_WIDTHS = [256, 1024] as const;

/** Nur Server-Bilder ohne eigene Anfrageparameter haben Varianten (lokale Blob-URLs im Offline-Modus nicht). */
const hasVariants = (src: string) => src.startsWith('/api/images/') && !src.includes('?');

/** Stufe für `needPx` Bildschirmpixel Breite: 256, 1024 oder 0 = Original. */
export function variantWidth(needPx: number): number {
  for (const w of IMAGE_VARIANT_WIDTHS) if (needPx <= w) return w;
  return 0;
}

/** Adresse einer Stufe (0 = Original). */
export function variantSrc(src: string, w: number): string {
  return w && hasVariants(src) ? `${src}?w=${w}` : src;
}

/** schon geladene Stufen je Bild (Browser-Cache): beim Herauszoomen nicht eine kleinere neu holen */
const loaded = new Map<string, Set<number>>();

export function markVariantLoaded(src: string, w: number) {
  if (!hasVariants(src)) return; // Daten-/Blob-URLs (Export, Offline) nicht als Schlüssel festhalten
  let s = loaded.get(src);
  if (!s) loaded.set(src, (s = new Set()));
  s.add(w);
}

/**
 * Stufe, die angezeigt werden soll: die benötigte, außer sie ist noch nicht geladen, aber eine größere schon (dann
 * die größere, ohne neuen Abruf). 0 = Original zählt als größte Stufe.
 */
export function chooseVariant(src: string, needPx: number): number {
  if (!hasVariants(src)) return 0;
  const want = variantWidth(needPx);
  const have = loaded.get(src);
  if (!have || have.has(want) || want === 0) return want;
  for (const w of IMAGE_VARIANT_WIDTHS) if (w > want && have.has(w)) return w;
  return have.has(0) ? 0 : want;
}

// ---- aktueller Zoom (vom ObjectLayer gemeldet), damit Bilder ihre Stufe auch ohne Neu-Rendern der Liste wechseln ----

let zoom = 1;
const subs = new Set<() => void>();

/**
 * Zoom setzen. Im Rendern aufrufen (neu eingehängte Bilder lesen dann gleich den richtigen Wert), die schon
 * sichtbaren Bilder benachrichtigt `notifyImageZoom` danach (Layout-Effekt; im Rendern wäre es ein Fremd-Update).
 */
export function setImageZoom(z: number) {
  zoom = z;
}

let notified = 1;
export function notifyImageZoom() {
  if (zoom === notified) return;
  notified = zoom;
  for (const f of subs) f();
}

export const getImageZoom = () => zoom;

export function subscribeImageZoom(f: () => void) {
  subs.add(f);
  return () => void subs.delete(f);
}
