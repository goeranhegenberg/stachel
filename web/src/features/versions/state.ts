// Zustand des Versionsverlaufs (Modul-weit, überlebt den Neuaufbau des Editors beim Wechsel Live ↔ Vorschau).
import * as Y from 'yjs';
import { LocalSession, type BoardSession, type UploadedImage } from '../../board/session';
import type { Camera } from '../../board/geometry';
import type { BoardVersionInfo } from '../../protocol';
import { imageUrl } from '../../api';
import { getSessionOverride, setSessionOverride } from '../../editor/ext/sessionOverride';
import type { EditorApi } from '../../editor/ext/types';
import { versionsApi } from './api';

export const SIDEBAR_ID = 'versions.history';

/** Schreibgeschützte Sitzung mit dem Inhalt einer alten Version (nur im Browser, nichts geht an den Server). */
export class PreviewSession extends LocalSession {
  constructor(user: { key: string; name: string }, update: Uint8Array) {
    super({ key: user.key, name: user.name, isOrga: false });
    Y.applyUpdate(this.doc, update);
  }
  imageSrc(imageId: string) {
    return imageUrl(imageId);
  }
  async uploadImage(): Promise<UploadedImage> {
    throw new Error('Die Vorschau ist schreibgeschützt.');
  }
}

export interface Preview {
  boardId: string;
  version: BoardVersionInfo;
  session: PreviewSession;
  live: BoardSession;
}

/** Kleiner beobachtbarer Wert (useSyncExternalStore). */
class Cell<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set(v: T) {
    if (v === this.value) return;
    this.value = v;
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export const preview = new Cell<Preview | null>(null);
/** Version, deren Inhalt gerade lädt (Anzeige im Eintrag) */
export const loading = new Cell<string | null>(null);
/** Version, deren Wiederherstellen gerade bestätigt werden soll */
export const confirmRestore = new Cell<BoardVersionInfo | null>(null);
/** Versionslisten je Board (sofort da beim Neuaufbau des Editors) */
export const lists = new Cell<ReadonlyMap<string, BoardVersionInfo[]>>(new Map());

/** Beim nächsten Aufbau des Editors anwenden (Kamera behalten, Seitenleiste wieder öffnen, Hinweis zeigen). */
export const pending: { cam: Camera | null; sidebar: boolean | null; toast: string } = { cam: null, sidebar: null, toast: '' };

export function setList(boardId: string, list: BoardVersionInfo[]) {
  const next = new Map(lists.get());
  next.set(boardId, list);
  lists.set(next);
}

export async function reloadList(boardId: string): Promise<BoardVersionInfo[]> {
  const list = await versionsApi.list(boardId);
  setList(boardId, list);
  return list;
}

/** Live-Sitzung hinter dem Editor (in der Vorschau die verdeckte). */
export const liveSession = (api: EditorApi): BoardSession => getSessionOverride()?.live ?? api.session;

let seq = 0;

/** Version auf der Leinwand zeigen (schreibgeschützt). Das Live-Board bleibt verbunden und unverändert. */
export async function openPreview(api: EditorApi, boardId: string, version: BoardVersionInfo, opts: { keepSidebar: boolean }) {
  const my = ++seq;
  loading.set(version.id);
  let bytes: Uint8Array;
  try {
    bytes = await versionsApi.content(boardId, version.id);
  } finally {
    if (my === seq) loading.set(null);
  }
  if (my !== seq) return; // inzwischen andere Version gewählt
  const live = liveSession(api);
  const session = new PreviewSession(live.user, bytes);
  const before = preview.get();
  pending.cam = api.camera();
  pending.sidebar = opts.keepSidebar;
  preview.set({ boardId, version, session, live });
  setSessionOverride({ live, session, key: `versions:${version.id}:${my}` });
  if (before) setTimeout(() => before.session.destroy(), 0); // nach dem Neuaufbau
}

/** Zurück zum aktuellen Stand. */
export function closePreview(api: EditorApi | null, opts: { keepSidebar?: boolean; toast?: string } = {}) {
  seq++;
  loading.set(null);
  const before = preview.get();
  if (!before) return;
  if (api) pending.cam = api.camera();
  pending.sidebar = opts.keepSidebar ?? (api ? api.sidebar() === SIDEBAR_ID : null);
  if (opts.toast) pending.toast = opts.toast;
  preview.set(null);
  setSessionOverride(null);
  setTimeout(() => before.session.destroy(), 0);
}

/** Beim Verlassen des Boards: Vorschau verwerfen (ohne Neuaufbau). */
export function dropPreview() {
  const before = preview.get();
  if (!before) return;
  seq++;
  preview.set(null);
  if (getSessionOverride()?.session === before.session) setSessionOverride(null);
  setTimeout(() => before.session.destroy(), 0);
}
