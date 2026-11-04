// Web-Aktionen des Moduls collab (Paket P5, docs/contract.md §8.12): Abstimmung, Timer und Kommentar-Pin umhängen aus
// der App – Ergebnis wie die Web-Funktionen (voting.ts, timer.ts, comments.ts) direkt auf einem Browser-Store.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore } from '../../web/src/board/store';
import { nativeAction, nativeActionList } from '../../web/src/native/registry';
import { anchorAt, commentsMap, createThread, moveThread, readThreads } from '../../web/src/features/collab/comments';
import { addTime, pauseTimer, readTimer, resumeTimer, startTimer, stopTimer, timerMap } from '../../web/src/features/collab/timer';
import { castVote, historyArray, myVotes, readHistory, readSession, startVote, tally, voterOf, voteMap, votesMap } from '../../web/src/features/collab/voting';
import { NONE_LEFT_TOAST } from '../../web/src/features/collab/native';
import { extraValue } from '../src/native/presence';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const MARA = { key: 'a:mara', name: 'Mara' };
const ctx = (user = MARA, exists: (id: string) => boolean = () => true) => ({ user, now: new Date().toISOString(), v: 1, id: (n: number) => `k-${n}`, exists, measure: () => 0 });
const run = (name: string, store: BoardStore, raw: Record<string, unknown>, c = ctx()) => {
  const def = nativeAction(name)!;
  const p = def.args(raw, 1);
  if (!p.ok) throw new Error(p.error);
  return def.run(store, p.args, c) ?? {};
};
const fresh = () => {
  const s = new BoardStore(new Y.Doc(), 'a:ref');
  s.transact(() => {
    for (const [id, type] of [
      ['n1', 'sticky'],
      ['n2', 'sticky'],
      ['f1', 'frame'],
      ['c1', 'connector'],
    ] as const)
      s.create({ id, type, x: 0, y: 0, w: 100, h: 100 } as never);
  });
  return s;
};
const START = { title: 'Welche Bühne?', perPerson: 2, minutes: 5, multi: false, anonymous: false };

