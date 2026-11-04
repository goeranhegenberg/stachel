import { afterEach, describe, expect, it, vi } from 'vitest';
import { unreadMentions, type Thread } from '../collab/comments';
import { moderationApi } from './api';
import { isBlocked, setBlocked } from './blocked';
import { blockConfirmText } from './PersonActions';
import { reportInput, reportProblem } from './ReportDialog';

describe('Melden: Eingaben', () => {
  it('Grund nötig, Beschreibung bei „rechtswidrig“ und „anderes“ mindestens 10 Zeichen', () => {
    expect(reportProblem(null, '')).toBe('Bitte wähle einen Grund.');
    expect(reportProblem('spam', '')).toBeNull();
    expect(reportProblem('illegal', 'kurz')).toContain('mindestens 10 Zeichen');
    expect(reportProblem('other', '   lang genug, wirklich ')).toBeNull();
    expect(reportProblem('privacy', 'x'.repeat(2001))).toBe('Höchstens 2000 Zeichen.');
  });

  it('Body je Art: nur die passenden Felder', () => {
    expect(reportInput({ kind: 'board', boardId: 'b1' }, 'spam', '  ')).toEqual({ boardId: 'b1', reason: 'spam' });
    expect(reportInput({ kind: 'object', boardId: 'b1', objectId: 'o1' }, 'copyright', ' Foto aus dem Netz ')).toEqual({
      boardId: 'b1',
      objectId: 'o1',
      reason: 'copyright',
      text: 'Foto aus dem Netz',
    });
    expect(reportInput({ kind: 'comment', boardId: 'b1', commentId: 't1', messageId: 'm2', userKey: 'u:1', name: 'Tom' }, 'harassment', '')).toEqual({
      boardId: 'b1',
      commentId: 't1',
      messageId: 'm2',
      reason: 'harassment',
    });
    expect(reportInput({ kind: 'person', boardId: 'b1', userKey: 'u:1', name: 'Tom' }, 'harassment', '')).toEqual({ boardId: 'b1', userKey: 'u:1', reason: 'harassment' });
  });

  it('Blockieren-Bestätigung sagt, was passiert', () => {
    expect(blockConfirmText('Tom')).toBe(
      'Einladungen und @Erwähnungen von Tom erreichen dich dann nicht mehr. Tom erfährt davon nichts. Du kannst das in deinem Konto jederzeit aufheben.',
    );
  });
});

describe('Blockieren', () => {
  afterEach(() => {
    setBlocked([]);
    vi.unstubAllGlobals();
  });

  it('ungelesene @Erwähnungen blockierter Personen zählen nicht', () => {
    const msg = (id: string, by: string) => ({ id, by, name: by, text: '@Mia', at: `2026-11-02T10:00:0${id}Z`, mentions: ['mia'] });
    const threads = [{ id: 't', messages: [msg('1', 'tom'), msg('2', 'olga')] } as unknown as Thread];
    expect(unreadMentions(threads, 'mia', undefined).map((u) => u.msg.by)).toEqual(['olga', 'tom']);
    setBlocked([{ key: 'tom', name: 'Tom', at: '2026-11-02T09:00:00Z' }]);
    expect(isBlocked('tom')).toBe(true);
    expect(unreadMentions(threads, 'mia', undefined).map((u) => u.msg.by)).toEqual(['olga']);
  });

  it('API: Schlüssel kodiert, Schreiben mit X-Stachel', async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ ok: true, blocked: [{ key: 'u:1', name: 'Tom', at: 'x' }] }), { headers: { 'content-type': 'application/json' } });
    });
    expect(await moderationApi.block('u:1/x')).toEqual([{ key: 'u:1', name: 'Tom', at: 'x' }]);
    await moderationApi.unblock('u:1');
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['PUT', '/api/blocks/u%3A1%2Fx'],
      ['DELETE', '/api/blocks/u%3A1'],
    ]);
    expect(calls[0]!.headers['X-Stachel']).toBe('1');
  });

  it('API: Meldung und Fehlertext vom Server', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.reason === 'illegal') return new Response(JSON.stringify({ ok: false, error: 'text_required', message: 'Bitte beschreibe kurz …' }), { status: 400, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, report: { id: 'R-ABCDEFGH', createdAt: 'x' }, mailed: true }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    expect((await moderationApi.report({ boardId: 'b', reason: 'spam' })).report.id).toBe('R-ABCDEFGH');
    await expect(moderationApi.report({ boardId: 'b', reason: 'illegal' })).rejects.toThrow('Bitte beschreibe kurz …');
  });
});
