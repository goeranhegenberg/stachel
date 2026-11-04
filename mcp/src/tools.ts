// MCP-Server von Stachel: Tools, Ressourcen und Prompts für einen Assistenten (= ein API-Token, siehe agent.ts).
// Jede schreibende Tool-Ausführung ist genau ein Transact = ein Rückgängig-Schritt (undo).
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Agent } from './agent';
import { StachelError } from './stachel/api';
import type { BoardConn } from './stachel/board';
import type { Obj, Patch } from './board/model';
import { boundsOf, frameOf, unionOf, type Rect } from './board/geometry';
import { CREATABLE, ConnectorFields, UpdateItem, buildConnector, kindOf } from './kinds/kinds';
import { color, ColorStr, Coord, Size, Tag, TextMd, ToolError, mustGet, type BuildCtx } from './kinds/common';
import { compact, connectionIndex, filterObjects, overview, prune, snap, type Snap } from './ops/read';
import { newCtx, planBounds, planCreate, planKanban, planNotes, type PlanResult } from './ops/create';
import { buildMind, layoutNew, layoutPatches, mindRoot, parseOutline, type MindSpec } from './ops/mindmap';
import { planDelete, planUpdate } from './ops/update';
import { alignOffsets, distributeOffsets, fitFramePatch, layoutClusters, layoutGrid, layoutLayered, movePatches, unitsOf } from './ops/layout';
import { assertNoFrameClash, freeOrigin, overlapWarnings, GAP } from './ops/place';
import { addThread, mentionsIn, readThreads, reply, resolve, Y_COMMENTS } from './ops/comments';
import { DESIGN_GUIDE, INSTRUCTIONS, schemaText } from './guide';
import { COLOR_DE, resolveColor } from './board/palette';
import { registerImportTool } from './import-miro';

export const SERVER_INFO = { name: 'stachel', version: '0.1.0' };

const BoardId = z.string().min(1).max(64).describe('Board-ID (aus list_boards)');
const Ids = z.array(z.string()).min(1).max(2000);
const Area = z.object({ x: Coord, y: Coord, w: Size(1, 1_000_000), h: Size(1, 1_000_000) }).strict();

// ---- Ergebnis-Helfer ----------------------------------------------------------------------------------------------------

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });
const lines = (objs: Record<string, unknown>[]) => objs.map((o) => JSON.stringify(o)).join('\n');

function failure(e: unknown): CallToolResult {
  if (e instanceof ToolError || e instanceof StachelError) return { isError: true, content: [{ type: 'text', text: `Nicht ausgeführt: ${e.message}` }] };
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text', text: `Interner Fehler im Stachel-MCP-Server: ${msg}. Es wurde nichts geändert, falls der Fehler vor dem Schreiben auftrat – prüfe mit get_objects.` }] };
}

const wrap =
  <A>(fn: (a: A) => Promise<CallToolResult>) =>
  async (a: A): Promise<CallToolResult> => {
    try {
      return await fn(a);
    } catch (e) {
      return failure(e);
    }
  };

function snapOf(c: BoardConn): Snap {
  return snap(c.model.all());
}

/** Rückmeldung nach dem Anlegen: id, ref, Typ, Lage. */
function createdSummary(plan: PlanResult, refs: Map<string, string>, s: Snap): string {
  const refOf = new Map([...refs].map(([r, id]) => [id, r]));
  const out = plan.objs.map((o) => {
    const b = o.type === 'connector' ? null : boundsOf(o as Obj, s.byId);
    return prune({ id: o.id, ref: refOf.get(o.id), type: o.type, x: b?.x, y: b?.y, w: b?.w, h: b?.h });
  });
  return lines(out);
}

function warnings(s: Snap, ids: Iterable<string>): string {
  const w = overlapWarnings(s, new Set(ids));
  return w.length ? `\nHinweis – Überdeckungen (ggf. mit auto_layout/arrange_objects auflösen):\n${w.slice(0, 15).join('\n')}${w.length > 15 ? `\n… und ${w.length - 15} weitere` : ''}` : '';
}

/** Hinweis, wenn Objekte durch eine Änderung ihren Rahmen verlassen haben (oft unbeabsichtigt). */
function leftFrames(before: Snap, after: Snap, ids: string[]): string {
  const out: string[] = [];
  for (const id of ids) {
    const o0 = before.byId.get(id);
    const o1 = after.byId.get(id);
    if (!o0 || !o1 || o0.type === 'frame' || o0.type === 'connector') continue;
    const f0 = frameOf(o0, before.frames, before.byId);
    const f1 = frameOf(o1, after.frames, after.byId);
    if (f0 && f0.id !== f1?.id) out.push(`${id} liegt nicht mehr (ganz) in Rahmen „${f0.title ?? f0.id}“`);
  }
  return out.length
    ? `\nHinweis – Rahmen verlassen (Rahmen ggf. mit group_objects fitFrame anpassen):\n${out.slice(0, 10).join('\n')}${out.length > 10 ? `\n… und ${out.length - 10} weitere` : ''}`
    : '';
}

/** Anlegen ausführen: ein Transact (= ein Rückgängig-Schritt). */
function commitPlan(c: BoardConn, plan: PlanResult, s?: Snap) {
  if (s) assertNoFrameClash(s, plan.framePatches, plan.objs);
  c.change(
    (m) => {
      m.create(plan.objs);
      if (Object.keys(plan.framePatches).length) m.update(plan.framePatches);
    },
    () => plan.objs.map((o) => o.id),
  );
}

async function peopleIfNeeded(agent: Agent, needed: boolean) {
  return needed ? agent.api.users().catch(() => []) : [];
}

const hasAssignee = (items: any[]): boolean => items.some((i) => i && typeof i === 'object' && (typeof i.assignee === 'string' || (Array.isArray(i.cards) && hasAssignee(i.cards)) || (Array.isArray(i.columns) && hasAssignee(i.columns))));

// ---- Server -----------------------------------------------------------------------------------------------------------

