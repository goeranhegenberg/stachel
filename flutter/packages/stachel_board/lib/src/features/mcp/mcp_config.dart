import 'dart:convert';

// Ready-made setup for AI assistants (port of web `features/mcp/config.ts`): Claude Code, Claude Desktop, other MCP
// clients from the MCP address and the token; „zuletzt benutzt“ texts.

/// One way to set up an assistant (web `McpSetup`).
class McpSetup {
  const McpSetup({required this.id, required this.title, required this.hint, required this.code});
  final String id;
  final String title;
  final String hint;
  final String code;
}

/// Address of the Stachel server from the MCP address (`…/mcp` cut off).
String stachelUrlOf(String mcpUrl) => mcpUrl.replaceFirst(RegExp(r'/mcp/?$'), '');

/// The three setups with [token] filled in (texts and code exactly like the web).
List<McpSetup> mcpSetups(String mcpUrl, String token) {
  final base = stachelUrlOf(mcpUrl);
  final desktop = {
    'mcpServers': {
      'stachel': {
        'command': 'npx',
        'args': ['-y', '$mcpUrl/stachel-mcp.tgz', '--url', base],
        'env': {'STACHEL_TOKEN': token},
      },
    },
  };
  return [
    McpSetup(
      id: 'claude-code',
      title: 'Claude Code',
      hint: 'Im Terminal ausführen, danach in Claude Code mit /mcp prüfen.',
      code: 'claude mcp add --transport http stachel $mcpUrl --header "Authorization: Bearer $token"',
    ),
    McpSetup(
      id: 'claude-desktop',
      title: 'Claude Desktop',
      hint:
          'In claude_desktop_config.json einfügen (Einstellungen → Entwickler → Konfiguration bearbeitet) und Claude '
          'neu starten. Braucht Node.js; Bildschirmfotos nutzen Chrome oder Edge.',
      code: const JsonEncoder.withIndent('  ').convert(desktop),
    ),
    McpSetup(
      id: 'http',
      title: 'Andere MCP-Clients',
      hint: 'Streamable HTTP mit Bearer-Token.',
      code: 'URL:    $mcpUrl\nHeader: Authorization: Bearer $token',
    ),
  ];
}

/// „noch nie benutzt“, „gerade eben benutzt“, „vor 5 Minuten benutzt“, „vor 3 Stunden benutzt“, „gestern benutzt“,
/// „vor 4 Tagen benutzt“ (web `agoText`).
String agoText(DateTime? at, {DateTime? now}) {
  if (at == null) return 'noch nie benutzt';
  final ms = (now ?? DateTime.now()).millisecondsSinceEpoch - at.millisecondsSinceEpoch;
  final s = ms <= 0 ? 0 : (ms / 1000).round();
  if (s < 90) return 'gerade eben benutzt';
  final m = (s / 60).round();
  if (m < 90) return 'vor $m Minuten benutzt';
  final h = (m / 60).round();
  if (h < 36) return 'vor $h Stunden benutzt';
  final d = h ~/ 24;
  return d == 1 ? 'gestern benutzt' : 'vor $d Tagen benutzt';
}

/// „2.11.2026“ (web `toLocaleDateString('de-DE')`).
String shortDate(DateTime t) {
  final l = t.toLocal();
  return '${l.day}.${l.month}.${l.year}';
}
