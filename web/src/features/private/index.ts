// Feature-Modul „private“ (docs/features/private.md): privater Modus – verdeckt schreiben, gemeinsam aufdecken.
// Geheimhaltung macht der Server (eigene Privat-Ablage je Person); hier: Ablage einhängen, Platzhalter, Band, Dialog.
import { createElement } from 'react';
import { defineMenuItem, defineModal, defineSlot } from '../../editor/ext/registry';
import { readMode } from './route';
import { canModerate } from './model';
import { control, PrivateBar, PrivateLayer, START_MODAL, StartDialog } from './PrivateViews';
import './private.css';

defineModal({
  id: START_MODAL,
  Component: ({ api, onClose }) => createElement(StartDialog, { api, onClose }),
});

defineMenuItem({
  id: 'private.mode',
  on: 'board',
  order: 45,
  item: (api) => {
    // ohne Server (offline) gibt es keine Ablage; ansehen/kommentieren legt nichts an
    if (api.session.isLocal || !api.session.openPrivate) return null;
    const mode = readMode(api.store.doc);
    if (!mode.on)
      return {
        label: 'Privater Modus …',
        onSelect: () => api.openModal(START_MODAL),
      };
    if (!canModerate(api, mode)) return null;
    return {
      label: 'Privaten Modus aufdecken',
      onSelect: () => void control(api, { action: 'reveal', countdown: 3 }),
    };
  },
});

defineSlot({
  id: 'private.layer',
  slot: 'world',
  order: 20,
  Component: PrivateLayer,
});
defineSlot({
  id: 'private.bar',
  slot: 'overlay',
  order: 3,
  Component: PrivateBar,
});

export { privateRoute, readHidden, readMode, PRIVATE_TYPES } from './route';
