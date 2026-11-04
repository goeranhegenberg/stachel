// Feature-Modul „versions“: Versionsverlauf – Seitenleiste mit allen Versionen (nach Tagen), Vorschau einer
// Version schreibgeschützt auf der Leinwand, wiederherstellen (für alle), als Kopie öffnen, Version speichern/benennen.
// Vertrag: docs/features/versions.md, Server: server/src/versions.ts (docs/contract.md §3 „Versionen“).
import { defineMenuItem, defineShortcut, defineSidebarTab, defineSlot } from '../../editor/ext/registry';
import { currentBoardId } from './actions';
import { IconHistory } from './icons';
import { VersionsLayer } from './PreviewLayer';
import { SIDEBAR_ID } from './state';
import { VersionsPanel } from './VersionsPanel';
import './versions.css';

defineSidebarTab({ id: SIDEBAR_ID, title: 'Versionsverlauf', order: 60, Icon: IconHistory, Panel: VersionsPanel });

defineSlot({ id: 'versions.layer', slot: 'overlay', order: 90, Component: VersionsLayer });

defineMenuItem({
  id: 'versions.history',
  on: 'board',
  order: 36,
  item: (api) => (currentBoardId() ? { label: 'Versionsverlauf', shortcut: 'Strg Alt H', onSelect: () => api.openSidebar(SIDEBAR_ID) } : null),
});

defineShortcut({
  id: 'versions.history',
  keys: ['mod+alt+h', 'mod+alt+KeyH'],
  run: (api) => {
    if (!currentBoardId()) return false;
    api.openSidebar(api.sidebar() === SIDEBAR_ID ? null : SIDEBAR_ID);
  },
  help: { group: 'Ansicht', keys: 'Strg Alt H', label: 'Versionsverlauf', order: 95 },
});
