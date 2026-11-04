// Anwesenheit der App im Board (docs/contract.md §8.4): je App-Verbindung ein eigener Awareness-Eintrag (eigene
// clientID) in der Hocuspocus-Awareness des Dokuments – das Web sieht die Person wie einen weiteren Tab, mit Cursor,
// Auswahl und „schreibt hier“. Umgekehrt werden die Awareness-Einträge der anderen zu `presence`-Peers.
import type { Document } from '@hocuspocus/server';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { NATIVE_PRESENCE_EXTRA, type NativePeer } from '../../../shared/native.js';

/** Anwesenheitsfarben wie web/src/board/session.ts (PRESENCE_COLORS) – dort ist die Regel beschrieben. */
export const PRESENCE_COLORS = ['#1763b5', '#ec4e92', '#2b8a3e', '#e8590c', '#7048e8', '#0c8599', '#c92a2a', '#212529', '#ae3ec9', '#8d5524', '#5f6b7a', '#9a7b00'];

/** Awareness-Felder, die als eigene Peer-Felder erscheinen (der Rest kommt unter `extra`). */
const CORE = new Set(['user', 'cursor', 'selection', 'since', 'client', 'richtext.caret']);
const CARET = 'richtext.caret';
const VIEWPORT = 'collab.viewport';
const UPLOADS = 'collab.uploads';
const MAX_SELECTION = 200;
const ORIGIN = 'stachel:native';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: unknown): { x: number; y: number } | null => {
  const p = v as { x?: unknown; y?: unknown } | null;
  return p && typeof p === 'object' && finite(p.x) && finite(p.y) ? { x: p.x, y: p.y } : null;
};
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_SELECTION) : []);

/** Awareness-Zustand eines anderen Clients als Peer; null = ohne gültige Person. */
export function toPeer(id: number, state: unknown): NativePeer | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;
  const u = s.user as { key?: unknown; name?: unknown; color?: unknown } | undefined;
  if (!u || typeof u.key !== 'string' || !u.key || typeof u.name !== 'string') return null;
  const caret = s[CARET] as { id?: unknown } | null | undefined;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!CORE.has(k)) extra[k] = v;
  return {
    id,
    key: u.key,
    name: u.name,
    color: typeof u.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(u.color) ? u.color : PRESENCE_COLORS[0]!,
    client: s.client === 'app' ? 'app' : u.key.startsWith('ai:') ? 'ai' : 'web',
    since: finite(s.since) ? s.since : null,
    cursor: point(s.cursor),
    selection: ids(s.selection),
    editing: caret && typeof caret === 'object' && typeof caret.id === 'string' ? caret.id : null,
    extra,
  };
}

/** Alle Anwesenden außer `self`. */
export function peersOf(doc: Document, self: number | null): NativePeer[] {
  const out: NativePeer[] = [];
  doc.awareness.getStates().forEach((state, id) => {
    if (id === self) return;
    const p = toPeer(id, state);
    if (p) out.push(p);
  });
  return out.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity) || a.id - b.id);
}

/** Farbe wie im Web: eigene ältere Tabs → deren Farbe, sonst die erste, die gerade niemand anderes hat. */
export function pickColor(userKey: string, peers: readonly NativePeer[]): string {
  const own = peers.filter((p) => p.key === userKey && PRESENCE_COLORS.includes(p.color))[0];
  if (own) return own.color;
  const taken = new Set(peers.filter((p) => p.key !== userKey).map((p) => p.color));
  return PRESENCE_COLORS.find((c) => !taken.has(c)) ?? PRESENCE_COLORS[peers.length % PRESENCE_COLORS.length]!;
}

