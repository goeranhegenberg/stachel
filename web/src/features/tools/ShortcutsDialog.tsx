// Kürzel-Übersicht (? bzw. Strg /), ausgebaut: Filterfeld, Tasten als einzelne Kappen, scrollt bei vielen Einträgen.
// Ersetzt den Kern-Dialog 'shortcuts' (gleiche id); die Einträge kommen weiter aus Werkzeug- und Kürzel-Register.
import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal } from '../../ui/Modal';
import { IconSearch } from '../../ui/icons';
import { shortcutGroups } from '../../editor/interaction/Shortcuts';
import { findMatch } from '../../ui/search';
import { getWheelMode, setWheelMode, subscribeWheelMode, type WheelMode } from '../../editor/interaction/wheel';

/** „Strg Umschalt G / Strg Y“ → [['Strg','Umschalt','G'], ['Strg','Y']]; „Leertaste + Ziehen“ bleibt ein Text. */
export function keyCaps(keys: string): string[][] {
  return keys.split(' / ').map((alt) => {
    const parts = alt.split(/ \+ /);
    return parts.flatMap((p, i) => {
      const caps = /^(Strg|Umschalt|Alt|Leertaste|Rechtsklick|Bild|Enter|Tab|Entf|Esc|Pos1|Ende)\b/.test(p) || p.length <= 2 ? splitCaps(p) : [p];
      return i < parts.length - 1 ? [...caps, '+'] : caps;
    });
  });
}

function splitCaps(p: string): string[] {
  const out: string[] = [];
  for (const tok of p.split(' ')) {
    // „Bild ↑“ ist eine Taste
    if ((tok === '↑' || tok === '↓') && out.length && out[out.length - 1] === 'Bild') out[out.length - 1] += ` ${tok}`;
    else if (tok) out.push(tok);
  }
  return out;
}

const WORDS = new Set(['Ziehen', 'Rad', 'Tippen', 'beim']);

/** Tastenkappen einer Variante zu Segmenten: zusammenhängende Tasten in einer Kappe („Strg Umschalt G“), dazu „+“ und Wörter. */
function segments(caps: string[]): { kind: 'keys' | 'plus' | 'word'; text: string }[] {
  const out: { kind: 'keys' | 'plus' | 'word'; text: string }[] = [];
  for (const c of caps) {
    const kind = c === '+' ? 'plus' : WORDS.has(c) ? 'word' : 'keys';
    const last = out[out.length - 1];
    if (kind === 'keys' && last?.kind === 'keys') last.text += ` ${c}`;
    else out.push({ kind, text: c });
  }
  return out;
}

/** Einstellung „Mausrad: Zoomen / Schwenken“ (gilt nur für Mausräder; Trackpad schwenkt, Strg+Rad zoomt immer). */
function WheelSwitch() {
  const mode = useSyncExternalStore(subscribeWheelMode, getWheelMode);
  const opt = (m: WheelMode, label: string) => (
    <button type="button" role="radio" aria-checked={mode === m} className={`tools-wheel__opt${mode === m ? ' is-active' : ''}`} onClick={() => setWheelMode(m)}>
      {label}
    </button>
  );
  return (
    <div className="tools-wheel" role="radiogroup" aria-label="Mausrad">
      <span className="tools-wheel__label">Mausrad</span>
      {opt('zoom', 'Zoomen')}
      {opt('pan', 'Schwenken')}
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const all = shortcutGroups();
    const query = q.trim();
    if (!query) return all;
    return all
      .map((g) => ({ ...g, items: g.items.filter(([k, label]) => findMatch(label, query) || findMatch(k, query) || findMatch(g.title, query)) }))
      .filter((g) => g.items.length);
  }, [q]);
  return (
    <Modal title="Tastenkürzel" onClose={onClose} labelledBy="shortcuts-title">
      <label className="tools-keys__search">
        <IconSearch size={18} />
        <input type="search" placeholder="Kürzel suchen" aria-label="Kürzel suchen" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus autoComplete="off" spellCheck={false} />
      </label>
      <div className="shortcuts tools-keys">
        {groups.length === 0 && <p className="tools-keys__none">Kein Kürzel passt zu „{q.trim()}“.</p>}
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map(([k, v]) => (
                <div key={k + v}>
                  <dt>
                    {keyCaps(k).map((alt, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="tools-keys__or">/</span>}
                        {segments(alt).map((seg, j) =>
                          seg.kind === 'keys' ? (
                            <kbd key={j}>{seg.text}</kbd>
                          ) : (
                            <span key={j} className={seg.kind === 'plus' ? 'tools-keys__plus' : 'tools-keys__word'}>
                              {seg.text}
                            </span>
                          ),
                        )}
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="modal-actions tools-keys__actions">
        <WheelSwitch />
        <button className="btn btn--primary btn--sm" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
