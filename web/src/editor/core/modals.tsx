// Kern-Dialoge (über api.openModal).
import { defineModal } from '../ext/registry';
import { ShortcutsDialog } from '../interaction/Shortcuts';

defineModal({ id: 'shortcuts', Component: ({ onClose }) => <ShortcutsDialog onClose={onClose} /> });
