// „Mara schreibt hier gerade“ auf dem Board: wer in einer Notiz/einem Text schreibt (Awareness `richtext.caret`), steht
// klein über dem Objekt – auch für Personen in einer App, die keine Schreibmarke im Web-Editor haben
// (docs/contract.md §8.4 `editing`, Konzept §4.6). Im eigenen Editor zeigen die Schreibmarken (carets.ts) das schon.
import { useSyncExternalStore } from 'react';
import { rectToScreen } from '../../board/geometry';
import type { Peer } from '../../board/session';
import type { SlotProps } from '../../editor/ext/types';
import { CARET_FIELD } from './carets';

export interface Writer {
  id: string;
  names: string[];
  color: string;
}

/** Objekte, in denen andere gerade schreiben (eine Person je Name), ohne das selbst bearbeitete. */
export function writersOf(peers: readonly Peer[], editingId: string | null, myKey: string | null): Writer[] {
  const by = new Map<string, Writer>();
  for (const p of peers) {
    const c = p.extra[CARET_FIELD] as { id?: unknown } | null | undefined;
    const id = c && typeof c === 'object' && typeof c.id === 'string' ? c.id : null;
    if (!id || id === editingId || p.user.key === myKey) continue;
    const w = by.get(id) ?? { id, names: [], color: p.user.color };
    const first = p.user.name.split(' ')[0] || p.user.name;
    if (!w.names.includes(first)) w.names.push(first);
    by.set(id, w);
  }
  return [...by.values()];
}

/** Slot (overlay): Hinweis über Objekten, in denen jemand anderes schreibt. */
export function WritingHints({ api, cam, snap, width, height }: SlotProps) {
  const peers = useSyncExternalStore(api.session.subscribe, api.session.getPeers);
  const items = writersOf(peers, api.editingId(), api.session.user?.key ?? null).flatMap((w) => {
    const o = snap.byId.get(w.id);
    const r = o ? api.bounds(o) : null;
    if (!r) return [];
    const s = rectToScreen(cam, r);
    if (s.x > width || s.y > height || s.x + s.w < 0 || s.y + s.h < 0) return [];
    const who = w.names.length > 1 ? `${w.names.slice(0, -1).join(', ')} und ${w.names[w.names.length - 1]}` : w.names[0];
    return [
      <div key={w.id} className="richtext-writing" role="status" style={{ transform: `translate(${s.x}px, ${s.y - 24}px)`, background: w.color }}>
        {who} {w.names.length > 1 ? 'schreiben' : 'schreibt'} hier gerade …
      </div>,
    ];
  });
  return items.length ? <>{items}</> : null;
}
