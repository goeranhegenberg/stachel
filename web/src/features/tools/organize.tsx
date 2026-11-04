// Q3 „Bedienung“ im Editor: Clustern ohne KI und Typ wechseln (Menü der Auswahl), Suchen & Ersetzen (Board-Menü,
// Strg H) und die Befehlspalette (Strg K, Board-Menü). Die Logik liegt React-frei in cluster.ts, convert.ts,
// replace.ts – die App ruft dieselbe als Web-Aktion (native-organize.ts).
import { defineMenuItem, defineModal, defineShortcut } from '../../editor/ext/registry';
import type { EditorApi } from '../../editor/ext/types';
import { canCluster, clusterInStore, peopleNames, type ClusterBy } from './cluster';
import { CONVERT_LABELS, convertInStore, convertTargets } from './convert';
import { CommandPalette, PALETTE_ID } from './palette';
import { openReplace } from './search';

export const CLUSTER_LABELS: [ClusterBy, string][] = [
  ['color', 'Nach Farbe'],
  ['tag', 'Nach Tag'],
  ['author', 'Nach Autor:in'],
];

/** Clustern im Browser: Namen der Personen aus `structure.people`, den Anwesenden und mir. */
export function clusterSelection(api: EditorApi, by: ClusterBy) {
  const me = api.session.user;
  const peers = api.session.getPeers().map((p) => [p.user.key, p.user.name] as [string, string]);
  const r = clusterInStore(api.store, api.selection(), by, peopleNames(api.store, [...peers, [me.key, me.name]]));
  if (!r) return api.toast('Zum Clustern mindestens zwei bewegliche Objekte wählen.');
  api.setSelection(r.select);
}

/** Typ der Auswahl wechseln; Karten und Text-Objekte messen danach ihre Höhe (wie nach dem Bearbeiten). */
export function convertSelection(api: EditorApi, to: keyof typeof CONVERT_LABELS) {
  const done = convertInStore(api.store, api.selection(), to);
  if (!done.length) return;
  api.setSelection(done);
  api.remeasure(done);
}

defineMenuItem({
  id: 'tools.cluster',
  on: 'object',
  order: 78,
  item: (api) => {
    const sel = api.selected();
    if (!canCluster(sel, api.snapshot().ordered)) return null;
    return { label: 'Clustern', items: CLUSTER_LABELS.map(([by, label]) => ({ label, onSelect: () => clusterSelection(api, by) })) };
  },
});

defineMenuItem({
  id: 'tools.convert',
  on: 'object',
  order: 79,
  item: (api) => {
    const targets = convertTargets(api.selected());
    if (!targets.length) return null;
    return { label: 'Typ wechseln', items: targets.map((t) => ({ label: CONVERT_LABELS[t], onSelect: () => convertSelection(api, t) })) };
  },
});

// ---- Suchen & Ersetzen, Befehlspalette ------------------------------------------------------------------------------

defineMenuItem({ id: 'tools.boardReplace', on: 'board', order: 11, item: () => ({ label: 'Suchen und ersetzen', shortcut: 'Strg H', onSelect: openReplace }) });
defineMenuItem({ id: 'tools.boardPalette', on: 'board', order: 12, item: (api) => ({ label: 'Befehl suchen …', shortcut: 'Strg K', onSelect: () => api.openModal(PALETTE_ID) }) });

defineModal({ id: PALETTE_ID, Component: ({ api, onClose }) => <CommandPalette api={api} onClose={onClose} /> });

// Strg K: auf einem gewählten Text bleibt es „Link einfügen“ (richtext, kommt zuerst), sonst die Palette
defineShortcut({
  id: PALETTE_ID,
  keys: ['mod+k', 'mod+shift+k'],
  scope: 'board',
  run: (api) => api.openModal(PALETTE_ID),
  help: { group: 'Ansicht', keys: 'Strg K', label: 'Befehl suchen', order: 4 },
});
defineShortcut({
  id: 'tools.replace',
  keys: ['mod+h'],
  scope: 'board',
  run: () => openReplace(),
  help: { group: 'Ansicht', keys: 'Strg H', label: 'Suchen und ersetzen', order: 6 },
});
