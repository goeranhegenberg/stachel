// Lädt ein Fixture-Board (Rohantworten der Miro-Endpunkte, siehe README.md) als `MiroBoardData` – so, wie
// fetch-board.ts es aus den echten Antworten zusammensetzt. Auch der Fake-Server tools/miro-fake.mts liest diese Dateien.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MiroBoardData, MiroConnector, MiroGroup, MiroItem, MiroMindNode, MiroTag } from '../../../src/import/miro/types.js';

export const MIRO_FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Namen der Fixture-Boards (Unterordner mit `board.json`). */
export function miroFixtureBoards(): string[] {
  return fs
    .readdirSync(MIRO_FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(MIRO_FIXTURES_DIR, d.name, 'board.json')))
    .map((d) => d.name)
    .sort();
}

const readJson = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Seiten `<prefix>_1.json`, `<prefix>_2.json` … in Zahlenfolge, `data` aneinandergehängt. */
function pages<T>(dir: string, prefix: string): T[] {
  const re = new RegExp(`^${prefix}_(\\d+)\\.json$`);
  return fs
    .readdirSync(dir)
    .map((f) => ({ f, n: Number(re.exec(f)?.[1]) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n)
    .flatMap(({ f }) => {
      const page = readJson(path.join(dir, f));
      return (Array.isArray(page) ? page : (page.data ?? [])) as T[];
    });
}

/** `GET /groups`: Mitglieder je Gruppe (die Spec ist uneinheitlich: `data.items` oder `items`). */
function groups(raw: any): MiroGroup[] {
  const list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  return list
    .map((g) => ({ id: String(g.id), items: (g.data?.items ?? g.items ?? []).map((x: unknown) => (typeof x === 'string' ? x : String((x as { id?: unknown })?.id ?? ''))).filter(Boolean) }))
    .filter((g) => g.items.length);
}

/** Tag-IDs je Objekt: `item_tags.json` ist `{itemId: [tagId]}` bzw. `{itemId: {tags: [{id}]}}` (Rohantwort von `…/items/{id}/tags`). */
function itemTags(raw: any): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, v] of Object.entries(raw ?? {})) {
    const list = Array.isArray(v) ? v : ((v as { tags?: unknown[] })?.tags ?? []);
    out[id] = list.map((t) => (typeof t === 'string' ? t : String((t as { id?: unknown }).id))).filter(Boolean);
  }
  return out;
}

export function loadMiroFixture(name: string): MiroBoardData {
  const dir = path.join(MIRO_FIXTURES_DIR, name);
  const opt = (f: string) => (fs.existsSync(path.join(dir, f)) ? readJson(path.join(dir, f)) : undefined);
  const board = readJson(path.join(dir, 'board.json'));
  const tags = opt('tags.json');
  return {
    board: { id: String(board.id), name: String(board.name ?? ''), ...(board.description ? { description: String(board.description) } : {}) },
    items: pages<MiroItem>(dir, 'items'),
    connectors: pages<MiroConnector>(dir, 'connectors'),
    tags: (Array.isArray(tags) ? tags : (tags?.data ?? [])) as MiroTag[],
    itemTags: itemTags(opt('item_tags.json')),
    groups: groups(opt('groups.json')),
    mindNodes: pages<MiroMindNode>(dir, 'mindmap_nodes'),
    experimentalShapes: (opt('experimental_shapes.json') ?? {}) as Record<string, MiroItem>,
    docs: (opt('docs.json') ?? {}) as Record<string, string>,
    warnings: [],
  };
}