export interface PresenceInput {
  cursor?: unknown;
  selection?: unknown;
  editing?: unknown;
  viewport?: unknown;
  uploads?: unknown;
  /** Awareness-Felder der Feature-Module (§8.4 `presence.extra`), je Schlüssel; null = entfernen */
  extra?: unknown;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const rect = (v: unknown) => {
  const r = v as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
  return r && typeof r === 'object' && finite(r.x) && finite(r.y) && finite(r.w) && finite(r.h) && r.w >= 0 && r.h >= 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
};
const count = (v: unknown, max = 1_000_000) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/**
 * Wert eines `presence.extra`-Felds der App prüfen und so formen, wie das Web es setzt (web/src/features/collab/model.ts
 * AW_*, structure/frames/present.ts); undefined = ungültig (wird ignoriert). Positivliste NATIVE_PRESENCE_EXTRA.
 */
export function extraValue(key: string, v: unknown, now = Date.now()): unknown {
  switch (key) {
    case 'collab.status':
      return v === 'active' || v === 'idle' || v === 'away' ? v : undefined;
    case 'collab.follow':
      return typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined;
    case 'collab.summon': {
      // „Alle zu mir holen“: Zeit vom Server (das Web nimmt nur frische < 8 s, die Uhr des Handys kann abweichen)
      const s = v as { id?: unknown; rect?: unknown } | null;
      const r = s && typeof s === 'object' ? rect(s.rect) : null;
      return r && typeof s!.id === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(s!.id) ? { id: s!.id, rect: r, ts: now } : undefined;
    }
    case 'collab.laser': {
      const l = v as { s?: unknown; p?: unknown } | null;
      if (!l || typeof l !== 'object' || !count(l.s, Number.MAX_SAFE_INTEGER) || !Array.isArray(l.p)) return undefined;
      const p = l.p as unknown[];
      if (!(p.length <= 400 && p.length % 2 === 0 && p.every(finite))) return undefined;
      // g = Nummern, die einen neuen Strich beginnen (web/src/features/collab/laser.ts LaserMsg) – sonst verbände das
      // Web den letzten Punkt des vorigen Strichs mit dem neuen
      const g = (l as { g?: unknown }).g;
      const gaps = Array.isArray(g) && g.length <= 200 && g.every((n) => count(n, Number.MAX_SAFE_INTEGER)) ? (g as number[]) : null;
      return gaps?.length ? { s: l.s, p, g: gaps } : { s: l.s, p };
    }
    case 'collab.chat': {
      const c = v as { text?: unknown; typing?: unknown } | null;
      if (!c || typeof c !== 'object' || typeof c.text !== 'string' || c.text.length > 120) return undefined;
      if (c.typing !== undefined && typeof c.typing !== 'boolean') return undefined;
      return { text: c.text, ...(c.typing !== undefined ? { typing: c.typing } : {}) };
    }
    case 'structure.present': {
      const p = v as { frameId?: unknown; index?: unknown; total?: unknown; title?: unknown; from?: unknown } | null;
      if (!p || typeof p !== 'object' || typeof p.frameId !== 'string' || !ID_RE.test(p.frameId)) return undefined;
      if (!count(p.index, 10_000) || !count(p.total, 10_000) || typeof p.title !== 'string' || p.title.length > 300) return undefined;
      // `from` = clientId der Person, die übergeben hat (Übergabe, docs/features/private.md §7)
      const from = Number.isSafeInteger(p.from) && (p.from as number) >= 0 ? { from: p.from as number } : {};
      return { frameId: p.frameId, index: p.index, total: p.total, title: p.title, ...from };
    }
    case 'structure.handover': {
      // Angebot „Präsentation übergeben“ an eine Person
      const h = v as { to?: unknown; id?: unknown; index?: unknown; frameId?: unknown } | null;
      if (!h || typeof h !== 'object' || typeof h.to !== 'string' || !h.to || h.to.length > 200) return undefined;
      if (typeof h.id !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(h.id) || !count(h.index, 10_000)) return undefined;
      if (typeof h.frameId !== 'string' || !ID_RE.test(h.frameId)) return undefined;
      return { to: h.to, id: h.id, index: h.index, frameId: h.frameId };
    }
    default:
      return undefined;
  }
}

const EXTRA_KEYS = new Set<string>(NATIVE_PRESENCE_EXTRA);

/** Upload-Platzhalter der App prüfen (wie readUploads im Web: endliche Zahlen, Größe > 0, Farbe #hex, höchstens 10). */
function uploads(v: unknown[]): { x: number; y: number; w: number; h: number; color: string | null }[] {
  const out: { x: number; y: number; w: number; h: number; color: string | null }[] = [];
  for (const u of v.slice(0, 10)) {
    const r = u as { x?: unknown; y?: unknown; w?: unknown; h?: unknown; color?: unknown } | null;
    if (!r || typeof r !== 'object' || !finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h)) continue;
    if (r.w <= 0 || r.h <= 0 || r.w > 1e5 || r.h > 1e5) continue;
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h, color: typeof r.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : null });
  }
  return out;
}

