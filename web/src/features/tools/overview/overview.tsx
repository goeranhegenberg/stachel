// Board-Übersicht (Modul tools): Vorschaubilder vom Server, Duplizieren, Vorlagen speichern und verwenden.
// Eingebaut in pages/BoardsPage.tsx (BoardThumb, BoardMenu, Neues-Board-Dialog, Vorlagen-Leiste).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { BoardInfo } from '../../../protocol';
import { ApiError, ERROR_TEXT, errorText } from '../../../api';
export { duplicateBoard } from '../boardApi';
import { Modal } from '../../../ui/Modal';
import { relativeTime } from '../../../ui/time';
import { IconCopy, IconTemplate } from '../icons';
import { IconPencilSmall as IconEdit } from '../../../ui/icons';
import './overview.css';

// ---- API (docs/contract.md §3) ---------------------------------------------------------------------------------------

/** URL des Vorschaubilds (mit Stand als Cache-Schlüssel) oder null. */
export const thumbUrl = (b: Pick<BoardInfo, 'id' | 'thumbnailAt'>) =>
  b.thumbnailAt ? `/api/boards/${encodeURIComponent(b.id)}/thumbnail?v=${encodeURIComponent(b.thumbnailAt)}` : null;

/** Neue Vorschaubilder aus dem Editor (Ereignis `stachel:thumbnail`) in die Liste übernehmen. */
export function useThumbnailUpdates(update: (fn: (list: BoardInfo[] | null) => BoardInfo[] | null) => void) {
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ boardId: string; thumbnailAt: string }>).detail;
      if (d?.boardId) update((list) => list?.map((b) => (b.id === d.boardId ? { ...b, thumbnailAt: d.thumbnailAt } : b)) ?? null);
    };
    window.addEventListener('stachel:thumbnail', on);
    return () => window.removeEventListener('stachel:thumbnail', on);
  }, [update]);
}

// ---- Vorschaubild ----------------------------------------------------------------------------------------------------

/** Vorschaubild vom Server; bei Fehler (oder ohne) der bisherige Platzhalter `fallback`. */
export function ServerThumb({ board, fallback }: { board: BoardInfo; fallback: ReactNode }) {
  const url = thumbUrl(board);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <>{fallback}</>;
  return <img className="board-card__thumb board-card__thumb--img tools-thumb" src={url} alt="" loading="lazy" decoding="async" data-testid="board-thumb-server" onError={() => setFailed(url)} />;
}

// ---- Menü-Einträge der Karten ---------------------------------------------------------------------------------------

export interface CardAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export function boardActions(b: BoardInfo, run: { duplicate: () => void; saveTemplate: () => void; useTemplate: () => void; open: () => void }): CardAction[] {
  if (b.template)
    return [
      { label: 'Board daraus anlegen', icon: <IconTemplate size={18} />, onSelect: run.useTemplate },
      { label: 'Vorlage bearbeiten', icon: <IconEdit size={18} />, onSelect: run.open },
    ];
  return [
    { label: 'Duplizieren', icon: <IconCopy size={18} />, onSelect: run.duplicate },
    { label: 'Als Vorlage speichern', icon: <IconTemplate size={18} />, onSelect: run.saveTemplate },
  ];
}

// ---- Vorlagen-Leiste ---------------------------------------------------------------------------------------------------

export function TemplatesSection({ templates, onUse, menu }: { templates: BoardInfo[]; onUse: (t: BoardInfo) => void; menu: (t: BoardInfo) => ReactNode }) {
  if (!templates.length) return null;
  return (
    <section className="tools-tpl" aria-labelledby="tools-tpl-title">
      <h2 id="tools-tpl-title" className="tools-tpl__title">
        Vorlagen <span>{templates.length}</span>
      </h2>
      <ul className="tools-tpl__list">
        {templates.map((t) => (
          <li key={t.id} className="tools-tpl__card">
            <button className="tools-tpl__use" onClick={() => onUse(t)} title={`Neues Board aus „${t.title}“`}>
              <ServerThumb board={t} fallback={<span className="board-card__thumb tools-tpl__blank" aria-hidden="true" />} />
              <span className="tools-tpl__name">{t.title}</span>
              <span className="tools-tpl__meta">von {t.createdByName} · {relativeTime(t.updatedAt)}</span>
              <span className="tools-tpl__cta">Verwenden</span>
            </button>
            {menu(t)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- Neues Board (optional aus Vorlage) -------------------------------------------------------------------------------

export function NewBoardDialog({
  templates,
  initialTemplate,
  onCreate,
  onCancel,
}: {
  templates: BoardInfo[];
  initialTemplate?: BoardInfo | null;
  /** templateId null = leeres Board */
  onCreate: (title: string, templateId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [tpl, setTpl] = useState<string | null>(initialTemplate?.id ?? null);
  const [value, setValue] = useState(initialTemplate?.title ?? 'Neues Board');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = (id: string | null) => {
    setTpl(id);
    // Name folgt der Vorlage, solange niemand ihn geändert hat
    if (!touched) setValue(id ? (templates.find((t) => t.id === id)?.title ?? value) : 'Neues Board');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t) return setError('Bitte gib einen Namen ein.');
    setBusy(true);
    setError(null);
    try {
      await onCreate(t.slice(0, 120), tpl);
    } catch (err) {
      setError(err instanceof ApiError ? errorText(err) : ERROR_TEXT.server);
      setBusy(false);
    }
  };
  return (
    <Modal title={initialTemplate ? 'Board aus Vorlage' : 'Neues Board'} onClose={onCancel}>
      <form onSubmit={submit} className="title-form">
        {templates.length > 0 && (
          <div className="tools-tpl-pick" role="radiogroup" aria-label="Vorlage">
            <button type="button" role="radio" aria-checked={tpl === null} className={`tools-tpl-pick__item${tpl === null ? ' is-active' : ''}`} onClick={() => pick(null)}>
              <span className="tools-tpl-pick__thumb tools-tpl-pick__thumb--blank" aria-hidden="true">
                +
              </span>
              <span>Leeres Board</span>
            </button>
            {templates.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={tpl === t.id} className={`tools-tpl-pick__item${tpl === t.id ? ' is-active' : ''}`} onClick={() => pick(t.id)}>
                {thumbUrl(t) ? <img className="tools-tpl-pick__thumb" src={thumbUrl(t)!} alt="" /> : <span className="tools-tpl-pick__thumb" aria-hidden="true" />}
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="board-title">Name</label>
          <input
            id="board-title"
            className="input"
            value={value}
            maxLength={120}
            data-autofocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setTouched(true);
              setValue(e.target.value);
            }}
          />
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
            {busy ? 'Lege an …' : 'Anlegen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
