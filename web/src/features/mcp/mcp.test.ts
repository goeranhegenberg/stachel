import { describe, expect, it } from 'vitest';
import { agoText, mcpSetups, stachelUrlOf } from './config';

describe('KI-Zugang: Einrichtung', () => {
  const url = 'https://board.example.org/mcp';
  const token = 'stk_abc123';

  it('Claude Code: claude mcp add mit Transport http und Bearer-Header', () => {
    const cc = mcpSetups(url, token).find((s) => s.id === 'claude-code')!;
    expect(cc.code).toBe('claude mcp add --transport http stachel https://board.example.org/mcp --header "Authorization: Bearer stk_abc123"');
  });

  it('Claude Desktop: gültiges JSON mit npx-Paket von der eigenen Instanz und Token als Umgebung', () => {
    const d = JSON.parse(mcpSetups(url, token).find((s) => s.id === 'claude-desktop')!.code);
    expect(d.mcpServers.stachel.command).toBe('npx');
    expect(d.mcpServers.stachel.args).toEqual(['-y', 'https://board.example.org/mcp/stachel-mcp.tgz', '--url', 'https://board.example.org']);
    expect(d.mcpServers.stachel.env).toEqual({ STACHEL_TOKEN: token });
  });

  it('Basis-Adresse aus der MCP-Adresse', () => {
    expect(stachelUrlOf('https://x.test/mcp')).toBe('https://x.test');
    expect(stachelUrlOf('https://x.test/mcp/')).toBe('https://x.test');
  });

  it('zuletzt benutzt', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(agoText(null, now)).toBe('noch nie benutzt');
    expect(agoText('2026-10-30T11:59:30Z', now)).toBe('gerade eben benutzt');
    expect(agoText('2026-10-30T11:00:00Z', now)).toBe('vor 60 Minuten benutzt');
    expect(agoText('2026-10-29T00:00:00Z', now)).toBe('gestern benutzt');
    expect(agoText('2026-10-25T12:00:00Z', now)).toBe('vor 5 Tagen benutzt');
  });
});
