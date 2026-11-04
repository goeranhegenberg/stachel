// Dialog „Exportieren“: Format (PNG/PDF), Bereich (Board, Auswahl, Rahmen, alle Rahmen), Qualität.
import { useMemo, useState } from 'react';
import { Modal } from '../../../ui/Modal';
import { framesInOrder } from '../../../editor/interaction/Frames';
import type { EditorApi } from '../../../editor/ext/types';
import { downloadBlob } from '../util';
import { IconImageFile, IconPdf } from '../icons';
import { clampScale } from './render';
import { exportPages, runExport, type ExportArea, type ExportFormat } from './exporter';

export interface ExportDialogProps {
  format?: ExportFormat;
  area?: ExportArea;
}

const QUALITIES = [
  { q: 1, label: 'Normal' },
  { q: 2, label: 'Scharf' },
  { q: 3, label: 'Druck' },
];

const fmtNum = new Intl.NumberFormat('de-DE');

export function ExportDialog({ api, props, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const init = (props ?? {}) as ExportDialogProps;
  const snap = api.snapshot();
  const selection = api.selection();
  const frames = useMemo(() => framesInOrder(snap.ordered.filter((o) => !o.hidden)), [snap]);
  const [format, setFormat] = useState<ExportFormat>(init.format ?? 'png');
  const [kind, setKind] = useState<ExportArea['kind']>(init.area?.kind ?? (selection.length ? 'selection' : 'board'));
  const [frameId, setFrameId] = useState(init.area?.kind === 'frame' ? init.area.id : (frames[0]?.id ?? ''));
  const [quality, setQuality] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effKind = format === 'png' && kind === 'frames' ? 'frame' : kind;
  const area: ExportArea = effKind === 'frame' ? { kind: 'frame', id: frameId } : effKind === 'frames' ? { kind: 'frames' } : { kind: effKind };
  const pages = useMemo(() => exportPages(snap, selection, area, (o) => api.bounds(o)), [snap, selection, area.kind, frameId, api]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = (() => {
    if (!pages.length) return 'Hier gibt es nichts zu exportieren.';
    if (format === 'pdf') return pages.length === 1 ? '1 Seite' : `${pages.length} Seiten`;
    const r = pages[0].rect;
    const s = clampScale(r, quality);
    return `${fmtNum.format(Math.round(r.w * s))} × ${fmtNum.format(Math.round(r.h * s))} Pixel`;
  })();

  const start = async () => {
    setError(null);
    setBusy('Wird erstellt …');
    try {
      const res = await runExport(api, { format, area, quality, transparent: format === 'png' && transparent }, (done, total) => {
        if (total > 1) setBusy(`Seite ${Math.min(done + 1, total)} von ${total} …`);
      });
      if (!res) {
        setError('Hier gibt es nichts zu exportieren.');
        setBusy(null);
        return;
      }
      downloadBlob(res.blob, res.name);
      api.toast(`Gespeichert: ${res.name}`);
      onClose();
    } catch (e) {
      console.error(e);
      setError('Der Export hat nicht geklappt. Versuch es mit geringerer Qualität noch einmal.');
      setBusy(null);
    }
  };

  const radio = (k: ExportArea['kind'], label: string, sub: string | null, disabled = false, extra?: React.ReactNode) => (
    <label className={`tools-export__opt${effKind === k ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input type="radio" name="tools-export-area" checked={effKind === k} disabled={disabled} onChange={() => setKind(k)} />
      <span className="tools-export__opt-text">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
      {extra}
    </label>
  );

  return (
    <Modal title="Exportieren" onClose={onClose} labelledBy="tools-export-title">
      <div className="tools-export" data-testid="export-dialog">
        <div className="tools-export__formats" role="radiogroup" aria-label="Format">
          {(
            [
              ['png', 'PNG', 'Bild', <IconImageFile key="i" size={26} />],
              ['pdf', 'PDF', 'Dokument', <IconPdf key="p" size={26} />],
            ] as const
          ).map(([f, label, sub, icon]) => (
            <button key={f} role="radio" aria-checked={format === f} className={`tools-export__format${format === f ? ' is-active' : ''}`} onClick={() => setFormat(f)} data-autofocus={format === f || undefined}>
              {icon}
              <span>
                <b>{label}</b>
                <small>{sub}</small>
              </span>
            </button>
          ))}
        </div>

        <fieldset className="tools-export__area">
          <legend>Bereich</legend>
          {radio('board', 'Ganzes Board', `${snap.ordered.filter((o) => !o.hidden).length} Objekte`, !snap.ordered.length)}
          {radio('selection', 'Auswahl', selection.length ? `${selection.length} ausgewählt` : 'Nichts ausgewählt', !selection.length)}
          {radio(
            'frame',
            'Rahmen',
            frames.length ? null : 'Noch keine Rahmen',
            !frames.length,
            frames.length > 0 && (
              <select
                className="tools-export__select"
                aria-label="Rahmen wählen"
                value={frameId}
                onChange={(e) => {
                  setFrameId(e.target.value);
                  setKind('frame');
                }}
              >
                {frames.map((f, i) => (
                  <option key={f.id} value={f.id}>
                    {i + 1}. {f.title || 'Rahmen'}
                  </option>
                ))}
              </select>
            ),
          )}
          {format === 'pdf' && radio('frames', 'Alle Rahmen', frames.length ? `Eine Seite je Rahmen (${frames.length})` : 'Noch keine Rahmen', !frames.length)}
        </fieldset>

        <div className="tools-export__row">
          <span className="tools-export__label">Qualität</span>
          <div className="seg tools-seg" role="radiogroup" aria-label="Qualität">
            {QUALITIES.map(({ q, label }) => (
              <button key={q} role="radio" aria-checked={quality === q} className={`seg__btn${quality === q ? ' is-active' : ''}`} onClick={() => setQuality(q)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {format === 'png' && (
          <label className="tools-check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span>Durchsichtiger Hintergrund</span>
          </label>
        )}

        <p className="tools-export__info" data-testid="export-info">
          {info}
        </p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn--primary btn--sm" onClick={start} disabled={!!busy || !pages.length}>
            {busy ?? 'Exportieren'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
