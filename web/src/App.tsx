import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { User } from './protocol';
import { api, ApiError } from './api';
import { useRoute } from './router';
import { StachelMark } from './ui/Logo';
import { useInstance } from './instance';
import { clearThumbs } from './ui/thumbs';
import type { TermsState } from './pages/account/TermsGate';

// Seiten getrennt laden: Anmeldung (QR-Code), Übersicht und Editor (Tiptap, Feature-Module) sind eigene Pakete
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const BoardsPage = lazy(() => import('./pages/BoardsPage').then((m) => ({ default: m.BoardsPage })));
// Modus local (eigene Konten): Anmeldung/Registrierung und Konto-Seite
const LocalLoginPage = lazy(() => import('./pages/account/LocalLoginPage').then((m) => ({ default: m.LocalLoginPage })));
const AccountPage = lazy(() => import('./pages/account/AccountPage').then((m) => ({ default: m.AccountPage })));
// Modus org: „Meine Daten bei Stachel löschen“ unter derselben Adresse `/?konto=1`
const ForgetMePage = lazy(() => import('./pages/account/ForgetMePage').then((m) => ({ default: m.ForgetMePage })));
// Modus local: erneute Zustimmung zu geänderten Nutzungsbedingungen (STACHEL_TERMS_VERSION)
const TermsGate = lazy(() => import('./pages/account/TermsGate').then((m) => ({ default: m.TermsGate })));
/**
 * Editor-Paket und Tiptap (Rich-Text-Bearbeitung, ≈ 400 KB) gleichzeitig anfordern statt nacheinander. Auf Tiptap
 * wartet erst die Editor-Seite selbst (TextEngine.ready), nachdem sie die Sync-Verbindung schon aufgebaut hat.
 */
const loadEditor = () => {
  void import('./features/richtext/RichEdit').catch(() => {});
  return import('./editor/EditorPage');
};
const EditorPage = lazy(() => loadEditor().then((m) => ({ default: m.EditorPage })));

const OFFLINE_USER: User = { key: 'a:offline', name: 'Du (offline)', isOrga: true };

const splash = (
  <div className="splash" aria-busy="true" aria-label="Lädt">
    <StachelMark size={64} body="#fff" />
  </div>
);

export function App() {
  return <Suspense fallback={splash}><Routes /></Suspense>;
}

function Routes() {
  const route = useRoute();
  const [user, setUser] = useState<User | null | undefined>(route.name === 'offline' ? OFFLINE_USER : undefined);
  const [bootError, setBootError] = useState<string | null>(null);
  // Betriebsart der Instanz (org | local), parallel zu /api/auth/me
  const inst = useInstance();
  // Modus local: geltende Fassung der Nutzungsbedingungen noch nicht akzeptiert → Dialog über der Seite
  const [terms, setTerms] = useState<TermsState | null>(null);

  const loadMe = useCallback(() => {
    setBootError(null);
    api
      .me()
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.code === 'not_logged_in') setUser(null);
        else if (e instanceof ApiError && e.status === 401) setUser(null);
        else {
          setUser(null);
          setBootError(e instanceof ApiError ? e.message : null);
        }
      });
  }, []);

  // Board-Adresse: Editor schon während der Anmeldeprüfung laden (nicht erst danach)
  useEffect(() => {
    if (route.name === 'board') void loadEditor().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // angemeldet: Editor im Hintergrund vorladen, damit das erste Board ohne Wartezeit aufgeht
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => void loadEditor().catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [!!user]);

  useEffect(() => {
    setTerms(null);
    if (!user || user === OFFLINE_USER || inst?.auth !== 'local') return;
    let live = true;
    void import('./pages/account/TermsGate')
      .then((m) => m.termsApi.state())
      .then((t) => live && setTerms(t.pending ? t : null))
      .catch(() => {}); // ohne Antwort kein Dialog (Server älter oder offline)
    return () => {
      live = false;
    };
  }, [user?.key, inst?.auth]);

  useEffect(() => {
    if (route.name === 'offline') return;
    loadMe();
  }, [route.name === 'offline', loadMe]);

  if (route.name === 'offline') return <EditorPage offline demo={route.demo} user={OFFLINE_USER} />;

  if (user === undefined || !inst) return splash;

  const local = inst.auth === 'local';
  // Links aus den Mails (bestätigen, neues Passwort) gehen immer auf die Anmeldeseite
  const q = new URLSearchParams(location.search);
  if (local && (q.has('verify') || q.has('reset'))) return <LocalLoginPage onLogin={setUser} />;

  if (user === null) return local ? <LocalLoginPage onLogin={setUser} notice={bootError} /> : <LoginPage onLogin={setUser} notice={bootError} />;

  const onLoggedOut = () => setUser(null);
  if (route.name === 'account') {
    // Konto-Seite ohne Dialog: wer nicht zustimmen will, kann hier sein Konto löschen
    return local ? <AccountPage user={user} onUser={setUser} onLoggedOut={onLoggedOut} /> : <ForgetMePage user={user} onLoggedOut={onLoggedOut} />;
  }
  const gate = terms && (
    <TermsGate
      state={terms}
      onAccepted={() => setTerms(null)}
      onLogout={() => {
        void api.logout().catch(() => {});
        clearThumbs();
        onLoggedOut();
      }}
    />
  );
  if (route.name === 'board') {
    return (
      <>
        <EditorPage boardId={route.id} user={user} onLoggedOut={onLoggedOut} />
        {gate}
      </>
    );
  }
  return (
    <>
      <BoardsPage user={user} onLoggedOut={onLoggedOut} />
      {gate}
    </>
  );
}
