// Web-Gegenseite für Cross-Client-Tests der Apps (Konzept §6.4): ein Hocuspocus-Client wie der Browser, der
// JSON-Befehle zeilenweise von stdin liest und je Befehl eine JSON-Zeile auf stdout antwortet (`{"id":…,"ok":true,…}`).
// Aufruf: server/node_modules/.bin/tsx tools/web-peer.mts <stachel-url> [login] [passwort]   (Standard jonas/kaktus-123)
// Befehle (immer mit `id` zum Zuordnen der Antwort):
//   {"id":1,"cmd":"open","board":"<id>"}                       verbinden und synchronisieren
//   {"id":2,"cmd":"set","obj":"<id>","fields":{"x":40}}        Felder eines Objekts setzen (null = Feld löschen)
//   {"id":3,"cmd":"create","object":{"id":"…","type":"sticky",…}}
//   {"id":4,"cmd":"delete","obj":"<id>"}
//   {"id":5,"cmd":"awareness","fields":{"cursor":{"x":1,"y":2},"selection":["…"]}}
//   {"id":6,"cmd":"peers"}                                     Awareness der anderen ({clientId, state}[])
//   {"id":7,"cmd":"get","obj":"<id>"}                          Objekt als JSON
//   {"id":8,"cmd":"type","obj":"<id>","block":0,"at":5,"text":"…"}   in den n-ten Textblock tippen (wie y-prosemirror,
//                                                              `text` = Klartext wie das Rich-Text-Modul); `del`: so viele Zeichen ab `at` löschen
//   {"id":9,"cmd":"content","obj":"<id>"}                      Rich-Text als ProseMirror-JSON + `text`
//   {"id":10,"cmd":"caret","obj":"<id>"|null}                  „schreibt hier“ (Awareness richtext.caret)
//   {"id":11,"cmd":"comment","thread":"t1","msg":"w1","text":"…","mentions":["m:1"],"at":{"x":0,"y":0,"objectId":"…","dx":0,"dy":0}}
//                                                              Kommentar wie das Modul collab (Thread neu bzw. Antwort)
//   {"id":12,"cmd":"react","obj":"<id>","emoji":"👍","on":true}  eigene Reaktion an/aus
//   {"id":13,"cmd":"ext","name":"collab.comments"}             Feature-Struktur als JSON
//   {"id":14,"cmd":"image","image":"<imageId>","w":256}       Bild mit Sitzung abrufen ({status, type, bytes})
//   {"id":15,"cmd":"close"}
// Antwort `at` = Date.now() nach dem Senden an den Server (für Laufzeitmessungen).
import readline from 'node:readline';
import { passwordLogin } from '../server/test/native-sandbox';
import { webClient } from '../server/test/native-client';
import { fragment, plain, Y, type PMDoc, type PMNode } from '../server/test/native-seed';

/** Fragment → ProseMirror-JSON (wie fragmentToJson im Web, Marks ohne `--hash`). */
function toJson(f: Y.XmlFragment | Y.XmlElement): PMNode[] {
  const out: PMNode[] = [];
  for (const c of f.toArray()) {
    if (c instanceof Y.XmlText) {
      for (const d of c.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
        if (typeof d.insert !== 'string' || !d.insert) continue;
        const marks = Object.entries(d.attributes ?? {}).map(([k, v]) => {
          const type = k.includes('--') ? k.slice(0, k.indexOf('--')) : k;
          return v && typeof v === 'object' && Object.keys(v).length ? { type, attrs: v as Record<string, unknown> } : { type };
        });
        out.push(marks.length ? { type: 'text', text: d.insert, marks } : { type: 'text', text: d.insert });
      }
    } else if (c instanceof Y.XmlElement) {
      const n: PMNode = { type: c.nodeName };
      const attrs = c.getAttributes() as Record<string, unknown>;
      if (Object.keys(attrs).length) n.attrs = attrs;
      const kids = toJson(c);
      if (kids.length) n.content = kids;
      out.push(n);
    }
  }
  return out;
}

