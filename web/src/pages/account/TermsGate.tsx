// Erneute Zustimmung zu geänderten Nutzungsbedingungen (Modus local, STACHEL_TERMS_VERSION; Nutzungsbedingungen § 11):
// Ist die geltende Fassung noch nicht akzeptiert, liegt dieser Dialog über der Board-Übersicht bzw. dem Editor, bis die
// Person zustimmt, sich abmeldet oder über „Konto“ ihr Konto löscht. Server: GET/POST /api/account/terms (accounts.ts).
import { useState } from 'react';
import { errorText, request } from '../../api';
import { appHref } from '../../router';
import { Modal } from '../../ui/Modal';
import './account.css';

export interface TermsState {
  url: string | null;
  version: string | null;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  pending: boolean;
}

export const termsApi = {
  state: () => request<TermsState & { ok: true }>('GET', '/api/account/terms'),
  accept: (version: string | null) => request<TermsState & { ok: true }>('POST', '/api/account/terms', { accept: true, version }),
};

export function TermsGate({ state, onAccepted, onLogout }: { state: TermsState; onAccepted: () => void; onLogout: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = !state.acceptedVersion;
  const accept = async () => {
    if (!checked) return setError('Bitte setze das Häkchen, um zuzustimmen.');
    setBusy(true);
    setError(null);
    try {
      await termsApi.accept(state.version);
      onAccepted();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={first ? 'Nutzungsbedingungen' : 'Neue Nutzungsbedingungen'} onClose={() => {}}>
      <div style={{ display: 'grid', gap: 14 }} data-testid="terms-gate">
        <p style={{ margin: 0 }}>
          {first
            ? 'Für die Nutzung gelten Nutzungsbedingungen. Bitte lies sie und stimme zu, um weiterzuarbeiten.'
            : 'Wir haben die Nutzungsbedingungen geändert. Bitte lies die neue Fassung und stimme zu, um weiterzuarbeiten.'}
        </p>
        {state.url && (
          <p style={{ margin: 0 }}>
            <a href={state.url} target="_blank" rel="noopener noreferrer">
              Nutzungsbedingungen lesen{state.version ? ` (Fassung ${state.version})` : ''}
            </a>
          </p>
        )}
        <label className="acc-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-testid="terms-gate-check" />
          <span>Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.</span>
        </label>
        <p className="acc-hint" style={{ margin: 0 }}>
          Du möchtest nicht zustimmen? Dann kannst du dich abmelden oder <a href={appHref('?konto=1')}>dein Konto löschen</a>.
        </p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLogout}>
            Abmelden
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={accept} data-testid="terms-gate-accept" data-autofocus>
            {busy ? 'Speichere …' : 'Zustimmen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
