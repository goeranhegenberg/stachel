// Konto-Seite: „Blockierte Personen“ mit „Blockierung aufheben“ (GET/DELETE /api/blocks).
import { useEffect, useState } from 'react';
import { errorText } from '../../api';
import { Modal } from '../../ui/Modal';
import { loadBlocked, unblockPerson, useBlocked } from './useBlocked';

export function BlockedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Blockierte Personen" onClose={onClose}>
      <BlockedList heading={false} />
      <div className="modal-actions">
        <button className="btn btn--primary btn--sm" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}

export function BlockedList({ heading = true }: { heading?: boolean }) {
  const list = useBlocked();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadBlocked(true).then(() => setLoaded(true));
  }, []);
  return (
    <section className="mod-blocked" {...(heading ? { 'aria-labelledby': 'mod-blocked-h' } : { 'aria-label': 'Blockierte Personen' })} data-testid="blocked-list">
      {heading && <h2 id="mod-blocked-h">Blockierte Personen</h2>}
      <p className="mod-note">Von blockierten Personen bekommst du keine Einladungen und keine @Erwähnungen. Blockieren kannst du über die Personenliste eines Boards.</p>
      {!loaded && !list.length ? null : list.length === 0 ? (
        <p className="mod-note">Du hast niemanden blockiert.</p>
      ) : (
        <ul className="mod-blocked__list">
          {list.map((p) => (
            <li key={p.key}>
              <span>{p.name}</span>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => void unblockPerson(p.key).catch((e) => setError(errorText(e)))}
                aria-label={`Blockierung von ${p.name} aufheben`}
              >
                Blockierung aufheben
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
