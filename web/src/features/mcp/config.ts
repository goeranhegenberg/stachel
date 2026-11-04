// Fertige Einrichtung für KI-Assistenten (Claude Code, Claude Desktop, andere MCP-Clients) aus MCP-Adresse und Token.
// Ohne React, testbar. Vertrag: docs/features/mcp.md.

export interface McpSetup {
  id: string;
  title: string;
  hint: string;
  code: string;
}

/** Adresse des Stachel-Servers aus der MCP-Adresse (…/mcp abschneiden). */
export const stachelUrlOf = (mcpUrl: string) => mcpUrl.replace(/\/mcp\/?$/, '');

export function mcpSetups(mcpUrl: string, token: string): McpSetup[] {
  const base = stachelUrlOf(mcpUrl);
  const desktop = {
    mcpServers: {
      stachel: {
        command: 'npx',
        args: ['-y', `${mcpUrl}/stachel-mcp.tgz`, '--url', base],
        env: { STACHEL_TOKEN: token },
      },
    },
  };
  return [
    {
      id: 'claude-code',
      title: 'Claude Code',
      hint: 'Im Terminal ausführen, danach in Claude Code mit /mcp prüfen.',
      code: `claude mcp add --transport http stachel ${mcpUrl} --header "Authorization: Bearer ${token}"`,
    },
    {
      id: 'claude-desktop',
      title: 'Claude Desktop',
      hint: 'In claude_desktop_config.json einfügen (Einstellungen → Entwickler → Konfiguration bearbeitet) und Claude neu starten. Braucht Node.js; Bildschirmfotos nutzen Chrome oder Edge.',
      code: JSON.stringify(desktop, null, 2),
    },
    {
      id: 'http',
      title: 'Andere MCP-Clients',
      hint: 'Streamable HTTP mit Bearer-Token.',
      code: `URL:    ${mcpUrl}\nHeader: Authorization: Bearer ${token}`,
    },
  ];
}

/** „vor 3 Tagen“ usw. für „zuletzt benutzt“. */
export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'noch nie benutzt';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return 'gerade eben benutzt';
  const m = Math.round(s / 60);
  if (m < 90) return `vor ${m} Minuten benutzt`;
  const h = Math.round(m / 60);
  if (h < 36) return `vor ${h} Stunden benutzt`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'gestern benutzt' : `vor ${d} Tagen benutzt`;
}
