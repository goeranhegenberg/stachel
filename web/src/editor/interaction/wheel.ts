// Mausrad: Das Rad einer Maus zoomt (einstellbar: schwenken), Trackpad-Wischen schwenkt immer,
// Strg+Rad und Pinch (Trackpad meldet ctrlKey) zoomen immer. Einstellung lokal im Browser (localStorage, try/catch).

export type WheelMode = 'zoom' | 'pan';

const KEY = 'stachel.wheel';
const listeners = new Set<() => void>();
let mode: WheelMode | null = null;

export function getWheelMode(): WheelMode {
  if (mode) return mode;
  try {
    mode = localStorage.getItem(KEY) === 'pan' ? 'pan' : 'zoom';
  } catch {
    mode = 'zoom';
  }
  return mode;
}

export function setWheelMode(m: WheelMode) {
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* nur für diese Sitzung */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeWheelMode(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

type WheelLike = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'timeStamp'>;

/** Liegt `v` (fast) auf einer ganzen Zahl? Chrome liefert bei Browser-Zoom z. B. 100 / 1.1 = 90.909… */
const nearInt = (v: number) => Math.abs(v - Math.round(v)) < 0.02;

/**
 * Maus oder Trackpad? Mausräder melden Zeilen/Seiten (deltaMode ≠ 0) oder große ganzzahlige Schritte ohne deltaX;
 * Trackpads kleine, oft gebrochene Werte und meist auch deltaX. Chrome teilt die Raste durch Browser-Zoom bzw.
 * Pixeldichte (−100 → −66.667 bei 150 %): deshalb zählt auch, ob `deltaY × devicePixelRatio` ganzzahlig und groß ist.
 * Ein Trackpad-Ereignis kurz zuvor gewinnt (Schwung beim Wischen liefert sonst einzelne große Werte).
 */
export function createWheelClassifier(gapMs = 250) {
  let lastPad = -Infinity;
  return (e: WheelLike, dpr = 1): 'mouse' | 'trackpad' => {
    const y = Math.abs(e.deltaY);
    const device = y * (dpr > 0 ? dpr : 1);
    const notch = (Number.isInteger(e.deltaY) && y >= 50) || (nearInt(device) && device >= 50);
    const mouseLike = e.deltaMode !== 0 || (e.deltaX === 0 && notch);
    if (!mouseLike) {
      lastPad = e.timeStamp;
      return 'trackpad';
    }
    if (e.timeStamp - lastPad < gapMs) {
      lastPad = e.timeStamp;
      return 'trackpad';
    }
    return 'mouse';
  };
}

/**
 * Rasten eines Mausrads zählen (mit Vorzeichen, ±1 je normaler Raste), unabhängig von Browser-Zoom, Pixeldichte,
 * Betriebssystem und deltaMode: Die kleinste bisher gesehene Schrittweite gilt als eine Raste. So zoomt jede Raste
 * gleich weit; mehrere in einem Ereignis zusammengefasste Rasten (schnelles Drehen) zählen mehrfach.
 */
export function createNotchCounter() {
  let unit = Infinity;
  let mode = -1;
  return (e: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): number => {
    const y = Math.abs(e.deltaY);
    if (!y) return 0;
    if (e.deltaMode !== mode) {
      mode = e.deltaMode;
      unit = Infinity;
    }
    unit = Math.min(unit, y);
    return Math.sign(e.deltaY) * Math.max(1, Math.round(y / unit));
  };
}
