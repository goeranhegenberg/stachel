// Person vergessen (Konto löschen im Modus local, „Meine Daten bei Stachel löschen“ im Modus org;
// docs/contract.md §6, docs/features/accounts.md): persönliche API-Tokens weg, Posteingang weg, und überall, wo der
// Name auf Boards steht, die bleiben (Kommentare, Reaktionen, Stimmen, Abstimmung, Timer, „zuständig“-Liste,
// Versionsverlauf inkl. der gesicherten Stände, Ersteller:in von Boards, Erwähnungen anderer), steht danach
// „Gelöschtes Konto“. Der user_key bleibt als Kennung (zufällig, ohne Bezug zur Person), damit Threads zusammenhängen.
// Web und App lesen dieselben Y-Strukturen, die Native-API spiegelt die Änderung wie jede andere.
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import { boardDocName } from '../../shared/protocol.js';
import type { Db } from './db.js';
import { compactState, packState, unpackState } from './versions.js';

export const DELETED_NAME = 'Gelöschtes Konto';

const COMMENTS = 'collab.comments';
const REACTIONS = 'collab.reactions';
const VOTE = 'collab.vote';
const VOTES = 'collab.votes';
const TIMER = 'collab.timer';
const PEOPLE = 'structure.people';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !(v instanceof Y.AbstractType);
const mapOf = (doc: Y.Doc, name: string): Y.Map<unknown> | null => {
  const t = doc.share.get(name);
  if (!t) return null;
  try {
    return doc.getMap(name);
  } catch {
    return null; // anderer Typ unter dem Namen: nicht anfassen
  }
};

/** Wer ist die Person: user_key, ihr KI-Assistent `ai:<key>` (Name „KI (für …)“, §7) und ihr bisheriger Name (Timer). */
export interface ForgetWho {
  key: string;
  name?: string;
}

/** Namen der Person in einem Board-Dokument ersetzen (eine Transaktion). Liefert die Zahl der Änderungen. */
export function anonymizeDoc(doc: Y.Doc, who: ForgetWho, label = DELETED_NAME): number {
  const aiKey = `ai:${who.key}`;
  const nameFor = (k: unknown) => (k === who.key ? label : k === aiKey ? `KI (für ${label})` : null);
  let n = 0;
  doc.transact(() => {
    // Kommentare: Nachrichten sind JSON-Einträge in Y.Array `messages`
    mapOf(doc, COMMENTS)?.forEach((t) => {
      if (!(t instanceof Y.Map)) return;
      const msgs = t.get('messages');
      if (!(msgs instanceof Y.Array)) return;
      const list = msgs.toArray();
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!isObj(m)) continue;
        const nm = nameFor(m.by);
        if (!nm || m.name === nm) continue;
        msgs.delete(i, 1);
        msgs.insert(i, [{ ...m, name: nm }]);
        n++;
      }
    });
    // Reaktionen {o, e, u, n, at}
    const reactions = mapOf(doc, REACTIONS);
    reactions?.forEach((v, k) => {
      const nm = isObj(v) ? nameFor(v.u) : null;
      if (nm && isObj(v) && v.n !== nm) {
        reactions.set(k, { ...v, n: nm });
        n++;
      }
    });
    // Abstimmung: wer sie gestartet hat; Stimmen `<sitzung>|<person>|<objekt>` → {n, name?}
    const vote = mapOf(doc, VOTE);
    const session = vote?.get('session');
    if (vote && isObj(session)) {
      const nm = nameFor(session.startedBy);
      if (nm && session.startedByName !== nm) {
        vote.set('session', { ...session, startedByName: nm });
        n++;
      }
    }
    const votes = mapOf(doc, VOTES);
    votes?.forEach((v, k) => {
      const nm = nameFor(k.split('|')[1]);
      if (nm && isObj(v) && typeof v.name === 'string' && v.name !== nm) {
        votes.set(k, { ...v, name: nm });
        n++;
      }
    });
    // Timer speichert nur den Namen (`by`)
    const timer = mapOf(doc, TIMER);
    const t = timer?.get('timer');
    if (timer && who.name && isObj(t) && t.by === who.name) {
      timer.set('timer', { ...t, by: label });
      n++;
    }
    // Karten „zuständig“: alle, die das Board geöffnet haben (key → Name)
    const people = mapOf(doc, PEOPLE);
    for (const k of [who.key, aiKey]) {
      const nm = nameFor(k)!;
      if (people?.has(k) && people.get(k) !== nm) {
        people.set(k, nm);
        n++;
      }
    }
  });
  return n;
}

/** Steht der Schlüssel überhaupt im Yjs-Stand? (Strings liegen dort als UTF-8: schneller Vorfilter) */
const mentions = (state: Uint8Array, key: string) => Buffer.from(state.buffer, state.byteOffset, state.byteLength).includes(key);

