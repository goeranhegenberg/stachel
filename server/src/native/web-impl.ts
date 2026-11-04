// Umsetzung von `#stachel-web` (web-api.ts): Datenschicht der Web-App, serverseitig mitbenutzt – derselbe Code, der im
// Browser Objekte schreibt und Y-Felder liest (React-frei). Typprüfung mit tsconfig.web.json.
import * as Y from 'yjs';
import { NATIVE_OBJECT_TYPES, NATIVE_Y_FIELDS } from '../../../shared/native';
import { RICH_TEXT_FIELD } from '../../../shared/protocol';
import { BoardStore, compareObjects, normalize, registerYField, yFieldCodec, type NewObject, type Patch, type Snapshot } from '../../../web/src/board/store';
import { registerTypeInfo } from '../../../web/src/board/types';
import { compareKeys, keysAbove, keysBelow } from '../../../web/src/board/fractional';
import { contentCodec, fragmentToJson, isDoc, plainOf, textToDoc, type PMDoc } from '../../../web/src/features/richtext/doc';
// registrieren beim Import die Codecs ihrer Y-Felder (table, timeline, docPages)
import '../../../web/src/features/structure/table/yjs';
import '../../../web/src/features/structure/timeline/yjs';
import '../../../web/src/features/documents/yjs';
import { addReply, commentsMap, createThread, deleteMessage, deleteThread, editMessage, readThreads, setResolved } from '../../../web/src/features/collab/comments';
import { reactionsMap } from '../../../web/src/features/collab/reactions';
import { Y_READS } from '../../../web/src/features/collab/model';
import type { BoardObject } from '../../../web/src/protocol';
import { setTextMeasure } from '../../../web/src/editor/measureText';
import { addChild, addSibling, commitMind, dropNodes, isMind, layoutPatches, newRoot, toggleCollapse, withDescendants } from '../../../web/src/features/structure/mindmap/ops';
import { MIND_COLORS, mindSize } from '../../../web/src/features/structure/mindmap/style';
import { measureText } from '../../../web/src/editor/measureText';
// alle Web-Aktionen der Pakete (Sammel-Import, Vertrag §8.12)
import { nativeAction, nativeActionList } from '../../../web/src/native/actions';
import type { NativeActionCtx } from '../../../web/src/native/registry';
import { nanoid } from 'nanoid';
import { metricsMeasure } from './text-metrics';
import { privateRoute } from '../../../web/src/features/private/route';
import { applyText, mergeText } from './ytext-merge';
import type { MindTreeSpec, WebActCheck, WebActInput, WebCollab, WebMind, WebModel, WebStore } from './web-api';

// Textbreiten wie im Browser (Mindmap-Größen): Schriftmaße aus dem Chromium statt Canvas
setTextMeasure(metricsMeasure);

/** Kommentare und Reaktionen mit dem Code des Web-Moduls collab (gleiche Y-Strukturen, gleiche Undo-Schritte). */
function collabOf(store: BoardStore): WebCollab {
  return {
    thread(id) {
      const t = readThreads(commentsMap(store)).find((x) => x.id === id);
      return t ? { createdBy: t.createdBy, messages: t.messages.map((m) => ({ id: m.id, by: m.by })) } : null;
    },
    createThread: (at, who, text, mentions, ids) => void createThread(store, at, who, text, mentions, ids),
    addReply: (thread, who, text, mentions, msgId) => addReply(store, thread, who, text, mentions, msgId),
    editMessage: (thread, msg, text, mentions) => editMessage(store, thread, msg, text, mentions),
    deleteMessage: (thread, msg) => deleteMessage(store, thread, msg),
    deleteThread: (thread) => deleteThread(store, thread),
    setResolved: (thread, resolved, by) => setResolved(store, thread, resolved, by),
    react(ids, emoji, on, who) {
      const map = reactionsMap(store);
      const at = new Date().toISOString();
      store.stopCapturing();
      store.transact(() => {
        for (const o of ids) {
          const k = `${o}|${emoji}|${who.key}`;
          if (!on) map.delete(k);
          else if (!map.has(k)) map.set(k, { o, e: emoji, u: who.key, n: who.name, at });
        }
      });
      store.stopCapturing();
    },
    markRead(userKey, at) {
      const reads = store.extMap<string>(Y_READS, { undo: false });
      const cur = reads.get(userKey);
      if (typeof cur !== 'string' || cur < at) reads.set(userKey, at);
    },
  };
}

/** Höchster Ebenen-Schlüssel im Live-Stand. */
function liveTopZ(store: BoardStore): string | null {
  let top: string | null = null;
  store.objects.forEach((m) => {
    const z = m instanceof Y.Map ? m.get('z') : undefined;
    if (typeof z === 'string' && z && (top === null || z > top)) top = z;
  });
  return top;
}

