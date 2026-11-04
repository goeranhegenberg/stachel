// „Melden …“ (Objekt, Kommentar, Board, Person): Grund wählen, kurz beschreiben, an die Betreiber:innen schicken
// (POST /api/reports, DSA Art. 16). Danach Eingangsbestätigung mit Nummer; bei Personen gleich „Blockieren“ anbieten.
import { useState } from 'react';
import { errorText } from '../../api';
import { useInstance } from '../../instance';
import { Modal } from '../../ui/Modal';
import {
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  REPORT_TEXT_MAX,
  REPORT_TEXT_MIN,
  REPORT_TEXT_REQUIRED,
  type ReportInput,
  type ReportReason,
} from '../../../../shared/moderation';
import { moderationApi } from './api';
import { isBlocked } from './blocked';
import { blockPerson } from './useBlocked';

export interface ReportTarget {
  kind: 'object' | 'comment' | 'board' | 'person';
  boardId: string;
  objectId?: string;
  commentId?: string;
  messageId?: string;
  /** gemeldete Person bzw. Autor:in des Kommentars (für „Außerdem blockieren“) */
  userKey?: string;
  name?: string;
}

const TITLE: Record<ReportTarget['kind'], string> = {
  object: 'Inhalt melden',
  comment: 'Kommentar melden',
  board: 'Board melden',
  person: 'Person melden',
};

/** Fehlertext für die Eingaben, null = darf abgeschickt werden */
export function reportProblem(reason: ReportReason | null, text: string): string | null {
  if (!reason) return 'Bitte wähle einen Grund.';
  const t = text.trim();
  if (t.length > REPORT_TEXT_MAX) return `Höchstens ${REPORT_TEXT_MAX} Zeichen.`;
  if (REPORT_TEXT_REQUIRED.includes(reason) && t.length < REPORT_TEXT_MIN) return 'Bitte beschreibe kurz, was nicht in Ordnung ist (mindestens 10 Zeichen).';
  return null;
}

/** Body für POST /api/reports */
export function reportInput(target: ReportTarget, reason: ReportReason, text: string): ReportInput {
  return {
    boardId: target.boardId,
    ...(target.kind === 'object' && target.objectId ? { objectId: target.objectId } : {}),
    ...(target.kind === 'comment' && target.commentId ? { commentId: target.commentId, ...(target.messageId ? { messageId: target.messageId } : {}) } : {}),
    ...(target.kind === 'person' && target.userKey ? { userKey: target.userKey } : {}),
    reason,
    ...(text.trim() ? { text: text.trim() } : {}),
  };
}

export function ReportDialog({ target, me, onClose }: { target: ReportTarget; me?: string; onClose: () => void }) {
  const inst = useInstance();
  const brand = inst?.brand ?? 'Stachel';
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; mailed: boolean } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const problem = reportProblem(reason, text);
  const canBlock = !!target.userKey && target.userKey !== me && (target.kind === 'person' || target.kind === 'comment');

  const send = async () => {
    if (problem || !reason) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await moderationApi.report(reportInput(target, reason, text));
      setDone({ id: r.report.id, mailed: r.mailed });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title="Danke für deine Meldung" onClose={onClose}>
        <p data-testid="report-done">
          Deine Meldung ist eingegangen (Nummer <strong>{done.id}</strong>). Ein Mensch prüft sie
          {done.mailed ? '; eine Bestätigung und später die Entscheidung bekommst du per Mail.' : '.'}
        </p>
        {canBlock && !isBlocked(target.userKey!) && (
          <p>
            {blocked ? (
              <span data-testid="report-blocked">{target.name ?? 'Die Person'} ist blockiert.</span>
            ) : (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  void blockPerson(target.userKey!).then(
                    () => setBlocked(true),
                    (e) => setError(errorText(e)),
                  );
                }}
              >
                {target.name ?? 'Person'} außerdem blockieren
              </button>
            )}
          </p>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn--primary btn--sm" onClick={onClose} data-autofocus>
            Schließen
          </button>
        </div>
      </Modal>
    );
  }

  const textRequired = !!reason && REPORT_TEXT_REQUIRED.includes(reason);
  return (
    <Modal title={target.kind === 'person' && target.name ? `${target.name} melden` : TITLE[target.kind]} onClose={onClose}>
      <form
        className="mod-report"
        data-testid="report-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <fieldset className="mod-reasons">
          <legend>Was ist nicht in Ordnung?</legend>
          {REPORT_REASONS.map((r, i) => (
            <label key={r} className="mod-reason">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} {...(i === 0 ? { 'data-autofocus': true } : {})} />
              {REPORT_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="mod-text">{textRequired ? 'Beschreibung (nötig)' : 'Beschreibung (freiwillig)'}</label>
          <textarea
            id="mod-text"
            className="input mod-text"
            rows={4}
            maxLength={REPORT_TEXT_MAX}
            value={text}
            placeholder={reason === 'illegal' ? 'Welches Gesetz bzw. welches Recht wird verletzt, und warum?' : 'Was genau ist das Problem?'}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <p className="mod-note">
          Die Meldung geht an die Betreiber:innen von {brand}. Ein Mensch prüft sie und entscheidet; wer gemeldet wird, erfährt
          nicht, von wem. Bitte melde nur, was wirklich nicht in Ordnung ist – Missbrauch kann zur Sperre führen.
        </p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !!problem} data-testid="report-send">
            {busy ? 'Wird gesendet …' : 'Melden'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
