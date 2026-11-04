// CR-9 (docs/legal/datenschutz.md §8): Hinweis beim Anlegen eines KI-Tokens nennt, was der Assistent sieht und wohin es geht.
import { describe, expect, it } from 'vitest';
import { MCP_PRIVACY_NOTE } from './McpAccess';

describe('MCP-Hinweis', () => {
  it('nennt Namen/Kommentare anderer, den KI-Anbieter und den Ablauf nach 12 Monaten', () => {
    expect(MCP_PRIVACY_NOTE).toMatch(/Namen und Kommentare anderer/);
    expect(MCP_PRIVACY_NOTE).toMatch(/Anbieter des Assistenten/);
    expect(MCP_PRIVACY_NOTE).toMatch(/12 Monate/);
  });
});
