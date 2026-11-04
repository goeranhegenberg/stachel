// Seitenleiste „Versionsverlauf“: Versionen nach Tagen, Klick zeigt die Version schreibgeschützt auf der Leinwand.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { BoardVersionInfo } from '../../protocol';
import { errorText } from '../../api';
import { initials, userColor } from '../../board/colors';
import type { SlotProps } from '../../editor/ext/types';
import { copyVersion, currentBoardId, renameVersion, saveVersion } from './actions';
import { describe, groupByDay, objectsLabel, peopleOf, timeLabel } from './format';
import { closePreview, confirmRestore, lists, loading, openPreview, preview, reloadList } from './state';

const REFRESH_MS = 30_000;

export function VersionsPanel({ api }: SlotProps & { onClose: () => void }) {
  const boardId = currentBoardId();
  const all = useSyncExternalStore(lists.subscribe, lists.get);
  const pv = useSyncExternalStore(preview.subscribe, preview.get);
  const busyId = useSyncExternalStore(loading.subscribe, loading.get);
  const [error, setError] = useState('');
  const list = boardId ? all.get(boardId) : undefined;
  const selected = pv && pv.boardId === boardId ? pv.version.id : null;

  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    const load = () =>
      reloadList(boardId)
        .then(() => alive && setError(''))
        .catch((e) => alive && setError(errorText(e)));
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [boardId]);

  if (!boardId) return <p className="versions-empty">Im Offline-Modus gibt es keinen Versionsverlauf.</p>;

  const pick = async (v: BoardVersionInfo) => {
    if (selected === v.id) return;
    const narrow = api.viewSize().w < 700;
    try {
      // am Handy die Leinwand freigeben, die Liste holt der Vorschau-Balken zurück
      await openPreview(api, boardId, v, { keepSidebar: !narrow });
    } catch (e) {
      api.toast(errorText(e));
    }
  };

  const groups = list ? groupByDay(list) : [];
  return (
    <div className="versions-panel" data-testid="versions-panel">
      <SaveVersion onSave={(name) => saveVersion(api, boardId, name)} />
      <button
        className={`versions-item versions-current${selected ? '' : ' is-active'}`}
        aria-current={selected ? undefined : 'true'}
        data-testid="versions-current"
        onClick={() => selected && closePreview(api, { keepSidebar: true })}
      >
        <span className="versions-item__time">Aktueller Stand</span>
        <span className="versions-item__desc">Live – so sehen alle das Board gerade</span>
      </button>
      {error && (
        <p className="versions-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="versions-empty">Lädt …</p>}
      {list && list.length === 0 && (
        <p className="versions-empty">
          Noch keine Versionen. Stachel sichert automatisch alle paar Minuten, während ihr arbeitet, und wenn alle das Board
          verlassen. Mit „Version speichern“ hältst du einen Stand mit Namen fest.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="versions-day" aria-label={g.label}>
          <h3 className="versions-day__label">{g.label}</h3>
          {g.items.map((v) => (
            <VersionItem
              key={v.id}
              v={v}
              selected={selected === v.id}
              busy={busyId === v.id}
              onPick={() => void pick(v)}
              onRestore={() => confirmRestore.set(v)}
              onCopy={() => void copyVersion(api, boardId, v)}
              onRename={(name) => renameVersion(api, boardId, v, name)}
            />
          ))}
        </section>
      ))}
      {list && list.length > 0 && (
        <p className="versions-note">
          Ältere Versionen werden ausgedünnt (nach einem Tag eine je Stunde, nach 30 Tagen eine je Tag). Benannte Versionen bleiben.
        </p>
      )}
    </div>
  );
}

function SaveVersion({ onSave }: { onSave: (name: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button className="btn btn--green btn--sm versions-save" onClick={() => setOpen(true)}>
        Version speichern
      </button>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const ok = await onSave(n);
    setBusy(false);
    if (ok) {
      setOpen(false);
      setName('');
    }
  };
  return (
    <form className="versions-form" onSubmit={submit}>
      <input
        className="versions-input"
        autoFocus
        value={name}
        maxLength={120}
        placeholder="Name, z. B. Stand vor dem Orga-Treffen"
        aria-label="Name der Version"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}
      />
      <div className="versions-form__actions">
        <button type="button" className="btn btn--sm versions-ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--green btn--sm" disabled={!name.trim() || busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}

function Avatars({ v }: { v: BoardVersionInfo }) {
  const people = peopleOf(v);
  if (!people.length) return null;
  const shown = people.slice(0, 3);
  return (
    <span className="versions-avatars" aria-label={people.map((p) => p.name).join(', ')}>
      {shown.map((p) => (
        <span key={p.key} className="versions-av" style={{ background: userColor(p.key) }} title={p.name}>
          {initials(p.name)}
        </span>
      ))}
      {people.length > shown.length && <span className="versions-av versions-av--more">+{people.length - shown.length}</span>}
    </span>
  );
}

function VersionItem(p: {
  v: BoardVersionInfo;
  selected: boolean;
  busy: boolean;
  onPick: () => void;
  onRestore: () => void;
  onCopy: () => void;
  onRename: (name: string) => Promise<boolean>;
}) {
  const { v } = p;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(v.name ?? '');
  useEffect(() => setName(v.name ?? ''), [v.name]);
  const time = timeLabel(new Date(v.createdAt));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await p.onRename(name.trim())) setNaming(false);
  };
  return (
    <div className={`versions-entry${p.selected ? ' is-selected' : ''}`} data-testid="version" data-kind={v.kind}>
      <button className="versions-item" aria-current={p.selected ? 'true' : undefined} aria-busy={p.busy || undefined} onClick={p.onPick}>
        <span className="versions-item__row">
          <span className="versions-item__time">{time}</span>
          {v.name && <span className="versions-item__name">{v.name}</span>}
          <Avatars v={v} />
        </span>
        <span className="versions-item__desc">
          {describe(v)} · {objectsLabel(v.objects)}
          {p.busy ? ' · lädt …' : ''}
        </span>
      </button>
      {p.selected && (
        <div className="versions-actions">
          {naming ? (
            <form className="versions-form" onSubmit={submit}>
              <input
                className="versions-input"
                autoFocus
                value={name}
                maxLength={120}
                placeholder="Name der Version"
                aria-label="Name der Version"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNaming(false))}
              />
              <div className="versions-form__actions">
                <button type="button" className="btn btn--sm versions-ghost" onClick={() => setNaming(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn--green btn--sm">
                  {name.trim() ? 'Benennen' : 'Name entfernen'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <button className="btn btn--green btn--sm" onClick={p.onRestore}>
                Diese Version wiederherstellen
              </button>
              <div className="versions-actions__row">
                <button className="btn btn--sm versions-ghost" onClick={p.onCopy}>
                  Als Kopie öffnen
                </button>
                <button className="btn btn--sm versions-ghost" onClick={() => setNaming(true)}>
                  {v.name ? 'Umbenennen' : 'Version benennen'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
