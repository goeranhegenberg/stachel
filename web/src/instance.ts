// Betriebsart der Instanz (GET /api/instance, docs/features/accounts.md): org (Anmeldung über den Identitätsdienst einer
// Organisation und deren App, ein Team) oder local (eigene Konten, Boards gehören jemandem). Einmal je Seite geladen;
// Fehler = org mit neutralen Namen (die Anmeldeseite bietet dann QR und, falls vorhanden, Passwort an).
import { useSyncExternalStore } from 'react';

export interface Instance {
  auth: 'org' | 'local';
  brand: string;
  imprintUrl: string | null;
  privacyUrl: string | null;
  /** Nutzungsbedingungen (STACHEL_TERMS_URL), null = keine */
  termsUrl: string | null;
  registration: 'open' | 'invite' | null;
  /** Modus local: false = Konten sind nach dem Registrieren sofort aktiv (keine Bestätigungsmail) */
  verification?: boolean;
  /** Modus org: Name der Organisation („Mit {orgName} anmelden“), sonst null */
  orgName: string | null;
  /** Modus org: Name ihrer App („In der {orgAppName} öffnen“), sonst null */
  orgAppName: string | null;
  /** Modus org: Passwort-Anmeldung über die Organisation möglich */
  orgPasswordLogin: boolean;
  /** Modus org: Android-Paket der App für „In der App öffnen“ (null = kein Knopf auf Android) */
  orgAndroidPackage: string | null;
  /** „Zettel abfotografieren“ auf diesem Server (STACHEL_PHOTO_NOTES); fehlt bei älteren Servern = aus */
  photoNotes?: boolean;
}

const ORG_NAME = 'Organisation';

/** Rückfall, wenn /api/instance nicht antwortet (älterer Server, Netzfehler). */
export const FALLBACK_INSTANCE: Instance = {
  auth: 'org',
  brand: 'Stachel',
  imprintUrl: null,
  privacyUrl: null,
  termsUrl: null,
  registration: null,
  orgName: ORG_NAME,
  orgAppName: `${ORG_NAME}-App`,
  orgPasswordLogin: true,
  orgAndroidPackage: null,
};

const text = (v: unknown, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

let current: Instance | null = null;
let loading: Promise<Instance> | null = null;
const listeners = new Set<() => void>();

export function loadInstance(): Promise<Instance> {
  loading ??= fetch('/api/instance', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d): Instance => {
      if (!d || (d.auth !== 'local' && d.auth !== 'org')) return FALLBACK_INSTANCE;
      const org = d.auth === 'org';
      const orgName = org ? (text(d.orgName) ?? ORG_NAME) : null;
      return {
        auth: d.auth,
        brand: typeof d.brand === 'string' && d.brand ? d.brand : 'Stachel',
        imprintUrl: typeof d.imprintUrl === 'string' ? d.imprintUrl : null,
        privacyUrl: typeof d.privacyUrl === 'string' ? d.privacyUrl : null,
        termsUrl: typeof d.termsUrl === 'string' ? d.termsUrl : null,
        registration: d.registration === 'invite' ? 'invite' : d.registration === 'open' ? 'open' : null,
        verification: d.verification !== false,
        orgName,
        orgAppName: org ? (text(d.orgAppName) ?? `${orgName}-App`) : null,
        orgPasswordLogin: org && d.orgPasswordLogin === true,
        orgAndroidPackage: org ? text(d.orgAndroidPackage, 200) : null,
        photoNotes: d.photoNotes === true,
      };
    })
    .catch(() => FALLBACK_INSTANCE)
    .then((i) => {
      current = i;
      listeners.forEach((fn) => fn());
      return i;
    });
  return loading;
}

/** Aktuelle Instanz; null, solange sie lädt. */
export function useInstance(): Instance | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void loadInstance();
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Synchron (nach dem ersten Laden): Modus local? */
export const isLocal = () => current?.auth === 'local';

/** Synchron (nach dem ersten Laden): „Zettel abfotografieren“ verfügbar? */
export const photoNotesAvailable = () => current?.photoNotes === true;

/** Nur für Tests. */
export function setInstanceForTest(i: Instance | null) {
  current = i;
  loading = i ? Promise.resolve(i) : null;
  listeners.forEach((fn) => fn());
}

// ---- Personen mit Zugriff auf ein Board (Erwähnungen, Zuständige) ------------------------------------------------

const people = new Map<string, Promise<{ key: string; name: string }[] | null>>();

/**
 * Modus local: Personen mit Zugriff auf das Board (GET /api/boards/:id/people), sonst null (= keine Einschränkung).
 * Einmal je Board und Seite.
 */
export function boardPeople(boardId: string | null): Promise<{ key: string; name: string }[] | null> {
  if (!boardId) return Promise.resolve(null);
  let p = people.get(boardId);
  if (!p) {
    p = loadInstance().then((i) =>
      i.auth !== 'local'
        ? null
        : fetch(`/api/boards/${encodeURIComponent(boardId)}/people`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => (Array.isArray(d?.users) ? (d.users as { key: string; name: string }[]) : null))
            .catch(() => {
              people.delete(boardId);
              return null;
            }),
    );
    people.set(boardId, p);
  }
  return p;
}

/** Board-ID der aktuellen Adresse (`/?b=<id>`). */
export const currentBoardId = () => new URLSearchParams(location.search).get('b');