export function createMcpServer(agent: Agent): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });

  // ---------- Boards ----------

  server.registerTool(
    'list_boards',
    {
      title: 'Boards auflisten',
      description: 'Alle Boards, die du sehen darfst (zuletzt geändert zuerst), mit id, Titel, Ersteller und Rolle. Zeigt auch, wer du bist.',
      inputSchema: { query: z.string().max(120).optional().describe('nur Boards, deren Titel dies enthält') },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ query }) => {
      const me = await agent.me();
      const list = (await agent.boards(true)).filter((b) => !query || b.title.toLowerCase().includes(query.toLowerCase()));
      const rows = list.map((b) => prune({ id: b.id, title: b.title, createdBy: b.createdByName, updatedAt: b.updatedAt, template: b.template || undefined, favorite: b.favorite || undefined, role: b.role }));
      return text(`Du arbeitest als „${me.ai.name}“ (Rechte von ${me.user.name}).\n${rows.length} Board(s):\n${lines(rows)}`);
    }),
  );

  server.registerTool(
    'create_board',
    {
      title: 'Board anlegen',
      description: 'Legt ein neues, leeres Board an und liefert seine id.',
      inputSchema: { title: z.string().min(1).max(120) },
    },
    wrap(async ({ title }) => {
      const b = await agent.api.createBoard(title);
      agent.invalidateBoards();
      return text(`Board angelegt: ${JSON.stringify({ id: b.id, title: b.title })}`);
    }),
  );

  // ---------- Lesen ----------

  server.registerTool(
    'get_board_overview',
    {
      title: 'Board-Überblick',
      description:
        'Überblick über ein Board: Anzahl je Objekttyp, Gesamtfläche, Rahmen (mit Inhalt und Beispielen), Mindmaps, Cluster außerhalb von Rahmen, Kommentare, Anwesende und ein freier Platz für neuen Inhalt. Zuerst aufrufen, bevor du etwas änderst.',
      inputSchema: { board: BoardId },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ board }) =>
      agent.withBoard(board, false, (c) => {
        const info = overview(snapOf(c));
        const comments = readThreads(c.ext(Y_COMMENTS)).length;
        const peers = c.peers().map((p) => p.name);
        // privater Modus: verdeckte Objekte anderer sieht auch der Assistent nur als Anzahl (Platzhalter ohne Inhalt)
        const pm = c.ext('private.mode');
        const privateMode = pm.get('on') === true ? { on: true, by: pm.get('byName'), anonymous: pm.get('anonymous') === true, hidden: c.ext('private.hidden').size } : undefined;
        return text(JSON.stringify({ ...info, openComments: comments, present: peers, ...(privateMode ? { privateMode } : {}) }, null, 1));
      }),
    ),
  );

  server.registerTool(
    'get_objects',
    {
      title: 'Objekte lesen',
      description:
        'Objekte kompakt lesen (eine Zeile JSON je Objekt: id, type, x, y, w, h, Text als Markdown, Farbe, Rahmen, Verbindungen, typspezifische Felder). Filter lassen sich kombinieren. Ohne Filter: alle (bis limit). Beispiel: {"board":"…","types":["sticky"],"frame":"<rahmen-id>"}',
      inputSchema: {
        board: BoardId,
        ids: Ids.optional(),
        types: z.array(z.string()).optional().describe('z. B. ["sticky","card"]; Typen: sticky, text, shape, frame, card, table, connector, mindnode, sticker, image, pen, icon'),
        area: Area.optional().describe('nur Objekte, die diesen Weltbereich berühren'),
        frame: z.string().optional().describe('nur Objekte in diesem Rahmen'),
        text: z.string().max(200).optional().describe('Text enthält (ohne Groß-/Kleinschreibung)'),
        tag: z.string().max(40).optional(),
        color: z.string().max(32).optional().describe('Farbname oder #rrggbb'),
        limit: z.number().int().min(1).max(1000).optional().describe('höchstens so viele (Standard 200)'),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, false, (c) => {
        const s = snapOf(c);
        const hits = filterObjects(s, a);
        const limit = a.limit ?? 200;
        const page = hits.slice(a.offset ?? 0, (a.offset ?? 0) + limit);
        const conns = connectionIndex(s);
        const more = hits.length > (a.offset ?? 0) + page.length ? `\n… ${hits.length - (a.offset ?? 0) - page.length} weitere (offset ${(a.offset ?? 0) + page.length})` : '';
        return text(`${hits.length} Treffer:\n${lines(page.map((o) => compact(o, s, { connections: conns })))}${more}`);
      }),
    ),
  );

  server.registerTool(
    'search',
    {
      title: 'Auf dem Board suchen',
      description: 'Volltextsuche wie Strg F in Stachel: Text, Rahmentitel, Tags, Kartenbeschreibung, zuständige Person, Tabellenzellen. Liefert Treffer mit id, Typ, Lage und Textausschnitt.',
      inputSchema: { board: BoardId, query: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ board, query }) =>
      agent.withBoard(board, false, (c) => {
        const s = snapOf(c);
        const hits = filterObjects(s, { text: query }).slice(0, 100);
        const q = query.toLowerCase();
        const rows = hits.map((o) => {
          const all = [o.text, o.title, o.desc, ...(o.tags ?? []).map((t: { label: string }) => t.label), o.assignee?.name, ...Object.values(o.table?.cells ?? {})].filter((v): v is string => typeof v === 'string');
          const hit = all.find((v) => v.toLowerCase().includes(q)) ?? '';
          const i = hit.toLowerCase().indexOf(q);
          const snippet = `${i > 30 ? '…' : ''}${hit.slice(Math.max(0, i - 30), i + q.length + 50).replace(/\s+/g, ' ')}`;
          const b = boundsOf(o, s.byId);
          return { id: o.id, type: o.type, x: b.x, y: b.y, w: b.w, h: b.h, match: snippet };
        });
        return text(`${rows.length} Treffer für „${query}“:\n${lines(rows)}`);
      }),
    ),
  );

  // ---------- Anlegen ----------

  const createUnion = z.discriminatedUnion('type', CREATABLE.map((k) => k.create!) as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]);

  server.registerTool(
    'create_objects',
    {
      title: 'Objekte anlegen',
      description: `Legt beliebige Objekte in EINEM Schritt an: sticky (Haftnotiz), text, shape (Form), frame (Rahmen), card (Karte), table, sticker, connector. Mit "ref" benannte Objekte können Verbinder im selben Aufruf verbinden; "in" legt Objekte in einen Rahmen (x/y dann relativ). Ohne x/y platziert Stachel frei neben dem Inhalt bzw. im Rahmen.
Beispiel Flussdiagramm: {"board":"…","objects":[{"type":"shape","ref":"a","shape":"terminator","text":"Start","x":0,"y":0},{"type":"shape","ref":"b","text":"Tickets prüfen","x":300,"y":0},{"type":"shape","ref":"c","shape":"diamond","text":"OK?","x":600,"y":-20,"w":160,"h":160},{"type":"connector","from":"a","to":"b","style":"elbow"},{"type":"connector","from":"b","to":"c","style":"elbow","label":"weiter"}]}`,
      inputSchema: { board: BoardId, objects: z.array(createUnion).min(1).max(500) },
    },
    wrap(async ({ board, objects }) => {
      const people = await peopleIfNeeded(agent, hasAssignee(objects));
      return agent.withBoard(board, true, (c) => {
        const s = snapOf(c);
        const ctx = newCtx(s, c.model, people);
        const plan = planCreate(objects, s, ctx);
        commitPlan(c, plan, s);
        const after = snapOf(c);
        return text(`${plan.objs.length} Objekt(e) angelegt (ein Rückgängig-Schritt):\n${createdSummary(plan, ctx.refs, after)}${warnings(after, plan.objs.map((o) => o.id))}`);
      });
    }),
  );

  server.registerTool(
    'create_notes',
    {
      title: 'Haftnotizen im Raster',
      description:
        'Viele Haftnotizen auf einmal, sauber im Raster (Standard-Abstand 24), z. B. Ergebnisse eines Brainstormings. Ohne x/y frei neben dem Inhalt bzw. im Rahmen (`in`), der dann bei Bedarf wächst. Beispiel: {"board":"…","notes":[{"text":"Shuttlebus"},{"text":"Mehr Toiletten","color":"pink"}],"columns":4}',
      inputSchema: {
        board: BoardId,
        notes: z.array(z.object({ text: TextMd, color: ColorStr.optional(), tags: z.array(Tag).max(8).optional() }).strict()).min(1).max(300),
        columns: z.number().int().min(1).max(30).optional().describe('Spalten (Standard: möglichst quadratisch, höchstens 6)'),
        color: ColorStr.optional().describe('Farbe für alle ohne eigene Farbe (Standard yellow)'),
        shape: z.enum(['square', 'rect']).optional(),
        size: Size(80, 1200).optional().describe('Höhe einer Notiz (Standard 200)'),
        gap: Size(0, 400).optional().describe('Abstand (Standard 24)'),
        x: Coord.optional(),
        y: Coord.optional(),
        in: z.string().optional().describe('Rahmen-id: Notizen in diesen Rahmen'),
      },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, true, (c) => {
        const s = snapOf(c);
        const ctx = newCtx(s, c.model);
        if (a.x !== undefined !== (a.y !== undefined)) throw new ToolError('Bitte x und y zusammen angeben (oder beide weglassen).');
        const plan = planNotes(a.notes, a, s, ctx);
        commitPlan(c, plan, s);
        const after = snapOf(c);
        const b = planBounds(plan.objs, after);
        return text(`${plan.objs.length} Notizen angelegt in ${JSON.stringify(b)}:\n${createdSummary(plan, ctx.refs, after)}${warnings(after, plan.objs.map((o) => o.id))}`);
      }),
    ),
  );

  const MindNode: z.ZodType<MindSpec> = z.lazy(() =>
    z
      .object({
        text: z.string().max(500),
        color: ColorStr.optional(),
        side: z.enum(['left', 'right']).optional().describe('nur bei Hauptthemen'),
        collapsed: z.boolean().optional(),
        children: z.array(MindNode).max(60).optional(),
      })
      .strict(),
  );

  server.registerTool(
    'create_mindmap',
    {
      title: 'Mindmap anlegen',
      description:
        'Mindmap aus einem Baum mit automatischem Layout wie in Stachel (Wurzel bleibt stehen, Äste links/rechts, Farben je Hauptast). Entweder `tree` (JSON) oder `outline` (eingerückte Liste, 2 Leerzeichen je Ebene, erste Zeile = Wurzel). Mit `attachTo` hängst du den Baum an einen vorhandenen Knoten. Beispiel outline: "Festival 2026\\n- Programm\\n  - Bands\\n  - Workshops\\n- Orga\\n  - Helfer"',
      inputSchema: {
        board: BoardId,
        tree: MindNode.optional(),
        outline: z.string().max(20000).optional(),
        attachTo: z.string().optional().describe('id eines Mindmap-Knotens: Baum wird dessen Unterthema (die Wurzel des Baums ist dann ein Kind)'),
        x: Coord.optional().describe('Lage der Wurzel (links oben); ohne: frei neben dem Inhalt'),
        y: Coord.optional(),
        balance: z.boolean().optional().describe('Hauptäste auf beide Seiten verteilen (Standard ab 5 Hauptästen)'),
      },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, true, (c) => {
        if (!a.tree === !a.outline) throw new ToolError('Bitte genau eins angeben: `tree` oder `outline`.');
        const spec = a.tree ?? parseOutline(a.outline!);
        const s = snapOf(c);
        const rc = (v: string | undefined) => (v === undefined ? undefined : (color(v, 'ink') ?? undefined));
        let nodes;
        let rootId: string;
        let patches: Record<string, Patch> = {};
        if (a.attachTo) {
          const parent = s.byId.get(a.attachTo);
          if (!parent || parent.type !== 'mindnode') throw new ToolError(`attachTo „${a.attachTo}“ ist kein Mindmap-Knoten.`);
          const siblings = s.all.filter((k) => k.type === 'mindnode' && k.mind?.parent === parent.id).length;
          nodes = buildMind(spec, { x: parent.x, y: parent.y, parent, parentLevel: Number(parent.mind?.level ?? 0), siblings, resolveColor: rc });
          rootId = mindRoot(s.byId, parent.id);
          const all = [...s.all.filter((k) => k.type === 'mindnode'), ...nodes];
          patches = layoutPatches(all, new Set([rootId]));
          for (const n of nodes) Object.assign(n, patches[n.id] ?? {});
          for (const n of nodes) delete patches[n.id];
        } else {
          nodes = buildMind(spec, { x: 0, y: 0, resolveColor: rc, balance: a.balance ?? true });
          const lay = layoutNew(nodes);
          let dx: number;
          let dy: number;
          if (a.x !== undefined && a.y !== undefined) {
            dx = a.x;
            dy = a.y;
          } else {
            const o = freeOrigin(s, { w: lay.bounds.w, h: lay.bounds.h });
            dx = o.x - lay.bounds.x;
            dy = o.y - lay.bounds.y;
          }
          nodes = lay.nodes.map((n) => ({ ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }) as Obj & { id: string });
          rootId = nodes[0]!.id;
        }
        c.change(
          (m) => {
            m.create(nodes);
            if (Object.keys(patches).length) m.update(patches);
          },
          () => nodes.map((n) => n.id),
        );
        const after = snapOf(c);
        const b = unionOf(nodes.map((n) => after.byId.get(n.id)!).filter(Boolean), after.byId);
        const rows = nodes.map((n) => ({ id: n.id, text: n.text, parent: n.mind?.parent, level: after.byId.get(n.id)?.mind?.level }));
        return text(`Mindmap ${a.attachTo ? 'erweitert' : 'angelegt'} (Wurzel ${rootId}, ${nodes.length} neue Knoten, Bereich ${JSON.stringify(b)}):\n${lines(rows.map((r) => prune(r)))}${warnings(after, nodes.map((n) => n.id))}`);
      }),
    ),
  );

  const CardIn = z
    .object({
      title: z.string().min(1).max(300),
      desc: z.string().max(5000).optional(),
      status: z.enum(['todo', 'doing', 'blocked', 'done']).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      tags: z.array(Tag).max(8).optional(),
      assignee: z.string().max(120).optional(),
      color: ColorStr.optional(),
    })
    .strict();

  server.registerTool(
    'create_kanban',
    {
      title: 'Kanban-Board anlegen',
      description:
        'Kanban wie die Stachel-Vorlage: Rahmen mit Spalten (Farbbalken, Kopf) und Karten (Status, Tags, Fälligkeit, zuständig). Beispiel: {"board":"…","title":"Aufgaben","columns":[{"title":"Offen","cards":[{"title":"Bühne buchen","due":"2026-11-15"}]},{"title":"In Arbeit","color":"blue","cards":[]},{"title":"Erledigt","color":"green","cards":[]}]}',
      inputSchema: {
        board: BoardId,
        title: z.string().max(120).optional(),
        columns: z.array(z.object({ title: z.string().min(1).max(60), color: ColorStr.optional(), cards: z.array(CardIn).max(60) }).strict()).min(1).max(10),
        columnWidth: Size(240, 800).optional(),
        x: Coord.optional(),
        y: Coord.optional(),
      },
    },
    wrap(async (a) => {
      const people = await peopleIfNeeded(agent, hasAssignee(a.columns));
      return agent.withBoard(a.board, true, (c) => {
        const s = snapOf(c);
        const ctx = newCtx(s, c.model, people);
        const k = planKanban(a, s, ctx, (v, f) => color(v, 'ink', f));
        commitPlan(c, k.plan, s);
        const after = snapOf(c);
        return text(
          `Kanban angelegt: Rahmen ${k.frameId} ${JSON.stringify(planBounds(k.plan.objs, after))}\n${a.columns.map((col, i) => `Spalte „${col.title}“ (Fläche ${k.columnIds[i]}): Karten ${JSON.stringify(k.cardIds[i])}`).join('\n')}${warnings(after, k.plan.objs.map((o) => o.id))}`,
        );
      });
    }),
  );

  server.registerTool(
    'connect',
    {
      title: 'Verbinden',
      description:
        'Verbinder zwischen vorhandenen Objekten anlegen (docken an, wandern beim Verschieben mit). Standard: geschwungen mit Pfeil am Ende. Beispiel: {"board":"…","connectors":[{"from":"<id1>","to":"<id2>","label":"danach"},{"from":{"id":"<id2>","side":"s"},"to":"<id3>","style":"elbow","endCap":"none"}]}',
      inputSchema: { board: BoardId, connectors: z.array(z.object(ConnectorFields).strict()).min(1).max(500) },
    },
    wrap(async ({ board, connectors }) =>
      agent.withBoard(board, true, (c) => {
        const s = snapOf(c);
        const ctx = newCtx(s, c.model);
        const objs = connectors.map((i) => {
          const o = buildConnector(i as any, ctx);
          ctx.pending.set(o.id, o);
          return o;
        });
        const plan = { objs, framePatches: {} };
        commitPlan(c, plan, s);
        return text(`${objs.length} Verbinder angelegt:\n${lines(objs.map((o) => prune({ id: o.id, from: (o.from as any).objectId ?? o.from, to: (o.to as any).objectId ?? o.to })))}`);
      }),
    ),
  );

  // ---------- Ändern ----------

  server.registerTool(
    'update_objects',
    {
      title: 'Objekte ändern',
      description:
        'Felder vieler Objekte in einem Schritt ändern: Text (Markdown), Farbe, Lage, Größe, Drehung, Tags, Format, Formart, Karten-/Tabellen-/Verbinder-/Mindmap-Felder. Nicht passende Felder je Typ werden mit Hinweis abgelehnt. Rahmen nehmen beim Verschieben ihren Inhalt mit; Mindmaps ordnen sich nach Text-/Struktur-Änderungen neu. Beispiel: {"board":"…","updates":[{"id":"…","text":"**Neu**","color":"green"},{"id":"…","x":400,"y":0}]}',
      inputSchema: { board: BoardId, updates: z.array(UpdateItem).min(1).max(1000) },
    },
    wrap(async ({ board, updates }) => {
      const people = await peopleIfNeeded(agent, updates.some((u) => typeof u.assignee === 'string' && u.assignee));
      return agent.withBoard(board, true, (c) => {
        const s = snapOf(c);
        const ctx = newCtx(s, c.model, people);
        const plan = planUpdate(updates, s, ctx);
        assertNoFrameClash(s, plan.patches);
        const n = Object.keys(plan.patches).length;
        if (!n) return text('Nichts zu ändern (Werte sind schon so).');
        c.change(
          (m) => m.update(plan.patches),
          () => updates.map((u) => u.id),
        );
        const after = snapOf(c);
        const conns = connectionIndex(after);
        const rows = updates.map((u) => after.byId.get(u.id)).filter((o): o is Obj => !!o).map((o) => compact(o, after, { connections: conns }));
        return text(`${n} Objekt(e) geändert (ein Rückgängig-Schritt).${plan.notes.length ? `\n${plan.notes.join('\n')}` : ''}\n${lines(rows)}${warnings(after, updates.map((u) => u.id))}${leftFrames(s, after, Object.keys(plan.patches))}`);
      });
    }),
  );

  server.registerTool(
    'arrange_objects',
    {
      title: 'Ausrichten, verteilen, verschieben',
      description:
        'Mehrere Objekte ordnen wie die Ausrichten-Leiste in Stachel: action align (mit `align`: left, hcenter, right, top, vcenter, bottom), distribute (gleiche Abstände, `axis` x|y, optional fester `gap`), move (um dx/dy), moveTo (Gruppe mit linker oberer Ecke nach x/y), front/back (Ebene). Gruppen, Rahmen (samt Inhalt) und Mindmaps bewegen sich als Ganzes.',
      inputSchema: {
        board: BoardId,
        ids: Ids,
        action: z.enum(['align', 'distribute', 'move', 'moveTo', 'front', 'back']),
        align: z.enum(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']).optional(),
        axis: z.enum(['x', 'y']).optional(),
        gap: Size(0, 5000).optional(),
        dx: z.number().min(-100000).max(100000).optional(),
        dy: z.number().min(-100000).max(100000).optional(),
        x: Coord.optional(),
        y: Coord.optional(),
      },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, true, (c) => {
        const s = snapOf(c);
        const objs = a.ids.map((id) => {
          const o = s.byId.get(id);
          if (!o) throw new ToolError(`Objekt „${id}“ gibt es nicht.`);
          return o;
        });
        if (a.action === 'front' || a.action === 'back') {
          c.change((m) => (a.action === 'front' ? m.bringToFront(a.ids) : m.sendToBack(a.ids)), () => a.ids);
          return text(`${a.ids.length} Objekt(e) ${a.action === 'front' ? 'nach vorn' : 'nach hinten'} gebracht.`);
        }
        const units = unitsOf(objs, s);
        let offsets: Map<string, { dx: number; dy: number }>;
        if (a.action === 'align') {
          if (!a.align) throw new ToolError('Für action "align" bitte `align` angeben (left, hcenter, right, top, vcenter, bottom).');
          offsets = alignOffsets(units, a.align);
        } else if (a.action === 'distribute') {
          if (units.length < (a.gap === undefined ? 3 : 2)) throw new ToolError('Verteilen braucht mindestens 3 Objekte (mit `gap` 2).');
          offsets = distributeOffsets(units, a.axis ?? 'x', a.gap);
        } else if (a.action === 'move') {
          offsets = new Map(units.map((u) => [u.key, { dx: Math.round(a.dx ?? 0), dy: Math.round(a.dy ?? 0) }]));
        } else {
          if (a.x === undefined || a.y === undefined) throw new ToolError('Für "moveTo" bitte x und y angeben.');
          const b = unionOf(objs, s.byId)!;
          offsets = new Map(units.map((u) => [u.key, { dx: Math.round(a.x! - b.x), dy: Math.round(a.y! - b.y) }]));
        }
        const patches = movePatches(units, offsets, s);
        assertNoFrameClash(s, patches);
        if (!Object.keys(patches).length) return text('Nichts zu tun – liegt schon so.');
        c.change((m) => m.update(patches), () => a.ids);
        const after = snapOf(c);
        return text(`${Object.keys(patches).length} Objekt(e) bewegt. Neuer Bereich: ${JSON.stringify(unionOf(a.ids.map((id) => after.byId.get(id)!).filter(Boolean), after.byId))}${warnings(after, Object.keys(patches))}`);
      }),
    ),
  );

  server.registerTool(
    'auto_layout',
    {
      title: 'Automatisch anordnen',
      description: `Ordnet Objekte ohne Überlappung mit Standard-Abständen:
- grid: Raster (columns, gap; sortBy position|text|color|type)
- flow: links → rechts entlang der Verbinder (Prozess, Flussdiagramm)
- tree: oben → unten entlang der Verbinder (Organigramm, Hierarchie)
- cluster: Gruppen nach color, tag oder type nebeneinander, je Gruppe ein Raster, optional mit Überschrift (labels)
Auswahl über ids oder frame (dann alles darin; fitFrame passt den Rahmen an). Gruppen, Mindmaps und Rahmen bleiben ganz. Ohne origin bleibt die linke obere Ecke stehen.`,
      inputSchema: {
        board: BoardId,
        mode: z.enum(['grid', 'flow', 'tree', 'cluster']),
        ids: Ids.optional(),
        frame: z.string().optional().describe('Rahmen-id: dessen Inhalt anordnen'),
        columns: z.number().int().min(1).max(50).optional(),
        gap: Size(0, 2000).optional().describe('Abstand (Standard: 24 bei Notizen, sonst 48; flow/tree: 120 in Flussrichtung)'),
        by: z.enum(['color', 'tag', 'type']).optional().describe('cluster: wonach gruppieren (Standard color)'),
        labels: z.boolean().optional().describe('cluster: Überschrift über jede Gruppe setzen'),
        labelNames: z.record(z.string(), z.string().max(80)).optional().describe('cluster: eigene Überschriften je Gruppe, z. B. {"green":"Lief gut","pink":"Probleme"} (Schlüssel = Farbname, Tag bzw. Typ)'),
        sortBy: z.enum(['position', 'text', 'color', 'type']).optional(),
        origin: z.object({ x: Coord, y: Coord }).strict().optional(),
        fitFrame: z.boolean().optional().describe('Rahmen an das Ergebnis anpassen (Standard bei frame: true)'),
      },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, true, (c) => {
        const s = snapOf(c);
        if (!a.ids && !a.frame) throw new ToolError('Bitte `ids` oder `frame` angeben.');
        const frame = a.frame ? s.byId.get(a.frame) : undefined;
        if (a.frame && frame?.type !== 'frame') throw new ToolError(`„${a.frame}“ ist kein Rahmen.`);
        let objs = a.ids ? a.ids.map((id) => s.byId.get(id) ?? (() => { throw new ToolError(`Objekt „${id}“ gibt es nicht.`); })()) : filterObjects(s, { frame: a.frame });
        objs = objs.filter((o) => o.type !== 'connector' && o.id !== frame?.id && !o.locked);
        if (!objs.length) throw new ToolError('Keine (beweglichen) Objekte zum Anordnen.');
        const units = unitsOf(objs, s);
        const cur = unionOf(objs, s.byId)!;
        const origin = a.origin ?? (frame ? { x: frame.x + 48, y: frame.y + 48 } : { x: cur.x, y: cur.y });
        const allNotes = objs.every((o) => o.type === 'sticky');
        const gap = a.gap ?? (allNotes ? GAP : 48);
        let res;
        if (a.mode === 'grid') res = layoutGrid(units, origin, { columns: a.columns, gap, sortBy: a.sortBy });
        else if (a.mode === 'cluster') res = layoutClusters(units, origin, { by: a.by ?? 'color', gap, clusterGap: Math.max(120, gap * 4), labelSize: a.labels || a.labelNames ? 32 : 0 });
        else res = layoutLayered(units, s, origin, { direction: a.mode === 'flow' ? 'right' : 'down', gapMain: a.gap ?? 120, gapCross: allNotes ? 40 : 64 });
        const patches = movePatches(units, res.offsets, s);
        const labelObjs = (res.labels ?? []).map((l) => {
          const t = kindOf('text')!.build!({ type: 'text', text: a.labelNames?.[l.text] ?? COLOR_DE[l.text] ?? l.text.charAt(0).toUpperCase() + l.text.slice(1), fontSize: 32, bold: true, fontFamily: 'condensed' }, newCtx(s, c.model));
          return { ...t, x: l.x, y: l.y };
        });
        if (frame && (a.fitFrame ?? true)) Object.assign((patches[frame.id] ??= {}), fitFramePatch(frame, res.bounds));
        assertNoFrameClash(s, patches);
        c.change(
          (m) => {
            m.update(patches);
            if (labelObjs.length) m.create(labelObjs);
          },
          () => [...units.flatMap((u) => u.ids), ...labelObjs.map((l) => l.id)],
        );
        const after = snapOf(c);
        const moved = units.flatMap((u) => u.ids);
        const outside = frame ? [] : moved;
        return text(`${units.length} Einheiten angeordnet (${a.mode}), Bereich ${JSON.stringify(res.bounds)}.${labelObjs.length ? ` Überschriften: ${labelObjs.map((l) => l.id).join(', ')}` : ''}${frame && (a.fitFrame ?? true) ? ` Rahmen angepasst.` : ''}${warnings(after, outside)}`);
      }),
    ),
  );

  server.registerTool(
    'group_objects',
    {
      title: 'Gruppieren / Rahmen drumherum',
      description: 'action group: Objekte zu einer Gruppe verbinden (ein Klick wählt alle); ungroup: Gruppe lösen; frame: einen Rahmen mit Titel um die Objekte legen (Rand `padding`, Standard 48); fitFrame: Rahmen (ids = Rahmen) auf ihren Inhalt + Rand verkleinern bzw. vergrößern.',
      inputSchema: {
        board: BoardId,
        ids: Ids,
        action: z.enum(['group', 'ungroup', 'frame', 'fitFrame']),
        title: z.string().max(120).optional().describe('Titel des neuen Rahmens'),
        padding: Size(0, 1000).optional(),
        color: ColorStr.optional().describe('Hintergrund des neuen Rahmens'),
      },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, true, (c) => {
        const s = snapOf(c);
        const objs = a.ids.map((id) => s.byId.get(id) ?? (() => { throw new ToolError(`Objekt „${id}“ gibt es nicht.`); })());
        if (a.action === 'frame') {
          const b = unionOf(objs, s.byId)!;
          const pad = a.padding ?? 48;
          const f = kindOf('frame')!.build!({ type: 'frame', title: a.title, w: b.w + 2 * pad, h: b.h + 2 * pad, color: a.color }, newCtx(s, c.model));
          Object.assign(f, { x: b.x - pad, y: b.y - pad });
          c.change((m) => m.create([f]), () => [f.id]);
          return text(`Rahmen ${f.id} („${f.title}“) um ${objs.length} Objekt(e) gelegt: ${JSON.stringify({ x: f.x, y: f.y, w: f.w, h: f.h })}`);
        }
        if (a.action === 'fitFrame') {
          const pad = a.padding ?? 48;
          const patches: Record<string, Patch> = {};
          for (const f of objs) {
            if (f.type !== 'frame') throw new ToolError(`fitFrame: „${f.id}“ ist kein Rahmen.`);
            // Inhalt: was ganz drin liegt oder über den Rand ragt (nicht andere Rahmen und deren Inhalt)
            const fr = boundsOf(f, s.byId);
            const kids = s.all.filter((k) => {
              if (k.type === 'connector' || k.type === 'frame' || k.id === f.id) return false;
              const kb = boundsOf(k, s.byId);
              if (!(kb.x < fr.x + fr.w && fr.x < kb.x + kb.w && kb.y < fr.y + fr.h && fr.y < kb.y + kb.h)) return false;
              const home = frameOf(k, s.frames, s.byId);
              return !home || home.id === f.id;
            });
            const b = unionOf(kids, s.byId);
            if (!b) throw new ToolError(`Rahmen „${f.title ?? f.id}“ ist leer.`);
            patches[f.id] = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
          }
          c.change((m) => m.update(patches), () => a.ids);
          return text(`Rahmen angepasst:
${lines(Object.entries(patches).map(([id, p]) => ({ id, ...p })))}`);
        }
        if (a.action === 'group') {
          if (objs.length < 2) throw new ToolError('Eine Gruppe braucht mindestens 2 Objekte.');
          const gid = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          c.change((m) => m.update(Object.fromEntries(objs.map((o) => [o.id, { groupId: gid }]))), () => a.ids);
          return text(`Gruppe ${gid} aus ${objs.length} Objekten.`);
        }
        c.change((m) => m.update(Object.fromEntries(objs.filter((o) => o.groupId).map((o) => [o.id, { groupId: undefined }]))), () => a.ids);
        return text('Gruppe gelöst.');
      }),
    ),
  );

  server.registerTool(
    'delete_objects',
    {
      title: 'Objekte löschen',
      description: 'Löscht Objekte (ein Rückgängig-Schritt). Angedockte Verbinder und Mindmap-Unterthemen gehen mit. Rahmen löschen nur den Rahmen, nicht den Inhalt.',
      inputSchema: { board: BoardId, ids: Ids },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ board, ids }) =>
      agent.withBoard(board, true, (c) => {
        const s = snapOf(c);
        const plan = planDelete(ids, s);
        let removed: string[] = [];
        c.change((m) => {
          removed = m.remove(plan.ids);
          if (plan.mindRoots.size) {
            const nodes = m.all().filter((k) => k.type === 'mindnode');
            m.update(layoutPatches(nodes, plan.mindRoots));
          }
        });
        return text(`${removed.length} Objekt(e) gelöscht (mit undo zurückholbar): ${removed.join(', ')}`);
      }),
    ),
  );

  // ---------- Kommentare ----------

  server.registerTool(
    'get_comments',
    {
      title: 'Kommentare lesen',
      description: 'Kommentar-Threads des Boards (offen; mit includeResolved auch erledigte), optional nur zu einem Objekt.',
      inputSchema: { board: BoardId, includeResolved: z.boolean().optional(), objectId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a) =>
      agent.withBoard(a.board, false, (c) => {
        const threads = readThreads(c.ext(Y_COMMENTS), a);
        return text(`${threads.length} Thread(s):\n${lines(threads)}`);
      }),
    ),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Kommentieren',
      description: 'Neuer Kommentar an einem Objekt (objectId) oder frei (x, y), Antwort auf einen Thread (threadId) oder Thread erledigen (resolve). @Name erwähnt eine Person.',
      inputSchema: {
        board: BoardId,
        text: z.string().max(4000).optional(),
        objectId: z.string().optional(),
        x: Coord.optional(),
        y: Coord.optional(),
        threadId: z.string().optional().describe('antworten bzw. erledigen'),
        resolve: z.boolean().optional().describe('true = Thread erledigt, false = wieder öffnen'),
      },
    },
    wrap(async (a) => {
      const me = await agent.me();
      const people = a.text?.includes('@') ? await agent.api.users().catch(() => []) : [];
      return agent.withBoard(a.board, 'comment', (c) => {
        const map = c.ext(Y_COMMENTS);
        const who = { key: me.ai.key, name: me.ai.name };
        const mentions = a.text ? mentionsIn(a.text, people) : [];
        if (a.threadId) {
          c.change(() => {
            if (a.text) reply(map, a.threadId!, who, a.text, mentions);
            if (a.resolve !== undefined) resolve(map, a.threadId!, a.resolve, who.key);
            if (!a.text && a.resolve === undefined) throw new ToolError('Antwort braucht `text` oder `resolve`.');
          });
          return text(`Thread ${a.threadId} aktualisiert.`);
        }
        if (!a.text) throw new ToolError('Neuer Kommentar braucht `text`.');
        const obj = a.objectId ? c.model.get(a.objectId) : undefined;
        if (a.objectId && !obj) throw new ToolError(`Objekt „${a.objectId}“ gibt es nicht.`);
        let id = '';
        c.change(() => {
          id = addThread(map, { obj: obj ?? undefined, x: a.x, y: a.y }, who, a.text!, mentions);
        }, () => (obj ? [obj.id] : []));
        return text(`Kommentar-Thread ${id} angelegt${mentions.length ? ` (erwähnt: ${mentions.length})` : ''}.`);
      });
    }),
  );

  // ---------- Rückgängig ----------

  server.registerTool(
    'undo',
    {
      title: 'Rückgängig',
      description: 'Nimmt deine eigenen letzten Schritte auf diesem Board zurück (jede Tool-Ausführung = ein Schritt; Änderungen anderer bleiben). redo: true stellt sie wieder her.',
      inputSchema: { board: BoardId, steps: z.number().int().min(1).max(50).optional(), redo: z.boolean().optional() },
    },
    wrap(async ({ board, steps, redo }) =>
      agent.withBoard(board, true, (c) => {
        const n = redo ? c.redo(steps ?? 1) : c.undo(steps ?? 1);
        if (!n) return text(redo ? 'Nichts zum Wiederherstellen.' : 'Nichts zum Zurücknehmen (in dieser Sitzung noch keine eigenen Schritte).');
        return text(`${n} Schritt(e) ${redo ? 'wiederhergestellt' : 'zurückgenommen'}.`);
      }),
    ),
  );

  // ---------- Bildschirmfoto ----------

  server.registerTool(
    'screenshot',
    {
      title: 'Bildschirmfoto',
      description:
        'Zeigt, wie das Board in Stachel aussieht (echte Darstellung der Web-App, PNG). Ausschnitt: ganzes Board (Standard), ein Rahmen (frame), ausgewählte Objekte (ids) oder ein Weltbereich (area). labels: true heftet Nummern an die Objekte und liefert die Legende Nummer → id. Nutze es nach jedem größeren Schritt zur Kontrolle.',
      inputSchema: {
        board: BoardId,
        frame: z.string().optional(),
        ids: Ids.optional(),
        area: Area.optional(),
        labels: z.boolean().optional(),
        size: z.number().int().min(400).max(2400).optional().describe('längere Bildseite in Pixeln (Standard 1400)'),
        padding: Size(0, 2000).optional().describe('Rand um den Ausschnitt in Weltpunkten (Standard 60)'),
        detail: z.enum(['full', 'asSeen']).optional().describe('full (Standard): alle Texte ausgeschrieben; asSeen: wie ein Mensch im Editor bei diesem Zoom (kleine Objekte nur als Fläche)'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a) => {
      const { job, s } = await agent.withBoard(a.board, false, (c) => {
        const s = snapOf(c);
        let rect: Rect | null;
        let focus: Obj[];
        if (a.frame) {
          const f = s.byId.get(a.frame);
          if (!f) throw new ToolError(`Rahmen „${a.frame}“ gibt es nicht.`);
          rect = boundsOf(f, s.byId);
          rect = { x: rect.x, y: rect.y - 30, w: rect.w, h: rect.h + 30 };
          focus = filterObjects(s, { frame: f.id });
        } else if (a.ids) {
          focus = a.ids.map((id) => s.byId.get(id) ?? (() => { throw new ToolError(`Objekt „${id}“ gibt es nicht.`); })());
          rect = unionOf(focus, s.byId);
        } else if (a.area) {
          rect = a.area;
          focus = filterObjects(s, { area: a.area });
        } else {
          focus = s.all;
          rect = unionOf(s.all.filter((o) => !o.hidden), s.byId);
        }
        if (!rect) throw new ToolError('Das Board ist leer – es gibt nichts zu fotografieren.');
        const pad = a.padding ?? 60;
        rect = { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
        const long = a.size ?? 1400;
        const ratio = rect.w / rect.h;
        let width = ratio >= 1 ? long : Math.round(long * ratio);
        let height = ratio >= 1 ? Math.round(long / ratio) : long;
        width = Math.max(400, Math.min(2400, width));
        height = Math.max(300, Math.min(2400, height));
        // Nummern in Lesereihenfolge (Zeilenbänder von oben, darin links → rechts), Rahmen zuerst
        const band = (o: Obj) => Math.floor(boundsOf(o, s.byId).y / 80);
        const labelled = a.labels
          ? focus
              .filter((o) => o.type !== 'connector' && !o.hidden)
              .sort((p, q) => (p.type === 'frame' ? 0 : 1) - (q.type === 'frame' ? 0 : 1) || band(p) - band(q) || p.x - q.x)
              .slice(0, 300)
          : [];
        const settings = c.ext<unknown>('tools.settings').toJSON() as Record<string, unknown>;
        return { s, job: { objects: s.all, settings, rect, width, height, fullDetail: a.detail !== 'asSeen', labels: labelled.map((o, i) => ({ n: i + 1, id: o.id })) } };
      });
      const res = await agent.renderer.shot({ ...job, webUrl: agent.webUrl, fetchImage: (p) => agent.api.image(p) });
      const legend = res.legend.map((l) => {
        const o = s.byId.get(l.id)!;
        const t = String(o.text ?? o.title ?? '').replace(/\s+/g, ' ').slice(0, 40);
        return `${l.n} = ${l.id} ${o.type}${t ? ` „${t}“` : ''}`;
      });
      const r = job.rect;
      return {
        content: [
          { type: 'image', data: res.png.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: `Ausschnitt x ${Math.round(r.x)}…${Math.round(r.x + r.w)}, y ${Math.round(r.y)}…${Math.round(r.y + r.h)} (${job.width}×${job.height} px, 1 px ≈ ${(r.w / job.width).toFixed(2)} Weltpunkte).${legend.length ? `\nLegende:\n${legend.join('\n')}` : ''}` },
        ],
      };
    }),
  );

  // ---------- Privater Modus ----------

  server.registerTool(
    'private_mode',
    {
      title: 'Privater Modus',
      description:
        'Privater Modus eines Boards (verdeckt schreiben, gemeinsam aufdecken): status = Zustand und Zahl verdeckter Objekte; start = starten (anonymous: Namen anonym, own_reveal: jede:r darf eigene vorher aufdecken); reveal = alles aufdecken (countdown 0–10 s, Standard 3; nur die Moderation, außer sie ist nicht mehr da); reveal_own = die eigenen aufdecken; cancel = laufenden Countdown abbrechen. Verdeckte Inhalte anderer bekommst du nie zu sehen. Was du selbst während des Modus anlegst, ist für alle sichtbar.',
      inputSchema: {
        board: BoardId,
        action: z.enum(['status', 'start', 'reveal', 'reveal_own', 'cancel']),
        anonymous: z.boolean().optional(),
        own_reveal: z.boolean().optional(),
        countdown: z.number().int().min(0).max(10).optional(),
      },
    },
    wrap(async ({ board, action, anonymous, own_reveal, countdown }) => {
      const path = `/api/boards/${encodeURIComponent(board)}/private`;
      if (action === 'status') {
        const r = await agent.api.req<{ state: Record<string, unknown> }>('GET', path);
        const hidden = await agent.withBoard(board, false, (c) => c.ext('private.hidden').size);
        return text(JSON.stringify({ ...r.state, hidden }));
      }
      const body = prune({
        action: action === 'reveal_own' ? 'revealOwn' : action,
        anonymous: action === 'start' ? anonymous : undefined,
        ownReveal: action === 'start' ? own_reveal : undefined,
        countdown: action === 'reveal' ? countdown : undefined,
      });
      const r = await agent.api.req<{ state: Record<string, unknown> }>('POST', path, body);
      return text(`Erledigt: ${JSON.stringify(r.state)}`);
    }),
  );

  // ---------- Import ----------

  registerImportTool(server, () => ({ api: agent.api, webUrl: agent.webUrl, onBoardCreated: () => agent.invalidateBoards() }), wrap);

  // ---------- Hilfe ----------

  server.registerTool(
    'get_design_guide',
    {
      title: 'Gestaltungsanleitung',
      description: 'Regeln für ansehnliche Stachel-Boards (Aufbau, Abstände, Farben, Verbinder, Strukturen) bzw. das Objektschema mit allen Feldern.',
      inputSchema: { topic: z.enum(['design', 'schema']).optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ topic }) => text(topic === 'schema' ? schemaText() : DESIGN_GUIDE)),
  );

  server.registerResource('design-guide', 'stachel://guide/design', { title: 'So baut man ein gutes Stachel-Board', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DESIGN_GUIDE }] }));
  server.registerResource('object-schema', 'stachel://guide/schema', { title: 'Stachel-Objektschema', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: schemaText() }] }));
  server.registerPrompt(
    'board_gestalten',
    { title: 'Board gestalten', description: 'Leitfaden: ein Thema als ansehnliches Stachel-Board aufbauen und per Bildschirmfoto prüfen.', argsSchema: { thema: z.string().describe('Worum geht es?'), board: z.string().optional().describe('Board-ID (sonst neues Board)') } },
    ({ thema, board }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Gestalte auf Stachel ${board ? `das Board ${board}` : 'ein neues Board'} zum Thema „${thema}“.\n\n${DESIGN_GUIDE}\n\nVorgehen: Überblick holen, Struktur planen (Rahmen, Mindmap, Notizen, Verbinder), anlegen, mit screenshot prüfen und nachbessern, bis es aufgeräumt aussieht.`,
          },
        },
      ],
    }),
  );

  void resolveColor;
  void mustGet;
  return server;
}

export type { BuildCtx };
