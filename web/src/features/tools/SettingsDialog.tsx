// Dialog „Board-Einstellungen“: Hintergrund (Muster, Farbe) und Autor:in an Haftnotizen für alle, Einrasten am Raster
// nur für mich.
import { Modal } from '../../ui/Modal';
import type { EditorApi } from '../../editor/ext/types';
import { setPrefs, usePrefs } from './prefs';
import { BG_COLORS, BG_NAMES, isDark, PATTERN_LABELS, PATTERNS, useBoardSettings, writeSettings, type Pattern } from './settings';

function PatternPreview({ pattern, color }: { pattern: Pattern; color: string }) {
  const ink = isDark(color) ? 'rgba(255,255,255,0.35)' : 'rgba(10,10,10,0.28)';
  const line = isDark(color) ? 'rgba(255,255,255,0.14)' : 'rgba(10,10,10,0.12)';
  const image =
    pattern === 'dots'
      ? `radial-gradient(circle at 1.5px 1.5px, ${ink} 1.4px, transparent 2px)`
      : pattern === 'lines'
        ? `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`
        : 'none';
  return <span className="tools-settings__preview" style={{ backgroundColor: color, backgroundImage: image, backgroundSize: '12px 12px' }} aria-hidden="true" />;
}

export function SettingsDialog({ api, onClose }: { api: EditorApi; props: unknown; onClose: () => void }) {
  const s = useBoardSettings(api);
  const prefs = usePrefs();
  return (
    <Modal title="Board-Einstellungen" onClose={onClose} labelledBy="tools-settings-title">
      <div className="tools-settings" data-testid="settings-dialog">
        <section>
          <h3 className="tools-settings__h">Hintergrund</h3>
          <p className="tools-settings__note">Gilt für alle auf diesem Board.</p>
          <div className="tools-settings__patterns" role="radiogroup" aria-label="Muster">
            {PATTERNS.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={s.pattern === p}
                className={`tools-settings__pattern${s.pattern === p ? ' is-active' : ''}`}
                onClick={() => writeSettings(api, { pattern: p })}
                data-autofocus={s.pattern === p || undefined}
              >
                <PatternPreview pattern={p} color={s.color} />
                <span>{PATTERN_LABELS[p]}</span>
              </button>
            ))}
          </div>
          <h3 className="tools-settings__h tools-settings__h--sub">Farbe</h3>
          <div className="tools-settings__colors" role="radiogroup" aria-label="Farbe">
            {BG_COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={s.color === c}
                aria-label={`Farbe ${BG_NAMES[c] ?? c}`}
                title={BG_NAMES[c]}
                className={`tools-settings__swatch${s.color === c ? ' is-active' : ''}`}
                style={{ background: c }}
                onClick={() => writeSettings(api, { color: c })}
              />
            ))}
          </div>
        </section>
        <section>
          <h3 className="tools-settings__h">Haftnotizen</h3>
          <label className="tools-check tools-check--switch">
            <input type="checkbox" checked={s.authors} onChange={(e) => writeSettings(api, { authors: e.target.checked })} data-testid="settings-authors" />
            <span>
              Autor:in an Haftnotizen zeigen
              <small>Gilt für alle. Der Name steht klein unten an jeder Notiz.</small>
            </span>
          </label>
        </section>
        <section>
          <h3 className="tools-settings__h">Raster</h3>
          <label className="tools-check tools-check--switch">
            <input type="checkbox" checked={prefs.snap} onChange={(e) => setPrefs({ snap: e.target.checked })} />
            <span>
              Am Raster einrasten
              <small>Nur für dich. Beim Ziehen landen Objekte auf dem 24er-Raster.</small>
            </span>
          </label>
        </section>
        <div className="modal-actions tools-settings__actions">
          <button className="btn btn--primary btn--sm" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Modal>
  );
}
