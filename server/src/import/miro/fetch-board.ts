// Ein Miro-Board vollständig lesen (docs/features/import.md §3 Schritt read) → MiroBoardData für map.ts.
// Reihenfolge: Board-Angaben, /items (Cursor-Seiten zu 50, Ebenenfolge), /connectors, /tags, Tags je Notiz/Karte
// (begrenzt parallel, nur wenn das Board Tags hat), /groups (Antwortform tolerant), Mindmap-Knoten (experimentell),
// Formen mit unbekanntem `shape` (experimentell), Miro-Docs als HTML. Experimentelles scheitert nie den ganzen Job,
// sondern landet in `warnings`. Fortschritt: done/total = Anfragen (total wächst mit den bekannten Seiten).
import type { ImportReportEntry } from '../../../../shared/import.js';
import { MiroApiError, MiroAuthError, ImportAbortError, type MiroClient } from './client.js';
import type { MiroBoardData, MiroConnector, MiroGroup, MiroItem, MiroMindNode, MiroTag } from './types.js';

/** Formen, die /v2/…/items mit eigenem Namen liefert (developers.miro.com, ShapeData.shape); alle anderen einzeln nachladen */
export const V2_SHAPES: ReadonlySet<string> = new Set([
  'rectangle',
  'round_rectangle',
  'circle',
  'triangle',
  'rhombus',
  'parallelogram',
  'trapezoid',
  'pentagon',
  'hexagon',
  'octagon',
  'wedge_round_rectangle_callout',
  'star',
  'flow_chart_predefined_process',
  'cloud',
  'cross',
  'can',
  'right_arrow',
  'left_arrow',
  'left_right_arrow',
  'left_brace',
  'right_brace',
]);

const TAG_TYPES = new Set(['sticky_note', 'card']);
const PARALLEL = 4;

export interface FetchOptions {
  /** höchstens so viele Objekte lesen (Rest → Hinweis) */
  maxObjects?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

/** bis zu `n` Aufgaben gleichzeitig */
export async function pool<T>(items: readonly T[], n: number, fn: (x: T, i: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new ImportAbortError();
      const i = next++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Fehler, die den Job beenden (Abbruch, Zugang weg) – alles andere ist bei optionalen Teilen nur ein Hinweis. */
const fatal = (e: unknown) => e instanceof ImportAbortError || e instanceof MiroAuthError;

const warn = (list: ImportReportEntry[], code: string, text: string, count = 1) => {
  const hit = list.find((w) => w.code === code);
  if (hit) hit.count += count;
  else list.push({ code, text, count });
};

/** Gruppen-Antwort normalisieren: `items` als Strings, Objekte `{id}` oder unter `data.items`. */
export function normalizeGroups(raw: unknown[]): MiroGroup[] {
  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : typeof (x as { id?: unknown })?.id !== 'undefined' ? String((x as { id: unknown }).id) : '')).filter(Boolean) : [];
  const out: MiroGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, any>;
    const items = ids(o.items).length ? ids(o.items) : ids(o.data?.items).length ? ids(o.data?.items) : ids(o.itemIds ?? o.data?.itemIds);
    const id = o.id !== undefined ? String(o.id) : `g${out.length + 1}`;
    if (items.length >= 2) out.push({ id, items });
  }
  return out;
}

/** HTML eines Miro-Docs aus der Antwort (Form noch unbelegt: `content`, `data.content`, `html`). */
export function docHtml(res: unknown): string | null {
  const o = res as Record<string, any> | null;
  for (const v of [o?.content, o?.data?.content, o?.html, o?.data?.html]) if (typeof v === 'string') return v;
  return null;
}

