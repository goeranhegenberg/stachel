import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../../board/store';
import { addReply, anchorAt, commentsMap, createThread, deleteMessage, editMessage, moveThread, objectLabel, readThreads, setResolved, threadPos, unreadMentions } from './comments';
import { extractMentions, insertMention, matchPeople, mentionQuery, splitMentions } from './mentions';
import { peopleText, reactionsByObject, reactionsMap, toggleReaction } from './reactions';
import { castVote, closeVote, endVote, historyArray, isRunning, MAX_HISTORY, readHistory, readSession, startVote, tally, votable, voteMap, votesMap } from './voting';
import { addTime, formatMs, IDLE, isOver, pauseTimer, readTimer, remainingMs, resumeTimer, startTimer, stopTimer, timerMap } from './timer';
import { LASER_LIFE, LaserReceiver, LaserSender, trailSegments } from './laser';
import type { BoardObject } from '../../protocol';

const MARA = { key: 'm:12', name: 'Mara Lindner' };
const JONAS = { key: 'm:31', name: 'Jonas Keller' };
const IDA = { key: 'm:7', name: 'Ida Wolff' };

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'));
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'));
  return { a: new BoardStore(a, MARA.key), b: new BoardStore(b, JONAS.key) };
}

const note = (id: string, x = 0, y = 0) => ({ id, type: 'sticky' as const, x, y, w: 200, h: 200, text: 'Bühne' });