describe('collab-Aktionen direkt', () => {
  it('sind angemeldet (Version 1) und prüfen die Argumente', () => {
    const list = nativeActionList();
    for (const n of ['collab.vote.start', 'collab.vote.cast', 'collab.vote.end', 'collab.vote.close', 'collab.timer.start', 'collab.timer.pause', 'collab.timer.resume', 'collab.timer.stop', 'collab.timer.add', 'collab.commentMove'])
      expect(list[n], n).toBe(1);
    expect(nativeAction('collab.vote.cast')!.undo).toBe('none');
    expect(nativeAction('collab.timer.start')!.undo).toBe('none');
    expect(nativeAction('collab.commentMove')!.undo).toBe('undo');
    const bad: [string, Record<string, unknown>][] = [
      ['collab.vote.start', { ...START, perPerson: 21 }],
      ['collab.vote.start', { ...START, perPerson: 0 }],
      ['collab.vote.start', { ...START, minutes: 7 }],
      ['collab.vote.start', { ...START, title: 'x'.repeat(81) }],
      ['collab.vote.start', { title: 'x', perPerson: 3, multi: false, anonymous: false }],
      ['collab.vote.cast', { objectId: 'n1', delta: 2 }],
      ['collab.vote.cast', { objectId: 'n 1', delta: 1 }],
      ['collab.vote.end', { x: 1 }],
      ['collab.timer.start', { ms: 999 }],
      ['collab.timer.start', { ms: 3 * 3600_000 + 1 }],
      ['collab.timer.add', {}],
      ['collab.commentMove', { thread: 't', x: 'a', y: 0 }],
    ];
    for (const [n, raw] of bad) expect(nativeAction(n)!.args(raw, 1).ok, `${n} ${JSON.stringify(raw)}`).toBe(false);
    expect(nativeAction('collab.vote.start')!.args({ ...START, minutes: null }, 1).ok).toBe(true);
  });

  it('Abstimmung: Start, Stimmen, keine übrig, Rücknahme, Ende, Archiv – wie die Web-Funktionen', () => {
    const app = fresh();
    const res = run('collab.vote.start', app, START);
    const s = readSession(voteMap(app))!;
    expect(res).toMatchObject({ select: [], data: { id: s.id } });
    expect(s).toMatchObject({ title: 'Welche Bühne?', perPerson: 2, multi: false, anonymous: false, startedBy: 'a:mara', startedByName: 'Mara', ended: false });
    expect(s.endsAt! - s.startedAt).toBe(5 * 60_000);
    // läuft schon → nichts
    expect(run('collab.vote.start', app, START)).toMatchObject({ skipped: true });
    expect(readSession(voteMap(app))!.id).toBe(s.id);

    // gleiche Schritte auf einem zweiten Store mit den Web-Funktionen
    const web = fresh();
    startVote(web, { title: 'Welche Bühne?', perPerson: 2, multi: false, minutes: 5 }, MARA);
    const ws = readSession(voteMap(web))!;
    expect(run('collab.vote.cast', app, { objectId: 'n1', delta: 1 })).toMatchObject({ data: { outcome: 'added' } });
    expect(castVote(web, ws, MARA, 'n1')).toBe('added');
    expect(run('collab.vote.cast', app, { objectId: 'n2', delta: 1 })).toMatchObject({ data: { outcome: 'added' } });
    // alle vergeben → Hinweis des Web
    run('collab.vote.cast', app, { objectId: 'n1', delta: 1 }); // ohne „mehrere“: schaltet zurück
    expect(myVotes(votesMap(app), s.id, 'a:mara')).toEqual(new Map([['n2', 1]]));
    run('collab.vote.cast', app, { objectId: 'n1', delta: 1 });
    const jonas = { key: 'a:jonas', name: 'Jonas' };
    expect(run('collab.vote.cast', app, { objectId: 'n1', delta: 1 }, ctx(jonas))).toMatchObject({ data: { outcome: 'added' } });
    // Rahmen und Verbinder sind keine Ziele
    expect(run('collab.vote.cast', app, { objectId: 'f1', delta: 1 })).toMatchObject({ skipped: true });
    expect(run('collab.vote.cast', app, { objectId: 'c1', delta: 1 })).toMatchObject({ skipped: true });
    expect(run('collab.vote.cast', app, { objectId: 'weg', delta: 1 })).toMatchObject({ skipped: true });
    expect(tally(votesMap(app), s.id).ranking).toEqual([
      { objectId: 'n1', votes: 2, rank: 1 },
      { objectId: 'n2', votes: 1, rank: 2 },
    ]);
    // Namen stehen an den Stimmen (nicht anonym)
    expect(votesMap(app).get(`${s.id}|a:jonas|n1`)).toEqual({ n: 1, name: 'Jonas' });

    run('collab.vote.end', app, {});
    expect(readSession(voteMap(app))!.ended).toBe(true);
    expect(run('collab.vote.cast', app, { objectId: 'n2', delta: 1 })).toMatchObject({ data: { outcome: 'not-running' } });
    run('collab.vote.close', app, {}, ctx(MARA, (id) => id !== 'n2'));
    expect(readSession(voteMap(app))).toBeNull();
    expect(votesMap(app).size).toBe(0);
    const [h] = readHistory(historyArray(app));
    expect(h).toMatchObject({ id: s.id, title: 'Welche Bühne?', voters: 2, total: 2, ranking: [{ objectId: 'n1', votes: 2, rank: 1 }] });
  });

  it('keine Stimmen mehr übrig: Hinweistext des Web; mehrere je Objekt mit „−“; anonym ohne Namen', () => {
    const app = fresh();
    run('collab.vote.start', app, { ...START, perPerson: 1, multi: true, anonymous: true, minutes: null });
    const s = readSession(voteMap(app))!;
    expect(s.endsAt).toBeNull();
    run('collab.vote.cast', app, { objectId: 'n1', delta: 1 });
    expect(run('collab.vote.cast', app, { objectId: 'n1', delta: 1 })).toEqual({ toast: NONE_LEFT_TOAST, data: { outcome: 'none-left', now: expect.any(Number) } });
    const key = `${s.id}|${voterOf(s, 'a:mara')}|n1`;
    expect(votesMap(app).get(key)).toEqual({ n: 1 });
    expect(key).toContain('anon-');
    expect(run('collab.vote.cast', app, { objectId: 'n1', delta: -1 })).toMatchObject({ data: { outcome: 'removed' } });
    expect(votesMap(app).size).toBe(0);
  });

  it('Timer: Start, Pause, Weiter, +1 Min., Stopp = Web-Funktionen; Ergebnis mit Server-Zeit', () => {
    const app = fresh();
    const web = fresh();
    const res = run('collab.timer.start', app, { ms: 3 * 60_000 }) as { data: Record<string, unknown> };
    startTimer(web, 3 * 60_000, 'Mara');
    const a = readTimer(timerMap(app));
    const w = readTimer(timerMap(web));
    expect({ ...a, endsAt: 0 }).toEqual({ ...w, endsAt: 0 });
    expect(Math.abs(a.endsAt - w.endsAt)).toBeLessThan(1000);
    expect(res.data).toMatchObject({ state: 'running', duration: 180_000, by: 'Mara', run: 1, now: expect.any(Number) });
    run('collab.timer.pause', app, {});
    pauseTimer(web);
    expect(readTimer(timerMap(app)).state).toBe('paused');
    run('collab.timer.add', app, { ms: 60_000 });
    addTime(web, 60_000, 'Mara');
    expect(Math.round(readTimer(timerMap(app)).remaining / 1000)).toBe(Math.round(readTimer(timerMap(web)).remaining / 1000));
    expect(readTimer(timerMap(app)).duration).toBe(240_000);
    run('collab.timer.resume', app, {});
    resumeTimer(web);
    expect(readTimer(timerMap(app)).state).toBe('running');
    run('collab.timer.stop', app, {});
    stopTimer(web);
    expect(readTimer(timerMap(app))).toEqual(readTimer(timerMap(web)));
    expect(readTimer(timerMap(app))).toMatchObject({ state: 'idle', run: 1 });
  });

  it('Pin umhängen: an ein Objekt (Abstand aus dem Server-Stand) bzw. frei – wie moveThread(anchorAt)', () => {
    const app = fresh();
    app.transact(() => app.update('n2', { x: 300, y: 40 }));
    const id = createThread(app, { x: 10, y: 10 }, MARA, 'Hallo');
    run('collab.commentMove', app, { thread: id, x: 350.4, y: 60, objectId: 'n2' });
    const web = fresh();
    web.transact(() => web.update('n2', { x: 300, y: 40 }));
    const wid = createThread(web, { x: 10, y: 10 }, MARA, 'Hallo');
    moveThread(web, wid, anchorAt({ x: 350.4, y: 60 }, web.get('n2')!));
    const pick = (s: BoardStore, t: string) => {
      const th = readThreads(commentsMap(s)).find((x) => x.id === t)!;
      return { x: th.x, y: th.y, objectId: th.objectId, dx: th.dx, dy: th.dy };
    };
    expect(pick(app, id)).toEqual(pick(web, wid));
    expect(pick(app, id)).toEqual({ x: 350, y: 60, objectId: 'n2', dx: 50, dy: 20 });
    // frei (kein Objekt bzw. Verbinder)
    run('collab.commentMove', app, { thread: id, x: -20, y: 5, objectId: 'c1' });
    expect(pick(app, id)).toEqual({ x: -20, y: 5, objectId: undefined, dx: 0, dy: 0 });
    expect(run('collab.commentMove', app, { thread: 'gibtsnicht', x: 0, y: 0 })).toEqual({ skipped: true });
  });
});

