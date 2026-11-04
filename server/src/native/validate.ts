// Prüfung der Ops der App (docs/contract.md §8.6), bevor irgendetwas ins Dokument geschrieben wird: bekannte Felder mit
// Typ und Grenzen, unbekannte nur mit Modul-Präfix, Größen- und Anzahl-Grenzen. Verstoß → nack invalid_input mit
// Index der Op, nichts halb geschrieben.
import { NATIVE_ACT_KEY_RE, NATIVE_ACT_NAME_RE, NATIVE_LIMITS, NATIVE_MIND_LIMITS, type NativeMindTree, type NativeOp } from '../../../shared/native.js';
import { WEB } from '#stachel-web';

export class OpError extends Error {
  constructor(
    readonly error: 'invalid_input' | 'unsupported' | 'too_large',
    message: string,
    readonly index?: number,
  ) {
    super(message);
  }
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TYPE_RE = /^[a-z][A-Za-z0-9_.-]{0,31}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Felder mit Modul-Präfix (`tasks.taskId`) – erlaubt, solange sie JSON sind */
const PREFIXED_RE = /^[a-z][A-Za-z0-9]{0,31}\.[A-Za-z0-9_-]{1,64}$/;
const MAX_OBJECT_JSON = 256 * 1024;
const MAX_DEPTH = 10;
const COORD = 10_000_000;
const SIZE = 1_000_000;
const TEXT = NATIVE_LIMITS.maxTextLength;
/** Kommentar-Text (das Web begrenzt nicht; großzügig, aber endlich) */
const COMMENT_TEXT = 5000;
const MAX_MENTIONS = 50;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

type Check = (v: unknown) => boolean;

const num = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int = (min: number, max: number): Check => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const bool: Check = (v) => typeof v === 'boolean';
const str = (max: number): Check => (v) => typeof v === 'string' && v.length <= max;
const oneOf = (...xs: string[]): Check => (v) => typeof v === 'string' && xs.includes(v);
const color: Check = (v) => typeof v === 'string' && COLOR_RE.test(v);
const id: Check = (v) => typeof v === 'string' && ID_RE.test(v);
const date: Check = (v) => typeof v === 'string' && DATE_RE.test(v);
const obj: Check = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const json: Check = (v) => v !== undefined;
const arrayOf = (max: number, item: Check): Check => (v) => Array.isArray(v) && v.length <= max && v.every(item);
const end: Check = (v) => {
  if (!obj(v)) return false;
  const e = v as Record<string, unknown>;
  if ('objectId' in e) return id(e.objectId) && (e.side === undefined || oneOf('n', 'e', 's', 'w')(e.side));
  return num(-COORD, COORD)(e.x) && num(-COORD, COORD)(e.y);
};
const tag: Check = (v) => obj(v) && str(60)((v as { label?: unknown }).label) && ((v as { color?: unknown }).color === undefined || color((v as { color?: unknown }).color));
const person: Check = (v) => obj(v) && str(200)((v as { key?: unknown }).key) && str(200)((v as { name?: unknown }).name);
const pmDoc: Check = (v) => obj(v) && (v as { type?: unknown }).type === 'doc' && Array.isArray((v as { content?: unknown }).content);

/** Bekannte Felder (shared/protocol.ts + docs/features/*.md). */
export const FIELDS: Record<string, Check> = {
  x: num(-COORD, COORD),
  y: num(-COORD, COORD),
  w: (v) => num(0, SIZE)(v) && (v as number) > 0,
  h: (v) => num(0, SIZE)(v) && (v as number) > 0,
  rotation: num(-36_000, 36_000),
  color,
  stroke: color,
  strokeWidth: num(0, 1000),
  text: str(TEXT),
  content: pmDoc,
  fontSize: num(1, 2000),
  fontFamily: str(40),
  shape: str(40),
  from: end,
  to: end,
  arrowStart: bool,
  arrowEnd: bool,
  capStart: str(32),
  capEnd: str(32),
  lineStyle: oneOf('straight', 'elbow', 'curved'),
  dash: oneOf('solid', 'dashed', 'dotted'),
  labelPos: num(0, 1),
  points: arrayOf(200_000, num(-COORD, COORD)),
  imageId: id,
  title: str(300),
  locked: bool,
  groupId: id,
  bold: bool,
  italic: bool,
  strike: bool,
  align: oneOf('left', 'center', 'right'),
  valign: oneOf('top', 'middle', 'bottom'),
  autoWidth: bool,
  fillOpacity: num(0, 1),
  // shapes: Sticker, Icon
  emoji: str(32),
  stamp: str(32),
  icon: str(64),
  iconNode: json,
  // structure: Karte, Tabelle, Mindmap, Rahmen
  desc: str(TEXT),
  assignee: person,
  due: date,
  tags: arrayOf(20, tag),
  status: str(20),
  table: obj,
  tableHead: oneOf('row', 'col', 'both', 'none'),
  mind: obj,
  slide: str(64),
  frameGrid: num(0, 10_000),
  frameGridLabels: bool,
  // Präsentation: Sprechernotizen je Rahmen (docs/features/private.md §7)
  notes: str(TEXT),
  // Zeitleiste
  timeline: obj,
  tlStart: date,
  tlEnd: date,
  tlUnit: oneOf('day', 'week', 'month'),
  // documents
  docFile: id,
  docName: str(300),
  docCount: int(0, 10_000),
  docPage: int(0, 10_000),
  docPages: (v) => obj(v) && Object.entries(v as object).every(([k, x]) => /^\d{1,4}$/.test(k) && id(x)),
  docRatios: arrayOf(10_000, num(0, 1000)),
  // tools
  hidden: bool,
  marker: bool,
  linkTo: id,
};

/** Werden vom Server gesetzt bzw. nur über eigene Ops geändert. */
const FIXED_ON_UPDATE = new Set(['id', 'type', 'createdBy', 'updatedAt', 'z']);
const FIXED_ON_CREATE = new Set(['createdBy', 'updatedAt', 'z']);

function depthOk(v: unknown, d = 0): boolean {
  if (d > MAX_DEPTH) return false;
  if (Array.isArray(v)) return v.every((x) => depthOk(x, d + 1));
  if (v && typeof v === 'object') return Object.values(v).every((x) => depthOk(x, d + 1));
  return true;
}

/** Ein Feld prüfen; Fehlertext oder null. `null` als Wert (Feld entfernen) nur bei update. */
function fieldError(k: string, v: unknown, allowNull: boolean): string | null {
  if (v === null) return allowNull ? null : `Feld „${k}“ darf beim Anlegen nicht null sein.`;
  const check = FIELDS[k];
  if (check) return check(v) ? null : `Ungültiger Wert für „${k}“.`;
  if (!PREFIXED_RE.test(k)) return `Unbekanntes Feld „${k}“ (eigene Felder nur mit Modul-Präfix, z. B. „tasks.taskId“).`;
  if (typeof v === 'string' && v.length > TEXT) return `„${k}“ ist zu lang.`;
  return null;
}

function objectError(o: Record<string, unknown>, create: boolean): string | null {
  for (const [k, v] of Object.entries(o)) {
    if (create ? FIXED_ON_CREATE.has(k) : FIXED_ON_UPDATE.has(k)) return `Feld „${k}“ setzt der Server.`;
    if (create && (k === 'id' || k === 'type')) continue;
    const e = fieldError(k, v, !create);
    if (e) return e;
  }
  if (!depthOk(o)) return 'Zu tief verschachtelt.';
  if (JSON.stringify(o).length > MAX_OBJECT_JSON) return 'Objekt zu groß.';
  return null;
}

/** Tiefe eines Rich-Text-Dokuments (verschachtelte Listen brauchen mehr als die Objekt-Felder) */
const MAX_DOC_DEPTH = 64;

/** Plausibilität eines ProseMirror-Dokuments der App; Fehlertext oder null. */
function docError(v: unknown): string | null {
  if (!pmDoc(v)) return 'Rich-Text muss ein Dokument {type:"doc", content:[…]} sein.';
  let chars = 0;
  const bad = (n: unknown, d: number): string | null => {
    if (d > MAX_DOC_DEPTH) return 'Rich-Text zu tief verschachtelt.';
    if (!obj(n) || typeof (n as { type?: unknown }).type !== 'string') return 'Rich-Text-Knoten ohne `type`.';
    const node = n as { type: string; text?: unknown; content?: unknown; marks?: unknown; attrs?: unknown };
    if (node.type === 'text') {
      if (typeof node.text !== 'string') return 'Textknoten ohne `text`.';
      chars += node.text.length;
    }
    if (node.attrs !== undefined && !obj(node.attrs)) return 'Ungültige `attrs`.';
    if (node.marks !== undefined && !(Array.isArray(node.marks) && node.marks.every((m) => obj(m) && typeof (m as { type?: unknown }).type === 'string'))) return 'Ungültige `marks`.';
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return '`content` muss eine Liste sein.';
      for (const c of node.content) {
        const e = bad(c, d + 1);
        if (e) return e;
      }
    }
    return null;
  };
  for (const c of (v as { content: unknown[] }).content) {
    const e = bad(c, 1);
    if (e) return e;
  }
  if (chars > TEXT) return 'Text ist zu lang.';
  if (JSON.stringify(v).length > MAX_OBJECT_JSON) return 'Rich-Text zu groß.';
  return null;
}

