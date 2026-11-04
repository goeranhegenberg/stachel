// Kürzel-Übersicht (? bzw. Strg /): Werkzeug-Tasten aus dem Werkzeug-Register, der Rest aus dem Kürzel-Register.
import { Modal } from '../../ui/Modal';
import { shortcuts, tools } from '../ext/registry';

/** Reihenfolge der Gruppen; weitere Gruppen der Feature-Module folgen danach. */
const GROUP_ORDER = ['Werkzeuge', 'Bearbeiten', 'Ansicht'];

export function shortcutGroups(): { title: string; items: [string, string][] }[] {
  const groups = new Map<string, { order: number; item: [string, string] }[]>(GROUP_ORDER.map((g) => [g, []]));
  tools.list().forEach((t, i) => {
    if (t.key) groups.get('Werkzeuge')!.push({ order: i, item: [t.key.toUpperCase(), t.hint ?? t.label] });
  });
  for (const s of shortcuts.list()) {
    if (!s.help) continue;
    if (!groups.has(s.help.group)) groups.set(s.help.group, []);
    groups.get(s.help.group)!.push({ order: s.help.order, item: [s.help.keys, s.help.label] });
  }
  return [...groups]
    .filter(([, items]) => items.length)
    .map(([title, items]) => ({ title, items: items.sort((a, b) => a.order - b.order).map((x) => x.item) }));
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Tastenkürzel" onClose={onClose} labelledBy="shortcuts-title">
      <div className="shortcuts">
        {shortcutGroups().map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map(([k, v]) => (
                <div key={k + v}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn btn--primary btn--sm" onClick={onClose} data-autofocus>
          Schließen
        </button>
      </div>
    </Modal>
  );
}
