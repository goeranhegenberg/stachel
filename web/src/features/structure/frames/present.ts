// Präsentation: Vollbild (über die Fullscreen-API) und Awareness-Feld für Mitlesende.

/** Awareness: `{ frameId, index, total, title }` der präsentierenden Person, sonst null. */
export const PRESENT_FIELD = 'structure.present';

export interface PresentState {
  frameId: string;
  index: number;
  total: number;
  title: string;
  /** clientId der Person, von der übernommen wurde (Übergabe, docs/features/private.md §7) */
  from?: number;
}

const PREF = 'stachel.structure.presentFullscreen';
/** Hat die Präsentation das Vollbild selbst geöffnet? (Dann schließt sie es auch wieder.) */
let ours = false;
/** Vollbild per Knopf verlassen (nicht per Esc) – dann läuft die Präsentation weiter. */
let manualExit = false;

export function takeManualExit(): boolean {
  const v = manualExit;
  manualExit = false;
  return v;
}

/** Vollbild beim Start der Präsentation (gemerkt, ob man es zuletzt ausgeschaltet hat). */
export function wantFullscreen(): boolean {
  try {
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return true;
  }
}

function remember(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? '1' : '0');
  } catch {
    /* kein Speicher (privates Fenster) */
  }
}

export function startPresentFullscreen(byUser = false) {
  if (byUser) remember(true);
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  ours = true;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    ours = false;
  });
}

export function endPresentFullscreen(byUser = false) {
  if (byUser) remember(false);
  if (!document.fullscreenElement || (!ours && !byUser)) return;
  manualExit = byUser;
  ours = false;
  document.exitFullscreen().catch(() => {});
}