/** Prüft eine ops-Nachricht vollständig; wirft OpError (mit Index der Op). `dev` = Sandbox-Aktionen erlaubt. */
export function validateOps(raw: unknown, opts: { dev?: boolean } = {}): NativeOp[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new OpError('invalid_input', '`ops` muss eine nicht leere Liste sein.');
  let entries = 0;
  const out: NativeOp[] = [];
  raw.forEach((op: unknown, i) => {
    const fail = (msg: string): never => {
      throw new OpError('invalid_input', msg, i);
    };
    if (!obj(op)) fail('Op ist kein Objekt.');
    const o = op as Record<string, unknown>;
    switch (o.op) {
      case 'create': {
        if (!Array.isArray(o.objects) || !o.objects.length) fail('`objects` fehlt.');
        const list = o.objects as unknown[];
        entries += list.length;
        for (const x of list) {
          if (!obj(x)) fail('Objekt ist kein Objekt.');
          const n = x as Record<string, unknown>;
          if (!id(n.id)) fail('`id` fehlt oder ist ungültig ([A-Za-z0-9_-]{1,64}).');
          if (typeof n.type !== 'string' || !TYPE_RE.test(n.type)) fail('`type` fehlt oder ist ungültig.');
          for (const k of ['x', 'y', 'w', 'h']) if (n[k] === undefined) fail(`\`${k}\` fehlt.`);
          const e = objectError(n, true);
          if (e) fail(e);
        }
        out.push({ op: 'create', objects: list as never });
        break;
      }
      case 'update': {
        if (!obj(o.patches)) fail('`patches` fehlt.');
        const patches = o.patches as Record<string, unknown>;
        const keys = Object.keys(patches);
        if (!keys.length) fail('`patches` ist leer.');
        entries += keys.length;
        for (const [pid, p] of Object.entries(patches)) {
          if (!ID_RE.test(pid)) fail(`Ungültige Objekt-ID „${pid.slice(0, 80)}“.`);
          if (!obj(p) || !Object.keys(p as object).length) fail('Leerer Patch.');
          const e = objectError(p as Record<string, unknown>, false);
          if (e) fail(e);
        }
        out.push({ op: 'update', patches: patches as never });
        break;
      }
      case 'remove':
      case 'order': {
        if (!Array.isArray(o.ids) || !o.ids.length || !o.ids.every(id)) fail('`ids` fehlt oder enthält ungültige IDs.');
        entries += (o.ids as unknown[]).length;
        if (o.op === 'order') {
          if (o.to !== 'front' && o.to !== 'back') fail('`to` ist „front“ oder „back“.');
          out.push({ op: 'order', ids: o.ids as string[], to: o.to as 'front' | 'back' });
        } else out.push({ op: 'remove', ids: o.ids as string[] });
        break;
      }
      case 'text': {
        if (!id(o.id)) fail('`id` fehlt oder ist ungültig.');
        if (!Number.isSafeInteger(o.base) || (o.base as number) < 0) fail('`base` muss eine Revision (ganze Zahl ≥ 0) sein.');
        if (o.epoch !== undefined && !str(64)(o.epoch)) fail('`epoch` ist ungültig.');
        const e = docError(o.doc) ?? (o.baseDoc === undefined ? null : docError(o.baseDoc));
        if (e) fail(e);
        entries += 1;
        out.push({ op: 'text', id: o.id as string, base: o.base as number, doc: o.doc, ...(o.epoch !== undefined ? { epoch: o.epoch as string } : {}), ...(o.baseDoc !== undefined ? { baseDoc: o.baseDoc } : {}) });
        break;
      }
      case 'comment':
      case 'reply':
      case 'commentEdit': {
        if (!id(o.thread)) fail('`thread` fehlt oder ist ungültig.');
        if (!id(o.msg)) fail('`msg` fehlt oder ist ungültig.');
        if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > COMMENT_TEXT) fail(`\`text\` fehlt oder ist länger als ${COMMENT_TEXT} Zeichen.`);
        const mentions = o.mentions === undefined ? [] : o.mentions;
        if (!arrayOf(MAX_MENTIONS, str(200))(mentions)) fail(`\`mentions\`: höchstens ${MAX_MENTIONS} Personen-Schlüssel.`);
        const base = { thread: o.thread as string, msg: o.msg as string, text: o.text as string, mentions: [...new Set(mentions as string[])] };
        if (o.op === 'comment') {
          const at = o.at as Record<string, unknown> | undefined;
          if (!obj(at) || !num(-COORD, COORD)(at!.x) || !num(-COORD, COORD)(at!.y)) fail('`at` braucht x und y.');
          if (at!.objectId !== undefined && !id(at!.objectId)) fail('`at.objectId` ist ungültig.');
          for (const k of ['dx', 'dy']) if (at![k] !== undefined && !num(-COORD, COORD)(at![k])) fail(`\`at.${k}\` ist ungültig.`);
          const anchor = { x: at!.x as number, y: at!.y as number, ...(typeof at!.objectId === 'string' ? { objectId: at!.objectId, dx: (at!.dx as number) ?? 0, dy: (at!.dy as number) ?? 0 } : {}) };
          out.push({ op: 'comment', ...base, at: anchor });
        } else out.push({ op: o.op, ...base });
        entries += 1;
        break;
      }
      case 'commentDelete':
        if (!id(o.thread)) fail('`thread` fehlt oder ist ungültig.');
        if (o.msg !== undefined && !id(o.msg)) fail('`msg` ist ungültig.');
        out.push({ op: 'commentDelete', thread: o.thread as string, ...(o.msg !== undefined ? { msg: o.msg as string } : {}) });
        entries += 1;
        break;
      case 'resolve':
        if (!id(o.thread)) fail('`thread` fehlt oder ist ungültig.');
        if (!bool(o.resolved)) fail('`resolved` muss true oder false sein.');
        out.push({ op: 'resolve', thread: o.thread as string, resolved: o.resolved as boolean });
        entries += 1;
        break;
      case 'react':
        if (!Array.isArray(o.ids) || !o.ids.length || !o.ids.every(id)) fail('`ids` fehlt oder enthält ungültige IDs.');
        if (typeof o.emoji !== 'string' || !o.emoji || o.emoji.length > 16 || o.emoji.includes('|')) fail('`emoji` fehlt oder ist ungültig.');
        if (!bool(o.on)) fail('`on` muss true oder false sein.');
        entries += (o.ids as unknown[]).length;
        out.push({ op: 'react', ids: [...new Set(o.ids as string[])], emoji: o.emoji as string, on: o.on as boolean });
        break;
      case 'mentionsRead':
        if (o.at !== undefined && !(typeof o.at === 'string' && ISO_RE.test(o.at))) fail('`at` muss eine ISO-Zeit (UTC) sein.');
        out.push({ op: 'mentionsRead', ...(o.at !== undefined ? { at: o.at as string } : {}) });
        entries += 1;
        break;
      case 'mind':
        entries += mindEntries(o, fail);
        out.push(o as NativeOp);
        break;
      case 'act': {
        // Web-Aktion (§8.12): Name/Version/args prüft die Aktion selbst (web/src/native/registry.ts)
        for (const k of Object.keys(o)) if (!['op', 'name', 'args', 'key', 'v'].includes(k)) fail(`Unbekanntes Feld „${k.slice(0, 40)}“ in der Op act.`);
        if (typeof o.name !== 'string' || o.name.length > 64 || !NATIVE_ACT_NAME_RE.test(o.name)) fail('`name` fehlt oder ist ungültig (<modul>.<aktion>).');
        if (o.args !== undefined && !obj(o.args)) fail('`args` muss ein Objekt sein.');
        if (o.key !== undefined && !(typeof o.key === 'string' && NATIVE_ACT_KEY_RE.test(o.key))) fail('`key` ist ungültig ([A-Za-z0-9_-]{1,40}).');
        if (o.v !== undefined && !int(1, 1000)(o.v)) fail('`v` muss eine ganze Zahl ≥ 1 sein.');
        const args = (o.args ?? {}) as Record<string, unknown>;
        if (!depthOk(args)) fail('`args` zu tief verschachtelt.');
        if (JSON.stringify(args).length > MAX_OBJECT_JSON) fail('`args` zu groß.');
        const v = (o.v as number | undefined) ?? 1;
        const checked = WEB.checkAction(o.name as string, args, v, !!opts.dev);
        if (!checked.ok) throw new OpError(checked.error, checked.message, i);
        entries += checked.cost;
        out.push({ op: 'act', name: o.name as string, args: checked.args, ...(o.key !== undefined ? { key: o.key as string } : {}), ...(o.v !== undefined ? { v } : {}) });
        break;
      }
      default:
        throw new OpError('unsupported', `Unbekannte Op „${String(o.op).slice(0, 40)}“.`, i);
    }
    if (entries > NATIVE_LIMITS.maxOps) throw new OpError('too_large', `Höchstens ${NATIVE_LIMITS.maxOps} Einträge je Nachricht.`, i);
  });
  return out;
}

