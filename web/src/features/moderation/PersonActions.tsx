// „Person melden …“ und „Blockieren“/„Blockierung aufheben“ für eine Person in Listen (Anwesende, Teilen-Dialog).
// Blockieren: Einladungen und @Erwähnungen dieser Person erreichen mich nicht mehr; sie erfährt davon nichts.
import { useState } from 'react';
import { errorText } from '../../api';
import { ConfirmDialog } from '../../ui/Modal';
import { ReportDialog } from './ReportDialog';
import { blockPerson, unblockPerson, useBlocked } from './useBlocked';

export const blockConfirmText = (name: string) =>
  `Einladungen und @Erwähnungen von ${name} erreichen dich dann nicht mehr. ${name} erfährt davon nichts. Du kannst das in deinem Konto jederzeit aufheben.`;

/** Menü-artige Knöpfe; `onError` zeigt Fehler (z. B. als Toast) */
export function PersonActions({ person, boardId, me, onError }: { person: { key: string; name: string }; boardId: string | null; me: string; onError?: (msg: string) => void }) {
  const blocked = useBlocked().some((b) => b.key === person.key);
  const [dialog, setDialog] = useState<'report' | 'block' | null>(null);
  const [busy, setBusy] = useState(false);
  if (person.key === me) return null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError?.(errorText(e));
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };
  return (
    <span className="mod-person-actions">
      {boardId && (
        <button className="collab-link mod-link" onClick={() => setDialog('report')} aria-label={`${person.name} melden`} data-testid="person-report">
          Melden …
        </button>
      )}
      <button
        className="collab-link mod-link"
        disabled={busy}
        onClick={() => (blocked ? void run(() => unblockPerson(person.key)) : setDialog('block'))}
        aria-label={blocked ? `Blockierung von ${person.name} aufheben` : `${person.name} blockieren`}
        data-testid="person-block"
      >
        {blocked ? 'Blockierung aufheben' : 'Blockieren'}
      </button>
      {dialog === 'report' && boardId && <ReportDialog target={{ kind: 'person', boardId, userKey: person.key, name: person.name }} me={me} onClose={() => setDialog(null)} />}
      {dialog === 'block' && (
        <ConfirmDialog
          title={`${person.name} blockieren?`}
          text={blockConfirmText(person.name)}
          confirmLabel="Blockieren"
          danger
          busy={busy}
          onConfirm={() => void run(() => blockPerson(person.key))}
          onCancel={() => setDialog(null)}
        />
      )}
    </span>
  );
}
