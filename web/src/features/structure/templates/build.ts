// Baukasten für Vorlagen: erzeugt fertige BoardObjects (mit vorläufigen ids; beim Einfügen bekommen sie neue).
import { nanoid } from 'nanoid';
import type { BoardObject, ConnectorEnd, ShapeKind } from '../../../protocol';
import { measureText } from '../../../editor/measureText';
import { autoTextWidth } from '../../../editor/interaction/textWidth';
import type { CardStatus, CardTag, MindSide, TableHead } from '../model';
import { layoutPatches } from '../mindmap/ops';
import { MIND_COLORS, mindSize } from '../mindmap/style';
import { tableFrom } from '../table/model';
import { newTable } from '../table/create';
import { wrapText } from '../text';

export interface MindSpec {
  text: string;
  side?: MindSide;
  children?: MindSpec[];
}

type Extra = Partial<BoardObject>;

/** Datum in `n` Tagen als `YYYY-MM-DD`. */
export function inDays(n: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Geschätzte Kartenhöhe (genau misst die Ansicht, sobald die Karte ausgewählt ist). */
export function cardHeight(w: number, title: string, desc?: string, chips = 0): number {
  const tl = wrapText(title || 'Titel', w - 40, (s) => measureText(s, 17, 600)).length;
  const dl = desc ? Math.min(4, wrapText(desc, w - 40, (s) => measureText(s, 14, 500)).length) : 0;
  return Math.ceil(28 + tl * 22.1 + (dl ? 6 + dl * 20.3 : 0) + (chips ? 12 + 24 : 0));
}

export class TemplateBuilder {
  readonly objects: BoardObject[] = [];

  private add(o: Extra & Pick<BoardObject, 'type' | 'x' | 'y' | 'w' | 'h'>): string {
    const id = nanoid();
    this.objects.push({ z: '', createdBy: '', updatedAt: '', ...o, id } as BoardObject);
    return id;
  }

  frame(x: number, y: number, w: number, h: number, title: string, extra: Extra = {}) {
    return this.add({ type: 'frame', x, y, w, h, title, color: '#ffffff', ...extra });
  }

  sticky(x: number, y: number, text: string, color = '#fff27a', size = 160) {
    return this.add({ type: 'sticky', x, y, w: size, h: size, text, color });
  }

  shape(shape: ShapeKind, x: number, y: number, w: number, h: number, text = '', extra: Extra = {}) {
    return this.add({ type: 'shape', shape, x, y, w, h, text, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, fontSize: 20, ...extra });
  }

  /** Text; ohne `w` einzeilig mit automatischer Breite. */
  text(x: number, y: number, text: string, fontSize = 24, extra: Extra & { w?: number } = {}) {
    const bold = !!extra.bold;
    if (extra.w) {
      const lines = wrapText(text, extra.w, (s) => measureText(s, fontSize, bold ? 700 : 500)).length;
      return this.add({ type: 'text', x, y, h: Math.ceil(lines * fontSize * 1.25), text, fontSize, color: '#0a0a0a', ...extra, w: extra.w });
    }
    return this.add({ type: 'text', x, y, w: autoTextWidth({ text, fontSize, bold }), h: Math.ceil(text.split('\n').length * fontSize * 1.25), text, fontSize, color: '#0a0a0a', autoWidth: true, ...extra });
  }

  line(from: string | ConnectorEnd, to: string | ConnectorEnd, extra: Extra = {}) {
    const end = (e: string | ConnectorEnd): ConnectorEnd => (typeof e === 'string' ? { objectId: e } : e);
    return this.add({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: end(from), to: end(to), color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, ...extra });
  }

  card(x: number, y: number, c: { title: string; desc?: string; status?: CardStatus; tags?: CardTag[]; due?: string; color?: string }, w = 280) {
    const chips = (c.status ? 1 : 0) + (c.tags?.length ?? 0) + (c.due ? 1 : 0);
    return this.add({ type: 'card', x, y, w, h: cardHeight(w, c.title, c.desc, chips), text: c.title, desc: c.desc, status: c.status, tags: c.tags, due: c.due, color: c.color ?? '#1763b5' });
  }

  table(x: number, y: number, rows: string[][], w: number, widths?: number[], head: TableHead = 'row', color = '#0a0a0a') {
    const t = newTable({ x: 0, y: 0 }, tableFrom(rows, widths), w, head);
    return this.add({ ...t, x, y, color });
  }

  /** Mindmap mit der Wurzel links oben bei (x, y); Layout wie im Editor. */
  mind(x: number, y: number, spec: MindSpec) {
    const nodes: BoardObject[] = [];
    const walk = (s: MindSpec, parent: string | undefined, level: number, color: string, order: number) => {
      const id = nanoid();
      const size = mindSize(s.text, level);
      nodes.push({ id, type: 'mindnode', x, y, ...size, z: '', createdBy: '', updatedAt: '', text: s.text, color, mind: { ...(parent ? { parent, order } : { level: 0 }), ...(level === 1 ? { side: s.side ?? 'r' } : {}) } } as BoardObject);
      (s.children ?? []).forEach((k, i) => walk(k, id, level + 1, level === 0 ? MIND_COLORS[i % MIND_COLORS.length] : color, i));
      return id;
    };
    const root = walk(spec, undefined, 0, '#0a0a0a', 0);
    const lay = layoutPatches(nodes);
    for (const n of nodes) this.objects.push({ ...n, ...lay[n.id] } as BoardObject);
    return root;
  }

  /** Zuletzt angelegtes Objekt (z. B. für die Höhe einer Karte). */
  last(): BoardObject {
    return this.objects[this.objects.length - 1];
  }
}