describe('Kommentare', () => {
  it('Thread an einem Objekt: Anlegen, Antworten, live beim anderen, Pin folgt dem Objekt', () => {
    const { a, b } = pair();
    a.create(note('n1', 100, 100));
    const at = anchorAt({ x: 150, y: 120 }, a.get('n1')!);
    expect(at).toEqual({ x: 150, y: 120, objectId: 'n1', dx: 50, dy: 20 });
    const id = createThread(a, at, MARA, 'Hallo @Jonas Keller', [JONAS.key]);
    addReply(b, id, JONAS, 'Gesehen');
    const [t] = readThreads(commentsMap(a));
    expect(t).toMatchObject({ id, objectId: 'n1', resolved: false, createdBy: MARA.key });
    expect(t.messages.map((m) => [m.by, m.text, m.mentions])).toEqual([
      [MARA.key, 'Hallo @Jonas Keller', [JONAS.key]],
      [JONAS.key, 'Gesehen', undefined],
    ]);
    a.update('n1', { x: 300 });
    expect(threadPos(t, a.getSnapshot())).toEqual({ x: 350, y: 120 });
    // Objekt kleiner als der Abstand: Pin bleibt am Rand
    a.update('n1', { w: 20 });
    expect(threadPos(t, a.getSnapshot())).toEqual({ x: 320, y: 120 });
    // Objekt gelöscht: gespeicherte Stelle
    a.remove(['n1']);
    expect(threadPos(t, a.getSnapshot())).toEqual({ x: 150, y: 120 });
  });

  it('Linien und Striche sind kein Anker; leere Stelle = frei auf dem Board', () => {
    const line = { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1 } as BoardObject;
    expect(anchorAt({ x: 1.4, y: 2.6 }, line)).toEqual({ x: 1, y: 3 });
    expect(anchorAt({ x: 5, y: 5 }, null)).toEqual({ x: 5, y: 5 });
  });

  it('erledigt/wieder offen, Antwort öffnet wieder, bearbeiten, löschen, umhängen', () => {
    const s = new BoardStore(new Y.Doc(), MARA.key);
    const id = createThread(s, { x: 0, y: 0 }, MARA, 'Erste');
    setResolved(s, id, true, MARA.key);
    expect(readThreads(commentsMap(s))[0]).toMatchObject({ resolved: true, resolvedBy: MARA.key });
    addReply(s, id, JONAS, 'Doch nicht');
    expect(readThreads(commentsMap(s))[0].resolved).toBe(false);
    const msgId = readThreads(commentsMap(s))[0].messages[1].id;
    editMessage(s, id, msgId, 'Doch @Mara Lindner', [MARA.key]);
    const edited = readThreads(commentsMap(s))[0].messages[1];
    expect(edited).toMatchObject({ id: msgId, text: 'Doch @Mara Lindner', mentions: [MARA.key] });
    expect(edited.edited).toMatch(/Z$/);
    deleteMessage(s, id, msgId);
    expect(readThreads(commentsMap(s))[0].messages).toHaveLength(1);
    moveThread(s, id, { x: 9, y: 8, objectId: 'n2', dx: 1, dy: 2 });
    expect(readThreads(commentsMap(s))[0]).toMatchObject({ x: 9, y: 8, objectId: 'n2', dx: 1, dy: 2 });
    moveThread(s, id, { x: 4, y: 4 });
    expect(readThreads(commentsMap(s))[0].objectId).toBeUndefined();
    // erste Nachricht löschen = Thread löschen
    deleteMessage(s, id, readThreads(commentsMap(s))[0].messages[0].id);
    expect(readThreads(commentsMap(s))).toEqual([]);
  });

  it('jede Aktion ist ein eigener Rückgängig-Schritt; Board-Undo nimmt Kommentare mit zurück', () => {
    const s = new BoardStore(new Y.Doc(), MARA.key);
    s.create(note('n1'));
    const id = createThread(s, { x: 0, y: 0 }, MARA, 'Eins');
    addReply(s, id, MARA, 'Zwei');
    s.undo();
    expect(readThreads(commentsMap(s))[0].messages).toHaveLength(1);
    s.undo();
    expect(readThreads(commentsMap(s))).toEqual([]);
    expect(s.get('n1')).toBeDefined();
    s.redo();
    expect(readThreads(commentsMap(s))).toHaveLength(1);
  });

  it('liest fremde/kaputte Einträge tolerant (alte Boards ohne Struktur = leer)', () => {
    const doc = new Y.Doc();
    const s = new BoardStore(doc, MARA.key);
    expect(readThreads(commentsMap(s))).toEqual([]);
    const m = doc.getMap<unknown>('collab.comments');
    m.set('kaputt', 'x');
    const t = new Y.Map<unknown>();
    const msgs = new Y.Array<unknown>();
    msgs.push([{ id: 'a', text: 'ok', by: 'm:1' }, { text: 'ohne id' }, null]);
    t.set('messages', msgs);
    m.set('t1', t);
    const empty = new Y.Map<unknown>();
    empty.set('messages', new Y.Array());
    m.set('t2', empty);
    const list = readThreads(commentsMap(s));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 't1', x: 0, y: 0, resolved: false, createdBy: 'm:1' });
    expect(list[0].messages).toEqual([{ id: 'a', text: 'ok', by: 'm:1', name: 'Unbekannt', at: '', mentions: undefined, edited: undefined }]);
  });

  it('ungelesene Erwähnungen: nur fremde, neuer als der Gelesen-Stand, neueste zuerst', () => {
    const s = new BoardStore(new Y.Doc(), MARA.key);
    const id = createThread(s, { x: 0, y: 0 }, JONAS, '@Mara Lindner schau mal', [MARA.key]);
    createThread(s, { x: 0, y: 0 }, MARA, 'ich selbst @Mara Lindner', [MARA.key]);
    addReply(s, id, IDA, 'auch @Mara Lindner', [MARA.key]);
    const threads = readThreads(commentsMap(s));
    const all = unreadMentions(threads, MARA.key, undefined);
    expect(all.map((u) => u.msg.by)).toEqual([IDA.key, JONAS.key]);
    expect(unreadMentions(threads, MARA.key, new Date(Date.now() + 1000).toISOString())).toEqual([]);
    expect(unreadMentions(threads, JONAS.key, undefined)).toEqual([]);
  });

  it('Objekt-Bezeichnung für Listen', () => {
    const label = (o: BoardObject) => (o.type === 'frame' ? 'Rahmen' : 'Haftnotiz');
    expect(objectLabel({ ...note('n'), text: '  Bühne\n am  See ' } as BoardObject, label)).toBe('Haftnotiz „Bühne am See“');
    expect(objectLabel({ ...note('n'), text: 'x'.repeat(40) } as BoardObject, label)).toBe(`Haftnotiz „${'x'.repeat(31)}…“`);
    expect(objectLabel({ ...note('n'), type: 'frame', title: 'Plan', text: undefined } as BoardObject, label)).toBe('Rahmen „Plan“');
    expect(objectLabel(undefined, label)).toBe('Gelöschtes Objekt');
  });
});