/** Textblöcke (Y.XmlElement mit nur Text/Umbrüchen) in Dokument-Reihenfolge. */
function textblocks(f: Y.XmlFragment | Y.XmlElement): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  for (const c of f.toArray()) {
    if (!(c instanceof Y.XmlElement)) continue;
    const kids = c.toArray();
    if (kids.every((k) => k instanceof Y.XmlText || (k instanceof Y.XmlElement && k.nodeName === 'hardBreak')) && ['paragraph', 'heading', 'codeBlock'].includes(c.nodeName)) out.push(c);
    else out.push(...textblocks(c));
  }
  return out;
}

const [base, login = 'jonas', password = 'kaktus-123'] = process.argv.slice(2);
if (!base) {
  console.error('Aufruf: tsx tools/web-peer.mts <stachel-url> [login] [passwort]');
  process.exit(2);
}
const wsBase = base.replace(/^http/, 'ws');
const cookie = await passwordLogin(base, login, password);
// Awareness `user` muss genau der Sitzung entsprechen (sonst trennt der Server: awareness_user_mismatch)
const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json()) as { user: { key: string; name: string } };
let web: ReturnType<typeof webClient> | null = null;

const out = (msg: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function run(cmd: Record<string, any>): Promise<Record<string, unknown>> {
  if (cmd.cmd === 'open') {
    web?.destroy();
    web = webClient(wsBase, String(cmd.board), { cookie });
    await web.synced();
    const aw = web.provider.awareness!;
    aw.setLocalStateField('since', Date.now());
    aw.setLocalStateField('user', { key: me.user.key, name: me.user.name, color: '#ec4e92' });
    aw.setLocalStateField('cursor', null);
    aw.setLocalStateField('selection', []);
    return { objects: web.objects.size };
  }
  const w = web;
  if (!w) throw new Error('erst open');
  switch (cmd.cmd) {
    case 'set': {
      const m = w.objects.get(String(cmd.obj));
      if (!m) throw new Error(`unbekanntes Objekt ${cmd.obj}`);
      w.doc.transact(() => {
        for (const [k, v] of Object.entries(cmd.fields as Record<string, unknown>)) {
          if (v === null) m.delete(k);
          else m.set(k, v);
        }
        m.set('updatedAt', new Date().toISOString());
      });
      break;
    }
    case 'create': {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(cmd.object as Record<string, unknown>)) m.set(k, k === 'content' ? fragment(v as PMDoc) : v);
      w.objects.set(String((cmd.object as { id: string }).id), m);
      break;
    }
    case 'delete':
      w.objects.delete(String(cmd.obj));
      break;
    case 'awareness': {
      const aw = w.provider.awareness!;
      for (const [k, v] of Object.entries(cmd.fields as Record<string, unknown>)) aw.setLocalStateField(k, v);
      return {};
    }
    case 'peers': {
      const aw = w.provider.awareness!;
      const peers: { clientId: number; state: unknown }[] = [];
      aw.getStates().forEach((state, clientId) => {
        if (clientId !== aw.clientID) peers.push({ clientId, state });
      });
      return { peers };
    }
    case 'get':
      return { object: w.objects.get(String(cmd.obj))?.toJSON() ?? null };
    case 'type': {
      const m = w.objects.get(String(cmd.obj));
      const f = m?.get('content');
      if (!m || !(f instanceof Y.XmlFragment)) throw new Error(`kein Rich-Text in ${cmd.obj}`);
      const block = textblocks(f)[Number(cmd.block ?? 0)];
      if (!block) throw new Error('Textblock fehlt');
      w.doc.transact(() => {
        let t = block.toArray().find((k) => k instanceof Y.XmlText) as Y.XmlText | undefined;
        if (!t) {
          t = new Y.XmlText();
          block.insert(0, [t]);
        }
        if (cmd.del) t.delete(Number(cmd.at ?? 0), Number(cmd.del));
        if (cmd.text) t.insert(Number(cmd.at ?? 0), String(cmd.text));
        m.set('text', plain({ type: 'doc', content: toJson(f) } as PMDoc));
        m.set('updatedAt', new Date().toISOString());
      });
      break;
    }
    case 'content': {
      const m = w.objects.get(String(cmd.obj));
      const f = m?.get('content');
      return { content: f instanceof Y.XmlFragment ? { type: 'doc', content: toJson(f) } : null, text: m?.get('text') ?? null };
    }
    case 'caret': {
      const aw = w.provider.awareness!;
      aw.setLocalStateField('richtext.caret', cmd.obj ? { id: String(cmd.obj), anchor: null, head: null } : null);
      return {};
    }
    case 'comment': {
      // wie createThread/addReply des Web-Moduls collab (gleiche Y-Struktur)
      const comments = w.doc.getMap<Y.Map<unknown>>('collab.comments');
      const msg = { id: String(cmd.msg ?? `w${Date.now()}`), by: me.user.key, name: me.user.name, text: String(cmd.text), at: new Date().toISOString(), ...(Array.isArray(cmd.mentions) && cmd.mentions.length ? { mentions: cmd.mentions } : {}) };
      const thread = String(cmd.thread);
      w.doc.transact(() => {
        const have = comments.get(thread);
        if (have) {
          (have.get('messages') as Y.Array<unknown>).push([msg]);
          return;
        }
        const t = new Y.Map<unknown>();
        const msgs = new Y.Array<unknown>();
        msgs.push([msg]);
        const at = (cmd.at ?? { x: 0, y: 0 }) as { x: number; y: number; objectId?: string; dx?: number; dy?: number };
        t.set('x', at.x);
        t.set('y', at.y);
        if (at.objectId) {
          t.set('objectId', at.objectId);
          t.set('dx', at.dx ?? 0);
          t.set('dy', at.dy ?? 0);
        }
        t.set('resolved', false);
        t.set('createdBy', me.user.key);
        t.set('createdAt', msg.at);
        t.set('messages', msgs);
        comments.set(thread, t);
      });
      break;
    }
    case 'react': {
      const reactions = w.doc.getMap<unknown>('collab.reactions');
      const k = `${cmd.obj}|${cmd.emoji}|${me.user.key}`;
      if (cmd.on === false) reactions.delete(k);
      else reactions.set(k, { o: String(cmd.obj), e: String(cmd.emoji), u: me.user.key, n: me.user.name, at: new Date().toISOString() });
      break;
    }
    case 'ext': {
      // Wurzel-Typen legt Yjs erst beim ersten Zugriff an (share): als Y.Map holen (alle collab.*-Strukturen außer Listen)
      const m = w.doc.getMap<unknown>(String(cmd.name));
      return { value: m.size ? m.toJSON() : null };
    }
    case 'image': {
      // Bild wie der Browser abrufen (mit Sitzung): Status, Typ, Größe
      const res = await fetch(`${base}/api/images/${encodeURIComponent(String(cmd.image))}${cmd.w ? `?w=${cmd.w}` : ''}`, { headers: { cookie } });
      const bytes = (await res.arrayBuffer()).byteLength;
      return { status: res.status, type: res.headers.get('content-type'), bytes };
    }
    case 'close':
      w.destroy();
      web = null;
      return {};
    default:
      throw new Error(`unbekannter Befehl ${cmd.cmd}`);
  }
  await w.flushed();
  return {};
}

const rl = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on('line', (line) => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let cmd: Record<string, any> = {};
    try {
      cmd = JSON.parse(line);
      const res = await run(cmd);
      out({ id: cmd.id ?? null, ok: true, at: Date.now(), ...res });
    } catch (e) {
      out({ id: cmd.id ?? null, ok: false, error: String((e as Error).message ?? e) });
    }
    if (cmd.cmd === 'close') process.exit(0);
  });
});
rl.on('close', () => {
  web?.destroy();
  process.exit(0);
});
out({ ready: true, user: me.user.key, name: me.user.name });
