// Feature-Modul „sharing“ (nur Modus local, docs/features/accounts.md): Teilen-Knopf oben rechts, Rollen-Hinweis und
// Schreibschutz für „Kann ansehen“ bzw. „Kann kommentieren“ (der Server setzt das ohnehin durch, access.ts; die
// Oberfläche soll aber gar nicht erst Bearbeiten anbieten). Im Modus org und offline unsichtbar.
import { defineSlot } from '../../editor/ext/registry';
import { ShareBar } from './ShareBar';
import { ReadOnlyGuard } from './ReadOnlyGuard';
import '../../pages/account/account.css';

defineSlot({ id: 'sharing.bar', slot: 'topbarRight', order: 0, Component: ShareBar });
defineSlot({ id: 'sharing.readonly', slot: 'overlay', order: 1, Component: ReadOnlyGuard, presenting: true });