describe('Erwähnungen', () => {
  const people = [MARA, JONAS, IDA, { key: 'm:8', name: 'Mara Sommer' }];

  it('erkennt die offene Erwähnung vor dem Cursor', () => {
    expect(mentionQuery('Hallo @Ma', 9)).toEqual({ start: 6, query: 'Ma' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('Hallo @Mara Li', 14)).toEqual({ start: 6, query: 'Mara Li' });
    expect(mentionQuery('mail@example', 12)).toBeNull();
    expect(mentionQuery('@Mara\nweiter', 12)).toBeNull();
    expect(mentionQuery('kein at', 7)).toBeNull();
  });

  it('sortiert Treffer: Anfang des Namens, dann Wortanfang, dann enthalten', () => {
    expect(matchPeople(people, 'ma').map((p) => p.name)).toEqual(['Mara Lindner', 'Mara Sommer']);
    expect(matchPeople(people, 'w').map((p) => p.name)).toEqual(['Ida Wolff']);
    expect(matchPeople(people, 'ell').map((p) => p.name)).toEqual(['Jonas Keller']);
    expect(matchPeople(people, '')).toHaveLength(4);
  });

  it('setzt den Namen ein und ersetzt den angefangenen Rest', () => {
    expect(insertMention('Hi @Ma', 3, 6, 'Mara Lindner')).toEqual({ text: 'Hi @Mara Lindner ', caret: 17 });
    expect(insertMention('Hi @Ma da', 3, 6, 'Mara Lindner')).toEqual({ text: 'Hi @Mara Lindner da', caret: 17 });
  });

  it('findet Erwähnungen (längster Name gewinnt, Wortgrenze) und teilt den Text', () => {
    const p = [...people, { key: 'm:9', name: 'Mara' }];
    expect(extractMentions('@Mara Lindner und @Mara, aber nicht x@Ida oder @Idaho', p)).toEqual([MARA.key, 'm:9']);
    expect(splitMentions('Hi @Jonas Keller!', people)).toEqual([{ text: 'Hi ' }, { text: '@Jonas Keller', key: JONAS.key }, { text: '!' }]);
    expect(splitMentions('ohne', people)).toEqual([{ text: 'ohne' }]);
  });
});

describe('Reaktionen', () => {
  it('umschalten für mehrere Objekte, gruppiert nach Emoji mit Namen, live beim anderen', () => {
    const { a, b } = pair();
    toggleReaction(a, ['n1', 'n2'], '👍', MARA);
    toggleReaction(b, ['n1'], '👍', JONAS);
    toggleReaction(b, ['n1'], '🔥', JONAS);
    const byObj = reactionsByObject(reactionsMap(a), MARA.key);
    expect(byObj.get('n1')).toEqual([
      { emoji: '👍', people: [MARA, JONAS], mine: true },
      { emoji: '🔥', people: [JONAS], mine: false },
    ]);
    expect(byObj.get('n2')).toHaveLength(1);
    // haben alle schon: entfernen; sonst ergänzen
    toggleReaction(a, ['n1', 'n2'], '👍', MARA);
    expect(reactionsByObject(reactionsMap(a), MARA.key).get('n1')![0].people).toEqual([JONAS]);
    toggleReaction(a, ['n1'], '👍', MARA);
    toggleReaction(a, ['n1', 'n2'], '👍', MARA);
    expect(reactionsByObject(reactionsMap(b), JONAS.key).get('n2')![0].people).toEqual([MARA]);
    // eigener Rückgängig-Schritt
    a.undo();
    expect(reactionsByObject(reactionsMap(a), MARA.key).get('n2')).toBeUndefined();
  });

  it('Namensliste für den Tooltip', () => {
    expect(peopleText([MARA], JONAS.key)).toBe('Mara Lindner');
    expect(peopleText([MARA, JONAS], JONAS.key)).toBe('Mara Lindner und du');
    expect(peopleText([MARA, IDA, JONAS], 'x')).toBe('Mara Lindner, Ida Wolff und Jonas Keller');
  });
});

describe('Abstimmung', () => {
  it('Stimmen pro Person begrenzt, Klick schaltet um, Rangfolge mit geteilten Plätzen, Archiv', () => {
    const { a, b } = pair();
    const s = startVote(a, { title: '  ', perPerson: 2, multi: false, minutes: 5 }, MARA);
    expect(s).toMatchObject({ title: 'Abstimmung', perPerson: 2, ended: false, startedBy: MARA.key });
    const sb = readSession(voteMap(b))!;
    expect(sb.id).toBe(s.id);
    expect(isRunning(sb, Date.now())).toBe(true);
    expect(castVote(a, s, MARA, 'n1')).toBe('added');
    expect(castVote(a, s, MARA, 'n2')).toBe('added');
    expect(castVote(a, s, MARA, 'n3')).toBe('none-left');
    expect(castVote(a, s, MARA, 'n2')).toBe('removed');
    expect(castVote(a, s, MARA, 'n3')).toBe('added');
    expect(castVote(b, sb, JONAS, 'n3')).toBe('added');
    expect(castVote(b, sb, JONAS, 'n1')).toBe('added');
    expect(castVote(b, sb, IDA, 'n2')).toBe('added');
    const t = tally(votesMap(a), s.id);
    expect(t).toMatchObject({ voters: 3, total: 5 });
    expect(t.ranking).toEqual([
      { objectId: 'n1', votes: 2, rank: 1 },
      { objectId: 'n3', votes: 2, rank: 1 },
      { objectId: 'n2', votes: 1, rank: 3 },
    ]);
    // gelöschte Objekte zählen nicht
    expect(tally(votesMap(a), s.id, (id) => id !== 'n1').ranking.map((r) => r.objectId)).toEqual(['n3', 'n2']);
    endVote(b);
    expect(readSession(voteMap(a))!.ended).toBe(true);
    expect(castVote(a, readSession(voteMap(a)), MARA, 'n2')).toBe('not-running');
    closeVote(a);
    expect(readSession(voteMap(b))).toBeNull();
    expect(votesMap(b).size).toBe(0);
    const [h] = readHistory(historyArray(b));
    expect(h).toMatchObject({ id: s.id, title: 'Abstimmung', voters: 3, total: 5 });
  });

  it('mehrere Stimmen auf ein Objekt, Zurücknehmen; abgelaufene Zeit = nicht mehr offen', () => {
    const st = new BoardStore(new Y.Doc(), MARA.key);
    const s = startVote(st, { title: 'X', perPerson: 3, multi: true, minutes: 1 }, MARA);
    castVote(st, s, MARA, 'n1');
    castVote(st, s, MARA, 'n1');
    castVote(st, s, MARA, 'n1');
    expect(castVote(st, s, MARA, 'n1')).toBe('none-left');
    expect(castVote(st, s, MARA, 'n1', -1)).toBe('removed');
    expect(tally(votesMap(st), s.id).ranking).toEqual([{ objectId: 'n1', votes: 2, rank: 1 }]);
    expect(castVote(st, s, MARA, 'n2', 1, s.endsAt! + 1)).toBe('not-running');
    expect(isRunning(s, s.endsAt!)).toBe(false);
    // Abstimmung ohne Zeitlimit
    const open = startVote(st, { title: 'Y', perPerson: 1, multi: false, minutes: null }, MARA);
    expect(open.endsAt).toBeNull();
    expect(votesMap(st).size).toBe(0); // neue Abstimmung leert die alten Stimmen
    expect(isRunning(open, Date.now() + 1e9)).toBe(true);
  });

  it('nicht im Rückgängig, Archiv begrenzt, ohne Stimmen kein Archiv-Eintrag, Rahmen/Linien nicht wählbar', () => {
    const st = new BoardStore(new Y.Doc(), MARA.key);
    for (let i = 0; i < MAX_HISTORY + 3; i++) {
      const s = startVote(st, { title: `R${i}`, perPerson: 1, multi: false, minutes: null }, MARA);
      castVote(st, s, MARA, 'n1');
      closeVote(st);
    }
    startVote(st, { title: 'leer', perPerson: 1, multi: false, minutes: null }, MARA);
    closeVote(st);
    const hist = readHistory(historyArray(st));
    expect(hist).toHaveLength(MAX_HISTORY);
    expect(hist[0].title).toBe(`R${MAX_HISTORY + 2}`);
    expect(st.undoManager.undoStack).toHaveLength(0);
    expect(['sticky', 'shape', 'text', 'image'].every((type) => votable({ type } as BoardObject))).toBe(true);
    expect(['connector', 'pen', 'frame'].some((type) => votable({ type } as BoardObject))).toBe(false);
  });
});

describe('Timer', () => {
  it('starten, pausieren, weiter, Zeit dazu, beenden – für alle gleich', () => {
    const { a, b } = pair();
    startTimer(a, 5 * 60_000, 'Mara', 1000);
    let t = readTimer(timerMap(b));
    expect(t).toMatchObject({ state: 'running', endsAt: 301_000, duration: 300_000, by: 'Mara', run: 1 });
    expect(remainingMs(t, 61_000)).toBe(240_000);
    pauseTimer(b, 61_000);
    t = readTimer(timerMap(a));
    expect(t).toMatchObject({ state: 'paused', remaining: 240_000 });
    expect(remainingMs(t, 999_999)).toBe(240_000);
    addTime(a, 60_000, 'Mara', 70_000);
    expect(readTimer(timerMap(a))).toMatchObject({ state: 'paused', remaining: 300_000, duration: 360_000 });
    resumeTimer(a, 100_000);
    t = readTimer(timerMap(b));
    expect(t).toMatchObject({ state: 'running', endsAt: 400_000 });
    addTime(b, 60_000, 'Jonas', 200_000);
    expect(readTimer(timerMap(a)).endsAt).toBe(460_000);
    expect(isOver(readTimer(timerMap(a)), 460_000)).toBe(true);
    // abgelaufen + Zeit dazu = neuer Lauf
    addTime(a, 60_000, 'Mara', 500_000);
    expect(readTimer(timerMap(a))).toMatchObject({ state: 'running', endsAt: 560_000, run: 2 });
    stopTimer(b);
    expect(readTimer(timerMap(a))).toEqual({ ...IDLE, run: 2 });
    expect(a.undoManager.undoStack).toHaveLength(0);
  });

  it('Anzeige und Grenzen', () => {
    expect(formatMs(0)).toBe('0:00');
    expect(formatMs(59_001)).toBe('1:00');
    expect(formatMs(4 * 60_000 + 5_000)).toBe('4:05');
    expect(formatMs(3_723_000)).toBe('1:02:03');
    const st = new BoardStore(new Y.Doc(), MARA.key);
    startTimer(st, 99 * 3600_000, 'x', 0);
    expect(readTimer(timerMap(st)).duration).toBe(3 * 3600_000);
    expect(readTimer(new Y.Doc().getMap('collab.timer'))).toEqual(IDLE);
  });
});

describe('Laser', () => {
  it('überträgt Punkte, füllt Lücken, trennt Striche, verblasst', () => {
    const tx = new LaserSender();
    const rx = new LaserReceiver();
    tx.begin();
    rx.take(tx.add({ x: 0, y: 0 }), 0);
    tx.add({ x: 10, y: 0 });
    rx.take(tx.add({ x: 20, y: 0 }), 10); // ein Update verpasst: Punkt 2 kommt mit
    expect(rx.points.map((p) => [p.x, p.gap])).toEqual([
      [0, true],
      [10, false],
      [20, false],
    ]);
    // gleiche Nachricht noch einmal: nichts Neues
    expect(rx.take(tx.msg(), 20)).toBe(false);
    tx.begin();
    rx.take(tx.add({ x: 100, y: 100 }), 30);
    expect(rx.points.at(-1)).toMatchObject({ x: 100, gap: true });
    const segs = trailSegments(rx.points, 30);
    expect(segs).toHaveLength(2);
    expect(segs[0].alpha).toBeCloseTo(1, 1);
    rx.prune(LASER_LIFE + 25);
    expect(rx.points.map((p) => p.x)).toEqual([100]);
    expect(rx.take({ s: 1, p: [5] }, 0)).toBe(false); // kaputt
    expect(rx.take(null, 0)).toBe(false);
    // Seite neu geladen: Zählung beginnt von vorn
    const tx2 = new LaserSender();
    expect(rx.take(tx2.add({ x: 7, y: 7 }), 40)).toBe(true);
  });

  it('sendet höchstens die letzten Punkte', () => {
    const tx = new LaserSender();
    let msg = tx.add({ x: 0, y: 0 });
    for (let i = 1; i < 50; i++) msg = tx.add({ x: i, y: 0 });
    expect(msg.s).toBe(50);
    expect(msg.p).toHaveLength(48);
    expect(msg.g).toBeUndefined();
  });
});
