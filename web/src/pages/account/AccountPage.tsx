// Konto-Seite (Modus local, `/?konto=1`): Name ändern, Passwort ändern, abmelden, Konto löschen (DSGVO: eigene Boards
// löschen oder an eine Person mit Zugriff übertragen).
import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '../../protocol';
import { api, ApiError, errorText } from '../../api';
import { appHref, navigate } from '../../router';
import { useInstance } from '../../instance';
import { Wordmark } from '../../ui/Logo';
import { Modal } from '../../ui/Modal';
import { clearThumbs } from '../../ui/thumbs';
import { IconArrowLeft, IconLogout } from '../../ui/icons';
import { accountApi, ROLE_NAMES, type OwnedBoard } from './accountApi';
import { LegalFooter } from './Footer';
import '../boards.css';
import './account.css';

// Blockierte Personen (Feature-Modul moderation)
import { BlockedList } from '../../features/moderation/BlockedList';

const MIN_PW = 10;

export function AccountPage({ user, onUser, onLoggedOut }: { user: User; onUser: (u: User) => void; onLoggedOut: () => void }) {
  const inst = useInstance();
  const [account, setAccount] = useState<{ name: string; email: string; createdAt: string } | null>(null);
  const [boards, setBoards] = useState<OwnedBoard[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(user.name);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handle = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'not_logged_in') {
      onLoggedOut();
      return true;
    }
    return false;
  };

  useEffect(() => {
    document.title = `Konto · ${inst?.brand ?? 'Stachel'}`;
    accountApi
      .account()
      .then((r) => {
        setAccount(r.account);
        setName(r.account.name);
        setBoards(r.boards);
      })
      .catch((e) => !handle(e) && setLoadError(errorText(e)));
    return () => {
      document.title = 'Stachel';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNameMsg(null);
    try {
      const u = await accountApi.rename(name.trim());
      onUser(u);
      setName(u.name);
      setNameMsg({ ok: true, text: 'Name gespeichert.' });
    } catch (err) {
      if (!handle(err)) setNameMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const savePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.next.length < MIN_PW) return setPwMsg({ ok: false, text: `Das neue Passwort braucht mindestens ${MIN_PW} Zeichen.` });
    setBusy(true);
    setPwMsg(null);
    try {
      await accountApi.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      setPwMsg({ ok: true, text: 'Passwort geändert. Andere Geräte sind jetzt abgemeldet.' });
    } catch (err) {
      if (!handle(err)) setPwMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* egal */
    }
    clearThumbs();
    navigate(appHref(), true);
    onLoggedOut();
  };

  // „Meine Daten herunterladen“ (Art. 20 DSGVO): ZIP vom Server, per Blob gespeichert, damit Fehler hier erscheinen
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const r = await fetch(accountApi.exportUrl, { credentials: 'same-origin' });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new ApiError(d?.error ?? 'server', r.status, d?.message);
      }
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'stachel-daten.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportMsg({ ok: true, text: `Gespeichert: ${name}` });
    } catch (err) {
      if (!handle(err)) setExportMsg({ ok: false, text: errorText(err) });
    } finally {
      setExporting(false);
    }
  };

  const msg = (m: { ok: boolean; text: string } | null) =>
    m && (
      <div className={m.ok ? 'acc-ok' : 'alert'} role={m.ok ? 'status' : 'alert'}>
        {m.text}
      </div>
    );

  return (
    <div className="acc-page">
      <header className="boards-top">
        <Wordmark size={26} inverted />
        <button className="btn btn--sm boards-top__logout" onClick={logout} aria-label="Abmelden">
          <IconLogout size={18} /> <span>Abmelden</span>
        </button>
      </header>
      <main className="acc-main">
        <button className="acc-back" onClick={() => navigate(appHref())}>
          <IconArrowLeft size={18} /> Zur Übersicht
        </button>
        <h1>Dein Konto</h1>
        {loadError && (
          <div className="alert" role="alert">
            {loadError}
          </div>
        )}

        <form className="acc-card" onSubmit={saveName} aria-labelledby="acc-name-h">
          <h2 id="acc-name-h">Name</h2>
          <p className="acc-meta">So sehen dich die anderen auf Boards, bei Kommentaren und Erwähnungen.</p>
          {msg(nameMsg)}
          <div className="acc-row">
            <div className="field">
              <label htmlFor="acc-name">Name</label>
              <input id="acc-name" className="input" maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn btn--primary btn--sm" type="submit" disabled={busy || !name.trim() || name.trim() === user.name}>
              Speichern
            </button>
          </div>
          {account && (
            <p className="acc-meta" data-testid="account-email">
              E-Mail-Adresse: <b>{account.email}</b> · dabei seit {new Date(account.createdAt).toLocaleDateString('de-DE')}
            </p>
          )}
        </form>

        <div className="acc-card">
          <BlockedList />
        </div>

        <form className="acc-card" onSubmit={savePw} aria-labelledby="acc-pw-h">
          <h2 id="acc-pw-h">Passwort ändern</h2>
          {msg(pwMsg)}
          <input type="email" autoComplete="username" value={account?.email ?? ''} readOnly hidden />
          <div className="acc-row">
            <div className="field">
              <label htmlFor="acc-pw-cur">Bisheriges Passwort</label>
              <input id="acc-pw-cur" className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="acc-pw-new">Neues Passwort</label>
              <input id="acc-pw-new" className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
          </div>
          <button className="btn btn--primary btn--sm" type="submit" disabled={busy || !pw.current || !pw.next} style={{ justifySelf: 'start' }}>
            Passwort ändern
          </button>
        </form>

        <section className="acc-card" aria-labelledby="acc-export-h">
          <h2 id="acc-export-h">Meine Daten herunterladen</h2>
          <p className="acc-meta">
            Eine ZIP-Datei mit deinen Kontodaten und deinen eigenen Boards ({boards.length}) als JSON samt hochgeladener Bilder und PDFs – zum Aufbewahren oder
            Mitnehmen in ein anderes Programm.
          </p>
          {msg(exportMsg)}
          <button className="btn btn--primary btn--sm" style={{ justifySelf: 'start' }} onClick={() => void download()} disabled={exporting || !account} data-testid="account-export">
            {exporting ? 'Wird erstellt …' : 'Daten herunterladen'}
          </button>
        </section>

        <section className="acc-card acc-card--danger" aria-labelledby="acc-del-h">
          <h2 id="acc-del-h">Konto löschen</h2>
          <p>
            Löscht dein Konto mit Name, E-Mail-Adresse und Passwort. Deine eigenen Boards ({boards.length}) kannst du vorher an eine Person übertragen, die schon Zugriff
            hat – sonst werden sie gelöscht. Auch deine KI-Zugänge (API-Tokens) werden gelöscht. Deine Kommentare, Reaktionen und Stimmen auf Boards
            anderer bleiben stehen, statt deines Namens steht dort dann „Gelöschtes Konto“.
          </p>
          <button className="btn btn--danger btn--sm" style={{ justifySelf: 'start' }} onClick={() => setDeleting(true)} disabled={!account}>
            Konto löschen …
          </button>
        </section>
      </main>
      <LegalFooter />
      {deleting && (
        <DeleteDialog
          boards={boards}
          onCancel={() => setDeleting(false)}
          onDeleted={() => {
            clearThumbs();
            navigate(appHref(), true);
            onLoggedOut();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({ boards, onCancel, onDeleted }: { boards: OwnedBoard[]; onCancel: () => void; onDeleted: () => void }) {
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(boards.map((b) => [b.id, 'delete'])));
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.deleteAccount(password, choice);
      onDeleted();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Konto wirklich löschen?" onClose={onCancel}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        {boards.length > 0 && (
          <>
            <p style={{ margin: 0 }}>Was soll mit deinen Boards passieren?</p>
            <ul className="acc-boards">
              {boards.map((b) => (
                <li key={b.id}>
                  <span>
                    <b>{b.title}</b>
                    {b.inTrash && <span className="acc-role">Papierkorb</span>}
                  </span>
                  <select aria-label={`${b.title}: löschen oder übertragen`} value={choice[b.id]} onChange={(e) => setChoice({ ...choice, [b.id]: e.target.value })}>
                    <option value="delete">Löschen</option>
                    {!b.inTrash &&
                      b.people.map((p) => (
                        <option key={p.key} value={p.key}>
                          Übertragen an {p.name} ({ROLE_NAMES[p.role]})
                        </option>
                      ))}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="field">
          <label htmlFor="acc-del-pw">Zur Bestätigung dein Passwort</label>
          <input id="acc-del-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus />
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--danger btn--sm" disabled={busy || !password}>
            {busy ? 'Lösche …' : 'Endgültig löschen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