/**
 * Eigener Awareness-Eintrag einer App-Verbindung. Eine eigene (unverbundene) Awareness hält den Zustand und erneuert
 * ihn wie ein Browser (y-protocols, alle 15 s); jede Änderung geht als Awareness-Update ins Dokument und von dort an
 * alle Verbundenen. destroy() entfernt den Eintrag sofort.
 */
export class NativePresence {
  private readonly scratchDoc = new Y.Doc();
  private readonly aw = new Awareness(this.scratchDoc);
  readonly clientId = this.scratchDoc.clientID;

  constructor(
    private readonly doc: Document,
    user: { key: string; name: string },
    readonly color: string,
  ) {
    this.aw.on('update', this.forward);
    this.aw.setLocalState({ user: { key: user.key, name: user.name, color }, cursor: null, selection: [], since: Date.now(), client: 'app' });
  }

  private forward = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = [...added, ...updated, ...removed];
    if (!changed.length) return;
    applyAwarenessUpdate(this.doc.awareness, encodeAwarenessUpdate(this.aw, changed), ORIGIN);
  };

  /** Teil-Aktualisierung aus `presence` der App (fehlend = bleibt, null = löschen); unzulässige Werte werden ignoriert. */
  update(input: PresenceInput) {
    const cur = { ...(this.aw.getLocalState() ?? {}) } as Record<string, unknown>;
    if ('cursor' in input) cur.cursor = input.cursor === null ? null : (point(input.cursor) ?? cur.cursor ?? null);
    if ('selection' in input) cur.selection = input.selection === null ? [] : ids(input.selection);
    if ('editing' in input) {
      // wie das Web (richtext.caret), nur ohne Schreibmarke: „schreibt hier“
      if (typeof input.editing === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.editing)) cur[CARET] = { id: input.editing, anchor: null, head: null };
      else if (input.editing === null) delete cur[CARET];
    }
    if ('uploads' in input) {
      // laufende Bild-Uploads (Web: „Mara lädt hoch …“ an der Stelle, docs/features/collab.md `collab.uploads`)
      const list = Array.isArray(input.uploads) ? uploads(input.uploads) : [];
      if (list.length) cur[UPLOADS] = list;
      else delete cur[UPLOADS];
    }
    if (input.extra && typeof input.extra === 'object' && !Array.isArray(input.extra)) {
      for (const [k, v] of Object.entries(input.extra as Record<string, unknown>)) {
        if (!EXTRA_KEYS.has(k)) continue;
        if (v === null) delete cur[k];
        else {
          const ok = extraValue(k, v);
          if (ok !== undefined) cur[k] = ok;
        }
      }
    }
    if ('viewport' in input) {
      const v = input.viewport as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
      if (v === null) delete cur[VIEWPORT];
      else if (v && finite(v.x) && finite(v.y) && finite(v.w) && finite(v.h) && v.w > 0 && v.h > 0) cur[VIEWPORT] = { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    this.aw.setLocalState(cur);
  }

  destroy() {
    // setzt den eigenen Zustand auf null → Update „entfernt“ geht noch ins Dokument
    this.aw.destroy();
    this.aw.off('update', this.forward);
    this.scratchDoc.destroy();
  }
}