/** Mindmap-Op (§8.6 `mind`) prüfen; liefert die Zahl der Einträge (für maxOps). */
function mindEntries(o: Record<string, unknown>, fail: (msg: string) => never): number {
  const known = new Set(['op', 'do', 'id', 'new', 'side', 'x', 'y', 'text', 'tree', 'collapsed', 'ids']);
  for (const k of Object.keys(o)) if (!known.has(k)) fail(`Unbekanntes Feld „${k.slice(0, 40)}“ in der Mindmap-Op.`);
  const needId = () => id(o.id) || fail('`id` fehlt oder ist ungültig.');
  const needNew = () => id(o.new) || fail('`new` (ID des neuen Knotens) fehlt oder ist ungültig.');
  const needAt = () => (num(-COORD, COORD)(o.x) && num(-COORD, COORD)(o.y)) || fail('`x`/`y` fehlen oder sind ungültig.');
  switch (o.do) {
    case 'child':
      needId();
      needNew();
      if (o.side !== undefined && o.side !== 'l' && o.side !== 'r') fail('`side` ist „l“ oder „r“.');
      return 1;
    case 'sibling':
      needId();
      needNew();
      return 1;
    case 'root':
      needNew();
      needAt();
      if (!str(TEXT)(o.text)) fail('`text` fehlt oder ist zu lang.');
      return 1;
    case 'tree': {
      needNew();
      needAt();
      let count = 0;
      const walk = (t: unknown, depth: number) => {
        if (depth > NATIVE_MIND_LIMITS.maxDepth) fail(`Zu tief verschachtelt (höchstens ${NATIVE_MIND_LIMITS.maxDepth} Ebenen).`);
        if (!obj(t)) fail('Knoten im `tree` ist kein Objekt.');
        const n = t as Partial<NativeMindTree> & Record<string, unknown>;
        if (!str(NATIVE_MIND_LIMITS.maxText)(n.text)) fail(`Jeder Knoten braucht \`text\` (höchstens ${NATIVE_MIND_LIMITS.maxText} Zeichen).`);
        if (n.side !== undefined && n.side !== 'l' && n.side !== 'r') fail('`side` ist „l“ oder „r“.');
        if (++count > NATIVE_MIND_LIMITS.maxNodes) fail(`Zu viele Knoten (höchstens ${NATIVE_MIND_LIMITS.maxNodes}).`);
        if (n.children !== undefined) {
          if (!Array.isArray(n.children)) fail('`children` muss eine Liste sein.');
          for (const k of n.children as unknown[]) walk(k, depth + 1);
        }
      };
      walk(o.tree, 1);
      return count;
    }
    case 'text':
      needId();
      if (!str(TEXT)(o.text)) fail('`text` fehlt oder ist zu lang.');
      return 1;
    case 'collapse':
      needId();
      if (!bool(o.collapsed)) fail('`collapsed` muss true oder false sein.');
      return 1;
    case 'remove':
    case 'drop':
    case 'layout':
      if (!Array.isArray(o.ids) || !o.ids.length || !o.ids.every(id)) fail('`ids` fehlt oder enthält ungültige IDs.');
      return (o.ids as unknown[]).length;
    default:
      return fail(`Unbekannte Mindmap-Aktion „${String(o.do).slice(0, 40)}“ (child, sibling, root, tree, text, collapse, remove, drop, layout).`);
  }
}