export interface ForgetDeps {
  db: Db;
  hocuspocus: Hocuspocus<any>;
  /** persönliche API-Tokens löschen und deren Verbindungen trennen (api-tokens.ts) */
  forgetTokens: (userKey: string) => void;
  /** Namen im Versionsverlauf geladener Boards (noch nicht gesicherte Änderungen), versions.ts */
  renameInVersionTracks?: (userKey: string, name: string) => void;
}

/**
 * Person vergessen. Boards selbst bleiben (Modus local: eigene Boards hat accounts.ts vorher gelöscht bzw. übertragen).
 * Liefert, wie viele Boards bzw. gesicherte Versionen geändert wurden.
 */
export async function forgetPerson(deps: ForgetDeps, who: ForgetWho, label = DELETED_NAME): Promise<{ boards: number; versions: number }> {
  const { db, hocuspocus } = deps;
  deps.forgetTokens(who.key);
  const aiKey = `ai:${who.key}`;
  const nameFor = (k: string) => (k === who.key ? label : `KI (für ${label})`);

  // Tabellen: Posteingang der Person weg, ihr Name in Erwähnungen anderer, Ersteller:in verbliebener Boards
  const hasTable = (t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
  if (hasTable('mentions')) {
    db.prepare('DELETE FROM mentions WHERE user_key = ?').run(who.key);
    db.prepare('UPDATE mentions SET by_name = ? WHERE by_key = ?').run(label, who.key);
    db.prepare('UPDATE mentions SET by_name = ? WHERE by_key = ?').run(nameFor(aiKey), aiKey);
  }
  db.prepare('UPDATE boards SET created_by_name = ? WHERE created_by = ?').run(label, who.key);

  // Live-Dokumente (geladen oder in SQLite), nur wo der Schlüssel vorkommt
  let boards = 0;
  const ids = (db.prepare('SELECT id FROM boards').all() as unknown as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    const name = boardDocName(id);
    const loaded = hocuspocus.documents.get(name);
    if (loaded) {
      if (!mentions(Y.encodeStateAsUpdate(loaded), who.key)) continue;
    } else {
      const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(name) as { state: Uint8Array } | undefined;
      if (!row || !mentions(row.state, who.key)) continue;
    }
    // ohne `user` im Kontext: taucht nicht als Person im Versionsverlauf auf
    const conn = await hocuspocus.openDirectConnection(name, { system: 'forget-person' });
    try {
      let changed = 0;
      await conn.transact((doc) => {
        changed = anonymizeDoc(doc, who, label);
      });
      if (changed) boards++;
    } finally {
      await conn.disconnect();
    }
  }

  // Versionsverlauf: Personenlisten, „gespeichert von“, gesicherte Stände
  deps.renameInVersionTracks?.(who.key, label);
  let versions = 0;
  if (hasTable('board_versions')) {
    // Stände einzeln laden (der Verlauf kann groß sein)
    const rows = db.prepare('SELECT id, people, by_key FROM board_versions').all() as unknown as { id: string; people: string; by_key: string | null }[];
    const stateOf = db.prepare('SELECT state FROM board_versions WHERE id = ?');
    for (const r of rows) {
      let people = r.people;
      try {
        const list = JSON.parse(r.people) as { key?: unknown; name?: unknown }[];
        if (Array.isArray(list) && list.some((p) => p?.key === who.key || p?.key === aiKey)) {
          people = JSON.stringify(list.map((p) => (p?.key === who.key || p?.key === aiKey ? { ...p, name: nameFor(p.key as string) } : p)));
        }
      } catch {
        // kaputtes JSON: lassen
      }
      const byName = r.by_key === who.key || r.by_key === aiKey ? nameFor(r.by_key) : null;
      let packed: Uint8Array | null = null;
      let objects: number | null = null;
      const stored = stateOf.get(r.id) as { state: Uint8Array } | undefined;
      if (!stored) continue;
      const plain = unpackState(stored.state);
      if (mentions(plain, who.key)) {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, plain);
          if (anonymizeDoc(doc, who, label)) {
            const c = compactState(doc); // ohne die gelöschten Einträge (alter Name)
            packed = packState(c.state);
            objects = c.objects;
          }
        } finally {
          doc.destroy();
        }
      }
      if (people === r.people && !byName && !packed) continue;
      db.prepare(
        `UPDATE board_versions SET people = ?, by_name = COALESCE(?, by_name), state = COALESCE(?, state),
           bytes = COALESCE(?, bytes), objects = COALESCE(?, objects) WHERE id = ?`,
      ).run(people, byName, packed, packed ? packed.length : null, objects, r.id);
      versions++;
    }
  }
  return { boards, versions };
}
