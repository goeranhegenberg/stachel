// Kleine Hilfen des Moduls: Board-ID/-Titel aus der Seite, Datei speichern, Link in die Zwischenablage.
import { APP_BASE } from '../../router';

/** ID des offenen Boards (null im Offline-Modus), wie router.parseRoute. */
export function currentBoardId(search = location.search): string | null {
  const q = new URLSearchParams(search);
  return q.get('offline') === '1' ? null : q.get('b');
}

/** Titel des offenen Boards (Titel-Knopf oben links, sonst document.title = „<Titel> · Stachel“). */
export function currentBoardTitle(): string {
  const shown = document.querySelector('[data-testid="board-title"]')?.textContent?.trim();
  if (shown) return shown;
  const t = document.title.replace(/\s*·\s*Stachel\s*$/, '').trim();
  return t && t !== 'Stachel' ? t : 'Board';
}

/** Dateiname ohne verbotene Zeichen: „Sommerfest – Ablauf.png“ */
export function fileName(base: string, ext: string): string {
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Stachel';
  return `${clean}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Text in die Zwischenablage; Fallback über ein verstecktes Feld (ältere Browser, kein https). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Link auf ein Objekt im Board: <Basis>?b=<board>&o=<objekt> (Basis `/` bzw. z. B. `/app/`, router.ts) */
export function objectLink(boardId: string | null, objectId: string, origin = location.origin, base = APP_BASE): string {
  const q = new URLSearchParams();
  if (boardId) q.set('b', boardId);
  else q.set('offline', '1');
  q.set('o', objectId);
  return `${origin}${base}?${q.toString()}`;
}
