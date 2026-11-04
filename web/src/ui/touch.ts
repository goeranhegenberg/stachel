// Hinweistexte passend zur Eingabe: Auf Touch-Geräten (Handy, Tablet ohne Maus) helfen „Strg V“, „Doppelklick“,
// „Rechtsklick“ oder „Mausrad“ nicht weiter (x-mobile N1).

/** Hauptzeiger ist ein Finger (pointer: coarse). */
export const isTouch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Text für Maus/Tastatur bzw. für Touch: `byPointer('Doppelklick …', 'Doppeltippen …')`. */
export const byPointer = <T>(mouse: T, touch: T): T => (isTouch() ? touch : mouse);
