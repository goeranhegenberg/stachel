// Runde 4 (Zusammenarbeit): Erwähnung fertig, Farben der Anwesenden, eigene Tabs, anonyme Abstimmung,
// Vorschaubild mit Rahmentitel, App-Link auf dem Handy, Upload-Platzhalter anderer.
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { BoardStore } from '../../board/store';
import { pickPresenceColor, PRESENCE_COLORS, readPeers } from '../../board/session';
import type { BoardObject } from '../../protocol';
import { appOpenUrl, mobilePlatform } from '../../pages/appLink';
import { thumbRect } from '../tools/thumbnail';
import { mentionDone, mentionQuery } from './mentions';
import { readUploads } from './PeerHints';
import { castVote, myVotes, startVote, tally, voterNames, voterOf, votesMap } from './voting';

const MARA = { key: 'm:12', name: 'Mara Lindner' };
const JONAS = { key: 'm:31', name: 'Jonas Keller' };
const LENA = { key: 'm:7', name: 'Lena' };

describe('@Erwähnung als letztes Wort (B2)', () => {
  const people = [LENA, MARA];
  it('nach dem Übernehmen („@Lena␠“) gilt die Erwähnung als fertig – Enter sendet', () => {
    const text = 'Bitte übernehmen @Lena ';
    const q = mentionQuery(text, text.length)!;
    expect(q.query).toBe('Lena ');
    expect(mentionDone(q.query, people)).toBe(true);
    expect(mentionDone('mara lindner ', people)).toBe(true);
  });
  it('noch offen: ohne Leerzeichen, angefangener Name oder Vorname eines längeren Namens', () => {
    expect(mentionDone('Lena', people)).toBe(false);
    expect(mentionDone('Le ', people)).toBe(false);
    expect(mentionDone('Mara ', people)).toBe(false);
    expect(mentionDone(' ', people)).toBe(false);
  });
});

describe('Farben der Anwesenden (B9)', () => {
  const peer = (key: string, clientId: number, since: number, color: string) => ({ clientId, since, user: { key, name: key, color } });
  it('bis 12 Personen: jede:r nacheinander bekommt eine eigene Farbe', () => {
    const present: ReturnType<typeof peer>[] = [];
    for (let i = 0; i < 12; i++) {
      const color = pickPresenceColor({ key: `m:${i}`, clientId: 1000 - i, since: i, color: '#ec4e92' }, present);
      present.push(peer(`m:${i}`, 1000 - i, i, color));
    }
    expect(new Set(present.map((p) => p.user.color)).size).toBe(12);
    expect(present.every((p) => PRESENCE_COLORS.includes(p.user.color))).toBe(true);
  });
  it('wer früher da war, behält die Farbe; der Neue weicht aus (auch mit kleinerer clientId)', () => {
    const old = peer('m:1', 999, 100, PRESENCE_COLORS[0]);
    expect(pickPresenceColor({ key: 'm:2', clientId: 1, since: 200, color: PRESENCE_COLORS[0] }, [old])).toBe(PRESENCE_COLORS[1]);
    expect(pickPresenceColor({ key: 'm:1', clientId: 999, since: 100, color: PRESENCE_COLORS[0] }, [peer('m:2', 1, 200, PRESENCE_COLORS[0])])).toBe(PRESENCE_COLORS[0]);
  });
  it('gleichzeitiges Betreten: die kleinere clientId behält', () => {
    expect(pickPresenceColor({ key: 'm:2', clientId: 5, since: 100, color: PRESENCE_COLORS[0] }, [peer('m:1', 4, 100, PRESENCE_COLORS[0])])).toBe(PRESENCE_COLORS[1]);
    expect(pickPresenceColor({ key: 'm:1', clientId: 4, since: 100, color: PRESENCE_COLORS[0] }, [peer('m:2', 5, 100, PRESENCE_COLORS[0])])).toBe(PRESENCE_COLORS[0]);
  });
  it('zweiter eigener Tab übernimmt die Farbe des ersten', () => {
    expect(pickPresenceColor({ key: 'm:1', clientId: 2, since: 300, color: PRESENCE_COLORS[0] }, [peer('m:1', 9, 100, PRESENCE_COLORS[4]), peer('m:3', 3, 50, PRESENCE_COLORS[0])])).toBe(PRESENCE_COLORS[4]);
  });
});

describe('eigener zweiter Tab (B16)', () => {
  it('bleibt anwesend, aber ohne „fremden“ Cursor und ohne fremde Auswahl', () => {
    const states = new Map<number, Record<string, any>>([
      [1, { user: { key: 'm:1', name: 'Ich', color: '#1763b5' }, cursor: { x: 1, y: 2 }, selection: ['a'] }],
      [2, { user: { key: 'm:1', name: 'Ich', color: '#1763b5' }, cursor: { x: 5, y: 6 }, selection: ['b'], since: 7 }],
      [3, { user: { key: 'm:2', name: 'Du', color: '#ec4e92' }, cursor: { x: 3, y: 4 }, selection: ['c'] }],
    ]);
    const peers = readPeers(states, 1, 'm:1');
    expect(peers.map((p) => [p.clientId, p.cursor, p.selection])).toEqual([
      [2, null, []],
      [3, { x: 3, y: 4 }, ['c']],
    ]);
    expect(peers[0].since).toBe(7);
    expect(peers[0].extra).toEqual({});
  });
});