export async function fetchBoard(client: MiroClient, boardId: string, opts: FetchOptions = {}): Promise<MiroBoardData> {
  const b = `/v2/boards/${enc(boardId)}`;
  const maxObjects = opts.maxObjects ?? Infinity;
  let done = 0;
  let total = 6; // Board, Items, Verbinder, Tags, Gruppen, Mindmap (je mind. eine Seite)
  const tick = (extraTotal = 0) => {
    total += extraTotal;
    done++;
    opts.onProgress?.(done, Math.max(total, done));
  };
  const warnings: ImportReportEntry[] = [];

  const info = (await client.get(b)) as { id?: unknown; name?: unknown; description?: unknown };
  tick();
  const board = {
    id: typeof info?.id === 'string' ? info.id : boardId,
    name: typeof info?.name === 'string' ? info.name : '',
    ...(typeof info?.description === 'string' && info.description ? { description: info.description } : {}),
  };

  // Objekte (Ebenenfolge)
  const items: MiroItem[] = [];
  let itemTotal: number | undefined;
  let firstPage = true;
  for await (const page of client.cursorPages<MiroItem>(`${b}/items`)) {
    if (firstPage && page.total !== undefined) {
      itemTotal = page.total;
      tick(Math.max(0, Math.ceil(Math.min(page.total, maxObjects) / 50) - 1));
    } else tick(itemTotal === undefined && page.data.length === 50 ? 1 : 0);
    firstPage = false;
    for (const it of page.data) if (it && typeof it.id === 'string' && typeof it.type === 'string') items.push(it);
    if (items.length >= maxObjects) break;
  }
  if (items.length > maxObjects) items.length = maxObjects;
  if (items.length >= maxObjects && itemTotal !== undefined && itemTotal > items.length) {
    warn(warnings, 'limit_objects', `Das Board hat mehr als ${maxObjects} Objekte; nur die ersten wurden übernommen.`, itemTotal - items.length);
  }

  const connectors: MiroConnector[] = [];
  for await (const page of client.cursorPages<MiroConnector>(`${b}/connectors`)) {
    tick(page.data.length === 50 ? 1 : 0);
    for (const c of page.data) if (c && typeof c.id === 'string') connectors.push(c);
  }

  const tags: MiroTag[] = [];
  for await (const page of client.offsetPages<MiroTag>(`${b}/tags`)) {
    tick();
    for (const t of page.data) if (t && typeof t.id === 'string') tags.push(t);
  }

  // Tags je Notiz/Karte: nur wenn das Board Tags hat; mitgelieferte tagIds sparen die Anfrage
  const itemTags: Record<string, string[]> = {};
  if (tags.length) {
    const need: MiroItem[] = [];
    for (const it of items) {
      if (!TAG_TYPES.has(it.type)) continue;
      const direct = Array.isArray(it.tagIds) ? it.tagIds : Array.isArray(it.data?.tagIds) ? (it.data!.tagIds as unknown[]) : null;
      if (direct) {
        const ids = direct.filter((x): x is string => typeof x === 'string');
        if (ids.length) itemTags[it.id] = ids;
      } else need.push(it);
    }
    total += need.length;
    await pool(
      need,
      PARALLEL,
      async (it) => {
        try {
          const res = (await client.get(`${b}/items/${enc(it.id)}/tags`)) as { tags?: { id?: unknown }[]; data?: { id?: unknown }[] };
          const list = Array.isArray(res?.tags) ? res.tags : Array.isArray(res?.data) ? res.data : [];
          const ids = list.map((t) => (typeof t?.id === 'string' ? t.id : '')).filter(Boolean);
          if (ids.length) itemTags[it.id] = ids;
        } catch (e) {
          if (fatal(e)) throw e;
          warn(warnings, 'tags_unavailable', 'Bei einigen Notizen oder Karten ließen sich die Tags nicht lesen.');
        } finally {
          tick();
        }
      },
      opts.signal,
    );
  }

  // Gruppen (Antwortform in der Spezifikation widersprüchlich → tolerant)
  let groups: MiroGroup[] = [];
  try {
    const raw: unknown[] = [];
    for await (const page of client.cursorPages<unknown>(`${b}/groups`)) {
      tick(page.data.length === 50 ? 1 : 0);
      raw.push(...page.data);
    }
    groups = normalizeGroups(raw);
  } catch (e) {
    if (fatal(e)) throw e;
    warn(warnings, 'groups_unavailable', 'Gruppen ließen sich nicht lesen; die Objekte sind einzeln übernommen.');
  }

  // Mindmap (experimentell)
  const mindNodes: MiroMindNode[] = [];
  try {
    for await (const page of client.cursorPages<MiroMindNode>(`/v2-experimental/boards/${enc(boardId)}/mindmap_nodes`)) {
      tick(page.data.length === 50 ? 1 : 0);
      for (const n of page.data) if (n && typeof n.id === 'string') mindNodes.push(n);
    }
  } catch (e) {
    if (fatal(e)) throw e;
    // 404 = Board ohne Mindmap bzw. Endpunkt nicht freigeschaltet: kein Hinweis nötig
    if (!(e instanceof MiroApiError && e.status === 404)) {
      warn(warnings, 'mindmap_unavailable', 'Mindmaps ließen sich nicht lesen (die Miro-Schnittstelle dafür ist noch experimentell).');
    }
  }

  // Formen mit unbekanntem Namen (Flussdiagramm) über v2-experimental
  // (Flussdiagramm-Formen liefert /v2/…/items ohne data/style). Viele davon: einmal die experimentelle Formenliste lesen
  // (eine Anfrage je 50 Formen), sonst bzw. für den Rest einzeln.
  const experimentalShapes: Record<string, MiroItem> = {};
  let unknownShapes = items.filter((it) => it.type === 'shape' && !V2_SHAPES.has(String(it.data?.shape ?? '')));
  if (unknownShapes.length > 2) {
    const want = new Set(unknownShapes.map((it) => it.id));
    try {
      for await (const page of client.cursorPages<MiroItem>(`/v2-experimental/boards/${enc(boardId)}/items`, { type: 'shape' })) {
        tick(page.data.length === 50 ? 1 : 0);
        for (const s of page.data) if (s && want.has(s.id)) experimentalShapes[s.id] = s;
      }
    } catch (e) {
      if (fatal(e)) throw e;
    }
    unknownShapes = unknownShapes.filter((it) => !experimentalShapes[it.id]);
  }
  total += unknownShapes.length;
  await pool(
    unknownShapes,
    PARALLEL,
    async (it) => {
      try {
        const res = (await client.get(`/v2-experimental/boards/${enc(boardId)}/shapes/${enc(it.id)}`)) as MiroItem;
        if (res && typeof res === 'object') experimentalShapes[it.id] = res;
      } catch (e) {
        if (fatal(e)) throw e;
        warn(warnings, 'shapes_unavailable', 'Einige Flussdiagramm-Formen ließen sich nicht genauer lesen und sind als Rechteck übernommen.');
      } finally {
        tick();
      }
    },
    opts.signal,
  );

  // Miro-Docs als HTML
  const docs: Record<string, string> = {};
  const docItems = items.filter((it) => it.type === 'doc_format');
  total += docItems.length;
  await pool(
    docItems,
    PARALLEL,
    async (it) => {
      try {
        const html = docHtml(await client.get(`${b}/docs/${enc(it.id)}`, { textContentType: 'html' }));
        if (html !== null) docs[it.id] = html;
      } catch (e) {
        if (fatal(e)) throw e;
        warn(warnings, 'docs_unavailable', 'Einige Miro-Docs ließen sich nicht lesen.');
      } finally {
        tick();
      }
    },
    opts.signal,
  );

  return { board, items, connectors, tags, itemTags, groups, mindNodes, experimentalShapes, docs, warnings };
}
