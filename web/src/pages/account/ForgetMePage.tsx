// „Meine Daten“ im Modus org (`/?konto=1`, docs/contract.md §6): Stachel hat kein eigenes Konto, speichert aber
// Persönliches (Anmeldungen samt Org-Token, KI-Zugänge, Favoriten, „zuletzt geöffnet“, Posteingang, Name auf
// Boards). „Meine Daten bei Stachel löschen“ = `POST /api/account/delete {confirm: true}`; das Konto bei der
// Organisation bleibt.
import { useEffect, useState } from 'react';
import type { User } from '../../protocol';
import { errorText, request } from '../../api';
import { appHref, navigate } from '../../router';
import { Wordmark } from '../../ui/Logo';
import { useInstance } from '../../instance';
import { Modal } from '../../ui/Modal';
import { IconArrowLeft } from '../../ui/icons';
import { LegalFooter } from './Footer';
import '../boards.css';
import './account.css';

export function ForgetMePage({ user, onLoggedOut }: { user: User; onLoggedOut: () => void }) {
  const [asking, setAsking] = useState(false);
  const org = useInstance()?.orgName ?? 'der Organisation';
  useEffect(() => {
    document.title = 'Meine Daten · Stachel';
    return () => {
      document.title = 'Stachel';
    };
  }, []);
  return (
    <div className="acc-page">
      <header className="boards-top">
        <Wordmark size={26} inverted />
      </header>
      <main className="acc-main">
        <button className="acc-back" onClick={() => navigate(appHref())}>
          <IconArrowLeft size={18} /> Zur Übersicht
        </button>
        <h1>Meine Daten</h1>
        <section className="acc-card" aria-labelledby="fm-who-h">
          <h2 id="fm-who-h">{user.name}</h2>
          <p className="acc-meta">
            Du bist mit deinem Konto bei {org} angemeldet. Name und Konto verwaltet {org}; Stachel merkt sich nur, was es zum Arbeiten
            braucht.
          </p>
        </section>
        <section className="acc-card acc-card--danger" aria-labelledby="fm-del-h">
          <h2 id="fm-del-h">Meine Daten bei Stachel löschen</h2>
          <p>
            Löscht alle Anmeldungen bei Stachel (auch in der App) samt gespeichertem Anmelde-Token, deine KI-Zugänge (API-Tokens), Favoriten,
            „Zuletzt geöffnet“ und deinen Posteingang. Auf den Boards steht bei deinen Kommentaren, Reaktionen und Stimmen dann „Gelöschtes Konto“.
            Die Boards gehören dem Team und bleiben. Dein Konto bei {org} bleibt bestehen.
          </p>
          <button className="btn btn--danger btn--sm" style={{ justifySelf: 'start' }} onClick={() => setAsking(true)} data-testid="forget-me">
            Meine Daten löschen …
          </button>
        </section>
      </main>
      <LegalFooter />
      {asking && (
        <ConfirmDialog
          onCancel={() => setAsking(false)}
          onDone={() => {
            navigate(appHref(), true);
            onLoggedOut();
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await request<{ ok: true }>('POST', '/api/account/delete', { confirm: true });
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Deine Daten bei Stachel löschen?" onClose={onCancel}>
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ margin: 0 }}>Das lässt sich nicht rückgängig machen. Du wirst überall bei Stachel abgemeldet.</p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={run} data-autofocus>
            {busy ? 'Lösche …' : 'Endgültig löschen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
