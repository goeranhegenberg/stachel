// Teilen-Dialog (Modus local, docs/features/accounts.md): Personen per E-Mail einladen (Rolle wählen),
// Rollen ändern, Zugriff entziehen, Besitz übertragen, Freigabelink an/aus. Aus Editor und Board-Übersicht nutzbar.
import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../../api';
import { initials, userColor } from '../../board/colors';
import { ConfirmDialog, Modal } from '../../ui/Modal';
import { accountApi, ROLE_NAMES, type ShareInfo, type SharePerson, type ShareRole } from '../../pages/account/accountApi';
import '../../pages/account/account.css';
import { PersonActions } from '../moderation/PersonActions';

const ROLES: ShareRole[] = ['edit', 'comment', 'view'];
const LINK_TEXT: Record<ShareRole, string> = {
  edit: 'Jeder mit dem Link (angemeldet) kann bearbeiten',
  comment: 'Jeder mit dem Link (angemeldet) kann kommentieren',
  view: 'Jeder mit dem Link (angemeldet) kann ansehen',
};

export const IconShare = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </svg>
);

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareDialog({ boardId, title: givenTitle, me, onClose, onLeft }: { boardId: string; title?: string; me: string; onClose: () => void; onLeft?: () => void }) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<ShareRole>('edit');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<SharePerson | null>(null);

  useEffect(() => {
    accountApi
      .share(boardId)
      .then(setInfo)
      .catch((e) => setError(errorText(e)));
  }, [boardId]);

  const act = async (fn: () => Promise<ShareInfo | { left: true }>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if ('left' in r) {
        onLeft?.();
        onClose();
        return;
      }
      setInfo(r);
      if (done) setNotice(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const list = emails
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return setError('Bitte mindestens eine E-Mail-Adresse eingeben.');
    void act(async () => {
      const r = await accountApi.invite(boardId, list, role);
      setEmails('');
      return r;
    }, list.length === 1 ? `${list[0]} ist eingeladen.` : `${list.length} Personen sind eingeladen.`);
  };

  const onPersonChange = (p: SharePerson, v: string) => {
    if (v === 'remove') void act(() => accountApi.remove(boardId, p.key), p.key === me ? undefined : `${p.name} hat keinen Zugriff mehr.`);
    else if (v === 'owner') setTransfer(p);
    else void act(() => accountApi.setRole(boardId, p.key, v as ShareRole));
  };

  const copyLink = async () => {
    if (info && (await copy(info.url))) setNotice('Link kopiert.');
    else if (info) setNotice(`Link: ${info.url}`);
  };

  const iAmOwner = info?.role === 'owner';
  const title = info?.title ?? givenTitle ?? 'Board';
  return (
    <>
      <Modal title={`„${title}“ teilen`} onClose={onClose}>
        <div className="share-dialog" data-testid="share-dialog">
          {info?.canManage && (
            <form className="share-add" onSubmit={invite}>
              <label className="sr-only" htmlFor="share-emails">
                E-Mail-Adressen
              </label>
              <input
                id="share-emails"
                className="input"
                type="text"
                inputMode="email"
                autoComplete="off"
                placeholder="E-Mail-Adressen, mit Komma getrennt"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                data-autofocus
              />
              <select aria-label="Rolle für die Einladung" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
              <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
                Einladen
              </button>
            </form>
          )}
          {info?.canManage && <p className="share-hint">Personen ohne Konto bekommen eine Einladung per E-Mail und sehen das Board, sobald sie sich registriert haben.</p>}
          {error && (
            <div className="alert share-err" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="acc-ok share-err" role="status" data-testid="share-notice">
              {notice}
            </div>
          )}

          {!info && !error && <p aria-busy="true">Lädt …</p>}
          {info && (
            <>
              <h3 className="share-section">Personen mit Zugriff</h3>
              <ul className="share-list" data-testid="share-people">
                {info.people.map((p) => (
                  <li key={p.key} className="share-person">
                    <span className="share-person__av" style={{ background: userColor(p.key) }} aria-hidden="true">
                      {initials(p.name)}
                    </span>
                    <span className="share-person__name">
                      <b>
                        {p.name}
                        {p.key === me ? ' (du)' : ''}
                      </b>
                      {(p.email || p.via === 'link') && <small>{[p.email, p.via === 'link' ? 'über den Link' : ''].filter(Boolean).join(' · ')}</small>}
                      {/* Person melden / blockieren (Feature-Modul moderation) */}
                      {p.key !== me && <PersonActions person={p} boardId={boardId} me={me} onError={setError} />}
                    </span>
                    {p.role === 'owner' ? (
                      <span className="share-person__role">{ROLE_NAMES.owner}</span>
                    ) : info.canManage || p.key === me ? (
                      <select className="share-role" aria-label={`Rolle von ${p.name}`} value={p.role} disabled={busy} onChange={(e) => onPersonChange(p, e.target.value)}>
                        {(info.canManage ? ROLES : [p.role as ShareRole]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_NAMES[r]}
                          </option>
                        ))}
                        {iAmOwner && p.via !== 'link' && <option value="owner">Zur Besitzer:in machen</option>}
                        <option value="remove">{p.key === me ? 'Board verlassen' : 'Zugriff entfernen'}</option>
                      </select>
                    ) : (
                      <span className="share-person__role">{ROLE_NAMES[p.role]}</span>
                    )}
                  </li>
                ))}
                {info.invites.map((i) => (
                  <li key={i.email} className="share-person">
                    <span className="share-person__av share-person__av--invite" aria-hidden="true">
                      @
                    </span>
                    <span className="share-person__name">
                      <b>{i.email}</b>
                      <small>eingeladen, noch nicht registriert</small>
                    </span>
                    <select
                      className="share-role"
                      aria-label={`Einladung an ${i.email}`}
                      value={i.role}
                      disabled={busy}
                      onChange={(e) =>
                        e.target.value === 'remove' ? void act(() => accountApi.removeInvite(boardId, i.email)) : void act(() => accountApi.invite(boardId, [i.email], e.target.value as ShareRole))
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_NAMES[r]}
                        </option>
                      ))}
                      <option value="remove">Einladung zurückziehen</option>
                    </select>
                  </li>
                ))}
              </ul>

              <h3 className="share-section">Freigabelink</h3>
              <div className="share-link">
                <div className="share-link__row">
                  {info.canManage ? (
                    <select
                      className="share-role"
                      aria-label="Freigabelink"
                      value={info.link ?? 'off'}
                      disabled={busy}
                      onChange={(e) => void act(() => accountApi.setLink(boardId, e.target.value === 'off' ? null : (e.target.value as ShareRole)))}
                      data-testid="share-link-role"
                    >
                      <option value="off">Aus – nur eingeladene Personen</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {LINK_TEXT[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{info.link ? LINK_TEXT[info.link] : 'Nur eingeladene Personen'}</span>
                  )}
                  <button className="btn btn--sm btn--ghost" type="button" onClick={() => void copyLink()}>
                    Link kopieren
                  </button>
                </div>
                <p className="share-hint">
                  {info.link
                    ? 'Wer den Link hat und angemeldet ist, kommt rein. Ausschalten sperrt alle wieder aus, die nur über den Link dabei sind.'
                    : 'Der Link funktioniert nur für Personen, die oben eingetragen sind.'}
                </p>
              </div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn--primary btn--sm" type="button" onClick={onClose}>
              Fertig
            </button>
          </div>
        </div>
      </Modal>
      {transfer && (
        <ConfirmDialog
          title={`Board an ${transfer.name} übertragen?`}
          text={`${transfer.name} wird Besitzer:in von „${title}“ und kann es dann auch löschen. Du bleibst mit „Kann bearbeiten“ dabei.`}
          confirmLabel="Übertragen"
          busy={busy}
          onCancel={() => setTransfer(null)}
          onConfirm={() => {
            const p = transfer;
            setTransfer(null);
            void act(() => accountApi.transfer(boardId, p.key), `${p.name} ist jetzt Besitzer:in.`);
          }}
        />
      )}
    </>
  );
}