describe('anonyme Abstimmung', () => {
  const store = () => new BoardStore(new Y.Doc(), MARA.key);
  it('Stimmen ohne Namen, Schlüssel ohne userKey, Stimmen-Budget und Rangfolge wie sonst', () => {
    const st = store();
    const s = startVote(st, { title: 'Geheim', perPerson: 1, multi: false, minutes: null, anonymous: true }, MARA);
    expect(s.anonymous).toBe(true);
    expect(castVote(st, s, MARA, 'n1')).toBe('added');
    expect(castVote(st, s, MARA, 'n2')).toBe('none-left');
    expect(castVote(st, s, JONAS, 'n1')).toBe('added');
    const votes = votesMap(st);
    const raw = JSON.stringify(votes.toJSON());
    expect(raw).not.toContain('m:12');
    expect(raw).not.toContain('Mara');
    expect(myVotes(votes, s.id, voterOf(s, MARA.key)).get('n1')).toBe(1);
    expect(tally(votes, s.id)).toMatchObject({ voters: 2, total: 2 });
    expect(voterNames(votes, s.id).size).toBe(0);
    // je Abstimmung andere Kennung: nicht verknüpfbar
    expect(voterOf(s, MARA.key)).not.toBe(voterOf({ ...s, id: 'anders' }, MARA.key));
  });
  it('nicht anonym: Namen je Objekt für das Ergebnis', () => {
    const st = store();
    const s = startVote(st, { title: 'Offen', perPerson: 2, multi: false, minutes: null }, MARA);
    castVote(st, s, MARA, 'n1');
    castVote(st, s, JONAS, 'n1');
    castVote(st, s, JONAS, 'n2');
    expect(voterNames(votesMap(st), s.id)).toEqual(
      new Map([
        ['n1', ['Jonas Keller', 'Mara Lindner']],
        ['n2', ['Jonas Keller']],
      ]),
    );
  });
});

describe('Vorschaubild mit Rahmentitel (x-display B14)', () => {
  const frame = { id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 200, z: 'a', title: 'Lageplan', createdBy: '', updatedAt: '' } as BoardObject;
  const rect = (o: BoardObject) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
  it('Platz für den Titel oberhalb des Rahmens', () => {
    expect(thumbRect([frame], rect)!.y).toBeGreaterThan(-40);
    const r = thumbRect([frame], rect, 40)!;
    expect(r.y).toBeLessThanOrEqual(-40);
    expect(r.y + r.h).toBeGreaterThanOrEqual(200);
  });
});

describe('„In der App öffnen“ (App-Link, Modus org)', () => {
  it('erkennt Android, iPhone/iPad (auch iPadOS als Mac mit Touch)', () => {
    expect(mobilePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile', 5)).toBe('android');
    expect(mobilePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', 5)).toBe('ios');
    expect(mobilePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('ios');
    expect(mobilePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe('other');
  });
  it('Android: intent:// mit App-Paket der Instanz und Rückfall-Seite, ohne Paket kein Knopf; iOS: kein Knopf; sonst der https-Link', () => {
    const url = 'https://board.example.org/qr/AbC_12-x';
    expect(appOpenUrl(url, 'android', 'org.example.verein')).toBe(
      `intent://board.example.org/qr/AbC_12-x#Intent;scheme=https;package=org.example.verein;S.browser_fallback_url=${encodeURIComponent('https://board.example.org/qr/AbC_12-x?handy=1')};end`,
    );
    expect(appOpenUrl(url, 'android', null)).toBeNull();
    expect(appOpenUrl(url, 'ios', 'org.example.verein')).toBeNull();
    expect(appOpenUrl(url, 'other', null)).toBe(url);
  });
});

describe('Upload-Platzhalter anderer (B12)', () => {
  it('liest nur gültige Rechtecke (fremde Awareness-Daten)', () => {
    expect(readUploads(null)).toEqual([]);
    expect(readUploads([{ x: 1, y: 2, w: 3, h: 4, color: '#abcdef' }, { x: 'a' }, { x: 0, y: 0, w: -1, h: 5 }, { x: 0, y: 0, w: 5, h: 5, color: 'url(x)' }])).toEqual([
      { x: 1, y: 2, w: 3, h: 4, color: '#abcdef' },
      { x: 0, y: 0, w: 5, h: 5, color: null },
    ]);
    expect(readUploads(Array.from({ length: 50 }, () => ({ x: 0, y: 0, w: 1, h: 1 }))).length).toBe(10);
  });
});
