// Minimal-Routing über Query-Parameter (`<Basis>?b=<boardId>`), damit der Server keinen SPA-Fallback braucht.
// Die Basis ist der Pfad, unter dem die Web-App läuft: `/` oder mit STACHEL_BASE_PATH z. B. `/app/` (server/src/site.ts).
// Der Build ist pfadneutral (Vite `base: './'`), die Basis ergibt sich aus der Adresse beim Laden: der Server liefert
// index.html nur unter der Basis aus, Unterseiten gibt es nicht.
import { useSyncExternalStore } from 'react';

export type Route = { name: 'boards' } | { name: 'board'; id: string } | { name: 'offline'; demo: boolean } | { name: 'account' };

/** Basis aus einem Pfad: `/app/` → `/app/`, `/app/index.html` → `/app/`, `/app` → `/app/`. */
export function baseOf(pathname: string): string {
  const p = pathname.replace(/[^/]*\.html$/, '');
  return p.endsWith('/') ? p : `${p}/`;
}

/** Pfad der Web-App, immer mit `/` am Ende (`/` oder z. B. `/app/`). */
export const APP_BASE = typeof location === 'undefined' ? '/' : baseOf(location.pathname);

/** Adresse einer Seite der Web-App: `appHref()` = Übersicht, `appHref('?konto=1')`. */
export const appHref = (query = '') => `${APP_BASE}${query}`;

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  if (q.get('offline') === '1') return { name: 'offline', demo: q.get('demo') === '1' };
  // Konto-Seite (nur Modus local, pages/account/AccountPage.tsx)
  if (q.get('konto') === '1') return { name: 'account' };
  const b = q.get('b');
  if (b) return { name: 'board', id: b };
  return { name: 'boards' };
}

const listeners = new Set<() => void>();
if (typeof window !== 'undefined') window.addEventListener('popstate', () => listeners.forEach((fn) => fn()));

/** Navigiert innerhalb der Web-App; `to` ist eine volle Adresse (`appHref(…)`, `boardHref(…)`). */
export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach((fn) => fn());
}

export const boardHref = (id: string) => appHref(`?b=${encodeURIComponent(id)}`);

/** Kurzlink auf ein Board zum Teilen (`<Origin><Basis>b/<id>`, der Server leitet weiter, Apps übernehmen ihn). */
export const boardShareUrl = (id: string, origin = location.origin) => `${origin}${APP_BASE}b/${encodeURIComponent(id)}`;

export function useRoute(): Route {
  const search = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => location.search,
  );
  return parseRoute(search);
}