describe('Anwesenheit der App (presence.extra) für P5', () => {
  it('Laser behält die Strich-Anfänge `g` wie das Web (LaserMsg), Unsinn fällt weg', () => {
    expect(extraValue('collab.laser', { s: 5, p: [1, 2, 3, 4, 5, 6], g: [4] })).toEqual({ s: 5, p: [1, 2, 3, 4, 5, 6], g: [4] });
    expect(extraValue('collab.laser', { s: 5, p: [1, 2], g: ['x'] })).toEqual({ s: 5, p: [1, 2] });
    expect(extraValue('collab.laser', { s: 5, p: [1, 2], g: [] })).toEqual({ s: 5, p: [1, 2] });
  });
});

describe('collab-Aktionen über die Native-API', () => {
  let env: TestEnv;
  const cleanup: (() => void)[] = [];
  beforeAll(async () => {
    env = await startEnv({ nativeIdleMs: 300 });
  });
  afterAll(async () => env?.stop());
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  it('Abstimmung und Timer aus der App sieht das Web sofort; Pin umhängen ist ein Rückgängig-Schritt', async () => {
    const kt = env.fake.addMember(4712, 'Mara');
    const browser = await loginMember(env, kt);
    const mara = await appSession(env.base, kt);
    const board = (await browser.post('/api/boards', { title: 'Workshop' })).body.board as { id: string };
    const ws = env.base.replace('http', 'ws');
    const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
    cleanup.push(() => w.destroy());
    await w.synced();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    expect(welcome.actions['collab.vote.cast']).toBe(1);
    expect(welcome.actions['collab.commentMove']).toBe(1);

    let req = 10;
    const send = async (ops: Record<string, unknown>[]): Promise<Msg> => {
      const r = ++req;
      const from = a.messages.length;
      a.send({ t: 'ops', req: r, ops });
      return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === r, 5000, from);
    };
    await send([{ op: 'create', objects: [{ id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Bühne' }] }]);
    a.send({ t: 'step' });

    // Abstimmung
    const from = a.messages.length;
    const started = await send([{ op: 'act', name: 'collab.vote.start', args: START }]);
    expect(started.t).toBe('ack');
    const vote = w.doc.getMap('collab.vote');
    await waitFor(() => !!vote.get('session'));
    expect(vote.get('session')).toMatchObject({ title: 'Welche Bühne?', startedByName: 'Mara', perPerson: 2 });
    const patch = await a.next((m) => m.t === 'patch' && !!m.ext?.['collab.vote'], 5000, from);
    expect(patch.ext['collab.vote'].session.title).toBe('Welche Bühne?');
    const cast = await send([{ op: 'act', name: 'collab.vote.cast', args: { objectId: 's1', delta: 1 } }]);
    expect(cast.results['0'].data.outcome).toBe('added');
    const votes = w.doc.getMap('collab.votes');
    await waitFor(() => votes.size === 1);
    expect([...votes.values()][0]).toEqual({ n: 1, name: 'Mara' });

    // Timer
    const t = await send([{ op: 'act', name: 'collab.timer.start', args: { ms: 120_000 } }]);
    expect(Math.abs(t.results['0'].data.now - Date.now())).toBeLessThan(5000);
    const timer = w.doc.getMap('collab.timer');
    await waitFor(() => (timer.get('timer') as { state?: string } | undefined)?.state === 'running');
    expect(timer.get('timer')).toMatchObject({ duration: 120_000, by: 'Mara' });

    // Pin umhängen
    await send([{ op: 'comment', thread: 't_1', msg: 'm_1', at: { x: 400, y: 400 }, text: 'Strom?' }]);
    a.send({ t: 'step' });
    await send([{ op: 'act', name: 'collab.commentMove', args: { thread: 't_1', x: 20, y: 30, objectId: 's1' } }]);
    a.send({ t: 'step' });
    const comments = w.doc.getMap('collab.comments');
    const th = () => comments.get('t_1') as Y.Map<unknown> | undefined;
    await waitFor(() => th()?.get('objectId') === 's1');
    expect([th()!.get('x'), th()!.get('y'), th()!.get('dx'), th()!.get('dy')]).toEqual([20, 30, 20, 30]);
    a.send({ t: 'undo', req: ++req });
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => th()?.get('x') === 400);
    expect(th()!.get('objectId')).toBeUndefined();
    // Abstimmung und Timer bleiben (ohne Rückgängig)
    expect(votes.size).toBe(1);
    expect((timer.get('timer') as { state: string }).state).toBe('running');
  });
});
