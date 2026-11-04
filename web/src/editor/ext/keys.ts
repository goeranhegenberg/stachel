// Tastenkürzel-Schreibweise ('mod+shift+g', 'shift+Digit1', 'PageDown', '?') erkennen.
export interface KeySpec {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseKey(spec: string): KeySpec {
  const parts = spec.split('+');
  const key = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return { mod: has('mod') || has('ctrl'), shift: has('shift'), alt: has('alt'), key: key === 'plus' ? '+' : key };
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/**
 * Passt das Ereignis? Strg/⌘ muss genau stimmen; Umschalt/Alt nur, wenn die Schreibweise sie nennt
 * (spezifischere Kürzel deshalb zuerst prüfen, siehe specificity). Buchstaben ohne Groß/Klein, sonst `key` oder `code`.
 */
export function matchKey(s: KeySpec, e: KeyLike): boolean {
  if ((e.ctrlKey || e.metaKey) !== s.mod) return false;
  if (s.shift && !e.shiftKey) return false;
  if (s.alt && !e.altKey) return false;
  if (s.key.length === 1) return e.key.toLowerCase() === s.key.toLowerCase();
  return e.key === s.key || e.code === s.key;
}

/** Mehr Modifikatoren = spezifischer (wird zuerst geprüft). */
export const specificity = (s: KeySpec) => (s.mod ? 4 : 0) + (s.shift ? 2 : 0) + (s.alt ? 1 : 0);