/**
 * Sicht des Mindmap-Codes auf den Store: Schnappschuss der Mindmap-Knoten aus dem **Live-Stand** (der Store-Schnappschuss
 * ist innerhalb der Transaktion einer ops-Nachricht veraltet), Ebenen-Schlüssel neuer Knoten ebenso, keine eigenen
 * Undo-Schritte (die Nachricht ist einer, die App teilt mit `step`).
 */
function liveMindStore(store: BoardStore): BoardStore {
  const snapshot = (): Snapshot => {
    const list: BoardObject[] = [];
    store.objects.forEach((m, id) => {
      if (!(m instanceof Y.Map) || m.get('type') !== 'mindnode') return;
      const raw: Record<string, unknown> = {};
      m.forEach((v, k) => (raw[k] = v instanceof Y.AbstractType ? v.toJSON() : v));
      const o = normalize(id, raw);
      if (o) list.push(o);
    });
    list.sort(compareObjects);
    return { version: 0, byId: new Map(list.map((o) => [o.id, o])), ordered: list, rank: new Map(list.map((o, i) => [o.id, i])), topZ: null, bottomZ: null };
  };
  const view = {
    getSnapshot: snapshot,
    transact: (fn: () => void) => store.transact(fn),
    create: (o: NewObject) => store.createMany([{ ...o, z: keysAbove(liveTopZ(store), 1)[0] }])[0],
    updateMany: (p: Record<string, Patch>) => store.updateMany(p),
    remove: (ids: Iterable<string>) => store.remove(ids),
    stopCapturing: () => {},
  };
  return view as unknown as BoardStore;
}

/** Mindmap-Ops der Native-API mit dem Code des Web-Moduls structure (ops.ts). */
function mindOf(store: BoardStore): WebMind {
  const view = liveMindStore(store);
  const node = (id: string) => {
    if (!isNode(id)) return undefined;
    const o = view.getSnapshot().byId.get(id);
    return isMind(o) ? o : undefined;
  };
  /** ohne Schnappschuss (billig, auch für viele IDs) */
  const isNode = (id: string) => {
    const m = store.objects.get(id);
    return m instanceof Y.Map && m.get('type') === 'mindnode';
  };
  const exists = (id: string) => store.objects.has(id);
  const nodes = (ids: string[]) => [...new Set(ids)].filter(isNode);
  const layout = (ids: string[]) => {
    const live = nodes(ids);
    if (live.length) commitMind(view, { patch: Object.fromEntries(live.map((id) => [id, {}])) });
  };
  return {
    child(id, newId, side) {
      const o = node(id);
      if (!o || exists(newId)) return false;
      addChild(view, o, side, newId);
      return true;
    },
    sibling(id, newId) {
      const o = node(id);
      if (!o || exists(newId)) return false;
      return addSibling(view, o, newId) !== null;
    },
    root(newId, x, y, text) {
      if (exists(newId)) return false;
      commitMind(view, { add: [newRoot({ x, y }, text, newId)] });
      return true;
    },
    tree(newId, x, y, spec) {
      if (exists(newId)) return false;
      // wie TemplateBuilder.mind (web/src/features/structure/templates/build.ts): Farben der Hauptthemen der Reihe nach
      const nodes: BoardObject[] = [];
      let n = 0;
      const walk = (s: MindTreeSpec, parent: string | undefined, level: number, color: string, order: number) => {
        const id = parent ? `${newId}-${++n}` : newId;
        const size = mindSize(s.text, level);
        const mind = { ...(parent ? { parent, order } : { level: 0 }), ...(level === 1 ? { side: s.side ?? 'r' } : {}) };
        nodes.push({ id, type: 'mindnode', x: 0, y: 0, ...size, z: '', createdBy: '', updatedAt: '', text: s.text, color, mind } as BoardObject);
        (s.children ?? []).forEach((k, i) => walk(k, id, level + 1, level === 0 ? MIND_COLORS[i % MIND_COLORS.length]! : color, i));
      };
      walk(spec, undefined, 0, '#0a0a0a', 0);
      const root = nodes[0]!;
      const at = { x: Math.round(x - root.w / 2), y: Math.round(y - root.h / 2) };
      const placed = nodes.map((o) => ({ ...o, ...at }));
      if (nodes.some((o) => exists(o.id))) return false;
      const lay = layoutPatches(placed);
      const keys = keysAbove(liveTopZ(store), placed.length);
      store.createMany(
        placed.map((o, i) => {
          const { createdBy: _c, updatedAt: _u, ...rest } = { ...o, ...lay[o.id] };
          return { ...rest, z: keys[i] } as NewObject;
        }),
      );
      return true;
    },
    text(id, text) {
      if (node(id)) commitMind(view, { patch: { [id]: { text } } });
    },
    collapse(id, collapsed) {
      const o = node(id);
      if (o && !!o.mind?.collapsed !== collapsed) toggleCollapse(view, o);
    },
    remove(ids) {
      const live = nodes(ids);
      if (live.length) commitMind(view, { remove: withDescendants(view.getSnapshot(), live) });
    },
    drop(ids) {
      const live = nodes(ids);
      if (!live.length) return;
      dropNodes(view, live);
      layout(live);
    },
    layout,
    isNode,
    isRoot(id) {
      // wie isRootNode/rootOf in ops.ts: kein (gültiger) Elternknoten
      if (!isNode(id)) return false;
      const mind = store.objects.get(id)!.get('mind') as { parent?: unknown } | undefined;
      const p = mind && typeof mind === 'object' ? mind.parent : undefined;
      return typeof p !== 'string' || !p || p === id || !isNode(p);
    },
  };
}

