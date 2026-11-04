// Status einer Karte (Bezeichnung, Farbe).
import type { CardStatus } from '../model';

export const STATUSES: { s: CardStatus; label: string; color: string }[] = [
  { s: 'todo', label: 'Offen', color: '#8a8a85' },
  { s: 'doing', label: 'In Arbeit', color: '#1763b5' },
  { s: 'blocked', label: 'Blockiert', color: '#ec4e92' },
  { s: 'done', label: 'Erledigt', color: '#7aa21b' },
];
export const statusOf = (s: CardStatus | undefined) => STATUSES.find((x) => x.s === s);
