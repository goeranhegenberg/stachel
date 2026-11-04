// Seiten-Zoom per Geste sperren, solange der Editor offen ist: Ein Pinch über Werkzeugleiste, Dialogen oder Menüs soll
// nicht die ganze Seite vergrößern (das Board hat seinen eigenen Zoom). Anmeldung und Übersicht bleiben zoombar.
// Barrierefreiheit: Text-Zoom bzw. Schriftgröße per Browser-Einstellung und Strg +/− am Rechner wirken weiter;
// Android-Chrome „Zoom erzwingen“ (Bedienungshilfen) setzt sich über user-scalable hinweg.

const LOCK = 'maximum-scale=1, user-scalable=no';

/** Sperre einschalten; die Rückgabe stellt den vorigen Zustand wieder her. */
export function lockPageZoom(doc: Document = document): () => void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const before = meta?.getAttribute('content') ?? null;
  if (meta && before !== null && !/user-scalable/.test(before)) meta.setAttribute('content', `${before}, ${LOCK}`);
  // Chrome/Firefox: keine Browser-Gesten auf der ganzen Seite. Scroll-Container (Panels, Menüs, Dialoge) dürfen
  // trotzdem wischen, weil touch-action das Schwenken an jedem Scroll-Container wieder erlaubt.
  const root = doc.documentElement.style;
  const touch = root.touchAction;
  const overscroll = root.overscrollBehavior;
  root.touchAction = 'pan-x pan-y';
  // kein Neuladen per Herunterziehen (Pull-to-Refresh) mitten in der Arbeit
  root.overscrollBehavior = 'none';
  // iOS-Safari ignoriert user-scalable=no: Pinch-Gesten selbst abfangen
  const stop = (e: Event) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange'] as const) doc.addEventListener(ev, stop, { passive: false });
  return () => {
    if (meta && before !== null) meta.setAttribute('content', before);
    root.touchAction = touch;
    root.overscrollBehavior = overscroll;
    for (const ev of ['gesturestart', 'gesturechange'] as const) doc.removeEventListener(ev, stop);
  };
}
