// Eigene Vorlagen über `/api/templates` (server/src/user-templates.ts) mit kleinem Zwischenspeicher für die Galerie:
// einmal je Sitzung laden, Speichern/Löschen halten die Liste aktuell. Ohne Server (Offline-Modus für Bildschirmfotos)
// bleibt die Liste leer.
import { useEffect, useSyncExternalStore } from 'react';
import { request } from '../../../api';
import type { BoardObject } from '../../../protocol';
import { cleanTemplateObjects, type OwnTemplate } from './own';

interface State {
  list: OwnTemplate[];
  loaded: boolean;
}

let state: State = { list: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}

const fromServer = (t: { id: string; name: string; createdAt: string; objects: unknown }): OwnTemplate => ({ id: t.id, name: t.name, createdAt: t.createdAt, objects: cleanTemplateObjects(t.objects) });

/** Liste (neu) laden; Fehler = leer lassen. */
export function loadOwnTemplates(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = request<{ templates: { id: string; name: string; createdAt: string; objects: unknown }[] }>('GET', '/api/templates')
    .then((r) => set({ list: r.templates.map(fromServer), loaded: true }))
    .catch(() => set({ ...state, loaded: true }));
  return loading;
}

/** Auswahl als eigene Vorlage speichern; wirft ApiError (Text über `errorText`). */
export async function saveOwnTemplate(name: string, objects: readonly BoardObject[]): Promise<OwnTemplate> {
  const r = await request<{ template: { id: string; name: string; createdAt: string; objects: unknown } }>('POST', '/api/templates', { name, objects });
  const t = fromServer(r.template);
  set({ list: [t, ...state.list.filter((x) => x.id !== t.id)], loaded: true });
  return t;
}

export async function deleteOwnTemplate(id: string): Promise<void> {
  await request('DELETE', `/api/templates/${encodeURIComponent(id)}`);
  set({ ...state, list: state.list.filter((t) => t.id !== id) });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Eigene Vorlagen für die Galerie (lädt bei jedem Öffnen neu: auf einem anderen Gerät gespeicherte kommen dazu). */
export function useOwnTemplates(): State {
  useEffect(() => {
    void loadOwnTemplates(true);
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Nur für Tests: Zwischenspeicher leeren. */
export function resetOwnTemplates() {
  loading = null;
  set({ list: [], loaded: false });
}
