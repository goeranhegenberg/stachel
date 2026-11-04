// Link auf ein Objekt (Kontextmenü „Link kopieren“): /?b=<board>&o=<objekt>. Beim Öffnen fährt die Kamera hin und
// wählt das Objekt aus, sobald es geladen ist; danach verschwindet `o` aus der Adresszeile.
import { useEffect, useRef } from 'react';
import { expand } from '../../board/geometry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { appHref, boardShareUrl } from '../../router';
import { copyText, currentBoardId, objectLink } from './util';

export function linkedObjectId(search = location.search): string | null {
  return new URLSearchParams(search).get('o');
}

function dropParam() {
  const q = new URLSearchParams(location.search);
  if (!q.has('o')) return;
  q.delete('o');
  const s = q.toString();
  history.replaceState(history.state, '', `${location.pathname}${s ? `?${s}` : ''}${location.hash}`);
}

/** Overlay-Slot ohne Darstellung: wartet auf das verlinkte Objekt und zeigt es. */
export function ObjectLinkFocus({ api, snap }: SlotProps) {
  const target = useRef(linkedObjectId());
  const done = useRef(false);
  useEffect(() => {
    const id = target.current;
    if (!id || done.current) return;
    const o = snap.byId.get(id);
    if (!o) return;
    done.current = true;
    // nach der ersten Einpassung des Editors
    requestAnimationFrame(() => {
      const r = api.bounds(o);
      if (r) api.fitTo(expand(r, Math.max(80, Math.max(r.w, r.h) * 0.5)), 1.5);
      api.setSelection([o.id]);
      dropParam();
    });
  }, [api, snap]);
  // nach dem Laden nicht gefunden (gelöscht): Hinweis
  useEffect(() => {
    if (!target.current) return;
    const t = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      if (api.session.getStatus() === 'connected' || api.session.isLocal) api.toast('Das verlinkte Objekt gibt es nicht mehr.');
      dropParam();
    }, 8000);
    return () => clearTimeout(t);
  }, [api]);
  return null;
}

/** Link zum ausgewählten Objekt (bzw. zum Board) in die Zwischenablage. */
export async function copyObjectLink(api: EditorApi, id: string | undefined = api.selection()[0]) {
  const board = currentBoardId();
  // Board-Link als Kurzlink <Basis>b/<id> (öffnet am Handy direkt die App, sonst Weiterleitung auf <Basis>?b=<id>)
  const url = id ? objectLink(board, id) : board ? boardShareUrl(board) : `${location.origin}${appHref('?offline=1')}`;
  const ok = await copyText(url);
  api.toast(ok ? (id ? 'Link zum Objekt kopiert.' : 'Link zum Board kopiert.') : url);
}