/** Web-Aktion ausführen (Vertrag §8.12): Kontext wie im Registry-Vertrag, Ergebnis `{}`, wenn die Aktion nichts meldet. */
function actOf(store: BoardStore) {
  return (name: string, args: Record<string, unknown>, input: WebActInput) => {
    const def = nativeAction(name, { dev: input.dev });
    if (!def) throw new Error(`Web-Aktion ${name} gibt es nicht`);
    const base = input.key ?? nanoid(12);
    const ctx: NativeActionCtx = {
      user: input.user,
      now: new Date().toISOString(),
      v: input.v,
      id: (n) => `${base}-${n}`,
      exists: (id) => store.objects.has(id),
      measure: (text, fs, weight, italic, family) => measureText(text, fs, weight, italic, family),
      text: { merge: mergeText, apply: applyText },
    };
    return def.run(store, args, ctx) ?? {};
  };
}

function checkAction(name: string, args: Record<string, unknown>, v: number, dev: boolean): WebActCheck {
  const def = nativeAction(name, { dev });
  if (!def) return { ok: false, error: 'unsupported', message: `Unbekannte Web-Aktion „${name.slice(0, 64)}“.` };
  const version = def.version ?? 1;
  if (v > version) return { ok: false, error: 'unsupported', message: `Web-Aktion „${name}“ gibt es hier nur in Version ${version}.` };
  const parsed = def.args(args, v);
  if (!parsed.ok) return { ok: false, error: 'invalid_input', message: `${name}: ${parsed.error}` };
  const cost = def.cost ? def.cost(parsed.args) : 1;
  return { ok: true, undo: def.undo, cost: Number.isFinite(cost) && cost >= 1 ? Math.ceil(cost) : 1, args: parsed.args as Record<string, unknown> };
}

// Rich-Text wie das Modul richtext (ohne Editor): Lesekopie = ProseMirror-JSON, Anlegen baut ein Fragment
registerYField(RICH_TEXT_FIELD, contentCodec);
// Alle Objekttypen des Web bekannt machen (sonst blendet der Store sie aus); Angaben wie Rahmen „unten“ bleiben
for (const type of NATIVE_OBJECT_TYPES) registerTypeInfo(type);

export const WEB: WebModel = {
  createStore(doc, userKey, origin): WebStore {
    const store = new BoardStore(doc, userKey, { origin });
    return {
      undoManager: store.undoManager,
      createMany: (list) => store.createMany(list as unknown as NewObject[]),
      updateMany: (patches) => store.updateMany(patches as Record<string, Patch>),
      remove: (ids) => store.remove(ids),
      bringToFront: (ids) => store.bringToFront(ids),
      sendToBack: (ids) => store.sendToBack(ids),
      transact: (fn) => store.transact(fn),
      undo: () => store.undo(),
      redo: () => store.redo(),
      stopCapturing: () => store.stopCapturing(),
      getHistory: () => store.getHistory(),
      subscribeHistory: (fn) => store.subscribeHistory(fn),
      destroy: () => store.destroy(),
      attachPrivate(pdoc, mainDoc) {
        store.attachPrivate(pdoc);
        store.setCreateRoute(privateRoute(mainDoc));
      },
      mapOf: (id) => store.mapOf(id),
      has: (id) => store.has(id),
      isPrivate: (id) => store.isPrivate(id),
      collab: collabOf(store),
      mind: mindOf(store),
      act: actOf(store),
    };
  },
  yFieldToJson(field, value) {
    const codec = yFieldCodec(field);
    return codec ? codec.toPlain(value) : undefined;
  },
  yFieldNames: () => Object.keys(NATIVE_Y_FIELDS).filter((f) => !!yFieldCodec(f)),
  fragmentToJson: (f: Y.XmlFragment) => fragmentToJson(f),
  isDoc,
  plainOf: (doc) => (isDoc(doc) ? plainOf(doc as PMDoc) : ''),
  textToDoc,
  compareKeys,
  keysAbove,
  keysBelow,
  actionList: (dev) => nativeActionList({ dev }),
  checkAction,
};
