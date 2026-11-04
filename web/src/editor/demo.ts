// Demo-Inhalt für den Offline-Modus (?offline=1&demo=1) und Lasttests.
import { STICKY_COLORS } from '../protocol';
import type { BoardStore, NewObject } from '../board/store';
import { penFromPoints } from '../board/pen';

export function seedDemo(store: BoardStore) {
  if (store.get('demo-f1')) return;
  const sticky = (id: string, x: number, y: number, color: string, text: string): NewObject => ({ id, type: 'sticky', x, y, w: 200, h: 200, color, text });
  const circle = Array.from({ length: 42 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2 - 0.4;
    return { x: 1540 + Math.cos(a) * (136 + Math.sin(i * 0.7) * 5), y: 400 + Math.sin(a) * (128 + Math.cos(i * 0.5) * 5) };
  });
  const objs: NewObject[] = [
    { id: 'demo-f1', type: 'frame', x: 0, y: 0, w: 1100, h: 600, title: 'Sommerfest · Ablauf', color: '#ffffff' },
    { id: 'demo-f2', type: 'frame', x: 1180, y: 0, w: 700, h: 600, title: 'Ideen-Pool', color: '#ffffff' },
    { id: 'demo-t1', type: 'text', x: 0, y: -210, w: 900, h: 70, fontSize: 64, text: 'SOMMERFEST – ORGA', color: '#0a0a0a' },
    { id: 'demo-t2', type: 'text', x: 4, y: -132, w: 900, h: 30, fontSize: 22, text: 'Stand nach dem Orga-Treffen vom 21.10. – bitte ergänzen!', color: '#6b6b66' },
    { id: 'demo-a', type: 'shape', shape: 'rect', x: 60, y: 90, w: 200, h: 110, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'Aufbau Do + Fr', fontSize: 22 },
    { id: 'demo-b', type: 'shape', shape: 'diamond', x: 320, y: 65, w: 210, h: 160, color: '#c9e14a', stroke: '#0a0a0a', strokeWidth: 2, text: 'Strom ok?', fontSize: 22 },
    { id: 'demo-c', type: 'shape', shape: 'ellipse', x: 590, y: 90, w: 200, h: 110, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'Einlass 14 Uhr', fontSize: 22 },
    { id: 'demo-d', type: 'shape', shape: 'rect', x: 860, y: 90, w: 190, h: 110, color: '#0a0a0a', stroke: '#0a0a0a', strokeWidth: 2, text: 'Bühne & Bar', fontSize: 22 },
    { id: 'demo-c1', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'demo-a' }, to: { objectId: 'demo-b' }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true },
    { id: 'demo-c2', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'demo-b' }, to: { objectId: 'demo-c' }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true },
    { id: 'demo-c3', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'demo-c' }, to: { objectId: 'demo-d' }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true },
    sticky('demo-s1', 60, 300, '#fff27a', 'Bühnenplan bis 15.11. an die Technik'),
    sticky('demo-s2', 320, 320, '#ffb3d1', 'Bierwagen: zweiten Anbieter anfragen'),
    sticky('demo-s3', 580, 300, '#c9e14a', 'Awareness-Team Schichtplan'),
    sticky('demo-s4', 840, 320, '#9fd3ff', 'Shuttle vom Bahnhof?'),
    { id: 'demo-c4', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'demo-s4' }, to: { objectId: 'demo-d' }, color: '#ec4e92', strokeWidth: 2, arrowEnd: true },
    sticky('demo-i1', 1220, 60, '#ffd08a', 'Kakteen-Lounge mit Hängematten'),
    sticky('demo-i2', 1440, 60, '#e2d5ff', 'Pfand-Becher mit Stachel-Logo'),
    sticky('demo-i3', 1660, 60, '#ffffff', 'Silent Disco ab 1 Uhr'),
    sticky('demo-i4', 1220, 300, '#c9e14a', 'Kinder-Workshop: Upcycling'),
    sticky('demo-i5', 1440, 300, '#fff27a', 'DJ-Set zum Sonnenaufgang am Sonntag'),
    { id: 'demo-p1', type: 'pen', ...penFromPoints(circle, 4), color: '#ec4e92', strokeWidth: 4 },
  ];
  store.createMany(objs);
  store.undoManager.clear();
}

/** Viele Haftnotizen im Raster (Lasttest). */
export function seedMany(store: BoardStore, n: number) {
  const cols = Math.ceil(Math.sqrt(n));
  const list: NewObject[] = [];
  for (let i = 0; i < n; i++) {
    list.push({
      type: 'sticky',
      x: (i % cols) * 240,
      y: Math.floor(i / cols) * 240,
      w: 200,
      h: 200,
      color: STICKY_COLORS[i % STICKY_COLORS.length],
      text: `Notiz ${i + 1}`,
    });
  }
  store.createMany(list);
  store.undoManager.clear();
}
