// Aktionen des Versionsverlaufs: wiederherstellen, als Kopie öffnen, speichern, benennen.
import type { BoardVersionInfo } from '../../protocol';
import { errorText } from '../../api';
import { boardHref, navigate } from '../../router';
import type { EditorApi } from '../../editor/ext/types';
import { versionsApi } from './api';
import { closePreview, preview, reloadList, setList, lists, SIDEBAR_ID } from './state';
import { stamp, whenLabel } from './format';

/** ID des offenen Boards (null im Offline-Modus). */
export function currentBoardId(search = location.search): string | null {
  const q = new URLSearchParams(search);
  return q.get('offline') === '1' ? null : q.get('b');
}

/** Titel des offenen Boards (Titel-Knopf oben links, sonst document.title). */
function boardTitle(): string {
  const shown = document.querySelector('[data-testid="board-title"]')?.textContent?.trim();
  return shown || document.title.replace(/\s*·\s*Stachel\s*$/, '').trim();
}

/** Bestätigte Wiederherstellung: Live-Board für alle auf den Stand der Version bringen, Vorschau schließen. */
export async function restoreVersion(api: EditorApi, boardId: string, v: BoardVersionInfo): Promise<boolean> {
  try {
    const res = await versionsApi.restore(boardId, v.id);
    const when = whenLabel(v.createdAt);
    const toast = res.changed
      ? `Stand von ${when} wiederhergestellt – alle sehen ihn jetzt. Der vorige Stand ist als Version gesichert.`
      : `Das Board hat schon den Stand von ${when}.`;
    void reloadList(boardId).catch(() => {});
    if (preview.get()) closePreview(api, { toast, keepSidebar: api.viewSize().w >= 700 && api.sidebar() === SIDEBAR_ID });
    else api.toast(toast);
    return true;
  } catch (e) {
    api.toast(errorText(e));
    return false;
  }
}

/** Neues Board mit dem Inhalt der Version anlegen und öffnen. */
export async function copyVersion(api: EditorApi, boardId: string, v: BoardVersionInfo) {
  try {
    const title = boardTitle();
    const board = await versionsApi.copy(boardId, v.id, title ? `${title} (Stand ${stamp(v.createdAt)})`.slice(0, 120) : undefined);
    closePreview(null);
    navigate(boardHref(board.id));
  } catch (e) {
    api.toast(errorText(e));
  }
}

export async function saveVersion(api: EditorApi, boardId: string, name: string): Promise<BoardVersionInfo | null> {
  try {
    const v = await versionsApi.save(boardId, name);
    void reloadList(boardId).catch(() => {});
    api.toast(`Version „${v.name}“ gespeichert.`);
    return v;
  } catch (e) {
    api.toast(errorText(e));
    return null;
  }
}

export async function renameVersion(api: EditorApi, boardId: string, v: BoardVersionInfo, name: string): Promise<boolean> {
  try {
    const next = await versionsApi.rename(boardId, v.id, name);
    const list = lists.get().get(boardId);
    if (list) setList(boardId, list.map((x) => (x.id === next.id ? next : x)));
    const pv = preview.get();
    if (pv?.version.id === next.id) preview.set({ ...pv, version: next });
    return true;
  } catch (e) {
    api.toast(errorText(e));
    return false;
  }
}
