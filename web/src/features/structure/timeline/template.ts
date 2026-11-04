// Vorlage „Eventplanung-Zeitleiste“: zwölf Wochen bis zum Festival, Spuren für Orga, Programm, Werbung, Technik und
// Aufbau, Termine relativ zu heute.
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../../protocol';
import { TemplateBuilder } from '../templates/build';
import { fmtDay, mondayOf, todayNum, type TimelineData, type TlItem } from './model';
import { newTimeline } from './create';

type Spec = [lane: string, title: string, from: number, to: number | null, color?: string];

export function eventTimeline(today = todayNum()): BoardObject[] {
  const b = new TemplateBuilder();
  const start = mondayOf(today);
  const end = start + 12 * 7 - 1;
  const lanes: [string, string, string][] = [
    ['orga', 'Orga', '#c9e14a'],
    ['prog', 'Programm', '#ec4e92'],
    ['ads', 'Werbung', '#9fd3ff'],
    ['tech', 'Technik', '#e2d5ff'],
    ['build', 'Aufbau & Abbau', '#ffd08a'],
  ];
  const color = Object.fromEntries(lanes.map(([id, , c]) => [id, c]));
  // Tage ab dem Montag dieser Woche; `to` null = Meilenstein
  const specs: Spec[] = [
    ['orga', 'Genehmigung beantragen', 0, 13],
    ['orga', 'Finanzplan', 7, 20],
    ['orga', 'Helfer-Schichten planen', 28, 48],
    ['orga', 'Helfer-Briefing', 73, null, '#0a0a0a'],
    ['prog', 'Bands anfragen', 0, 27],
    ['prog', 'Line-up steht', 28, null, '#0a0a0a'],
    ['prog', 'Workshops planen', 35, 55],
    ['ads', 'Plakate gestalten', 14, 27],
    ['ads', 'Plakate drucken & hängen', 28, 41],
    ['ads', 'Social-Media-Countdown', 49, 76],
    ['tech', 'Strom & Licht klären', 21, 34],
    ['tech', 'Technik-Probe', 70, null, '#0a0a0a'],
    ['build', 'Aufbau', 74, 76],
    ['build', 'Festival!', 77, null, '#ec4e92'],
    ['build', 'Abbau', 79, 80],
  ];
  const items: Record<string, TlItem> = {};
  for (const [lane, title, from, to, c] of specs) {
    items[nanoid(8)] = { lane, title, start: fmtDay(start + from), end: fmtDay(start + (to ?? from)), color: c ?? color[lane], ...(to === null ? { ms: true } : {}) };
  }
  const data: TimelineData = { lanes: lanes.map(([id]) => id), names: Object.fromEntries(lanes.map(([id, n]) => [id, n])), items };
  b.text(0, -96, 'Eventplanung', 56, { bold: true });
  b.text(4, -30, 'Einträge ziehen verschiebt sie, Enden ziehen ändert die Dauer. Doppelklick in eine Spur legt einen neuen an.', 18, { color: '#6b6b66' });
  const t = newTimeline({ x: 0, y: 0 }, { unit: 'week', data, start, end });
  b.objects.push({ ...t, x: 0, y: 0, id: nanoid(), z: '', createdBy: '', updatedAt: '' } as BoardObject);
  return b.objects;
}
