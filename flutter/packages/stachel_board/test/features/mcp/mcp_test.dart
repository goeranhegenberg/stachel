// P6 AI access (audit B13): setups and „zuletzt benutzt“ like the web (`features/mcp/mcp.test.ts`), the sheet with a
// fake host (list, create → token once with setup, tabs, share/copy, revoke with question, errors) and the board menu
// entry (only with the app's host).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/mcp/mcp_config.dart';
import 'package:stachel_board/src/features/mcp/mcp_sheet.dart';
import 'package:stachel_board/stachel_board.dart';

class _Host extends BoardHost implements BoardAdminHost {
  final tokens = <McpToken>[
    McpToken(id: 't1', label: 'Laptop', hint: 'ab12', createdAt: DateTime(2026, 10, 3), lastUsedAt: null),
    McpToken(id: 't0', label: 'Alt', hint: 'cd34', createdAt: DateTime(2026, 9, 1), expiresAt: DateTime(2027, 9, 1)),
  ];
  final shared = <(String, String?)>[];
  final copied = <String>[];
  final revoked = <String>[];
  Object? fail;

  @override
  String errorText(Object error) => 'Fehler: $error';
  @override
  bool get isTemplate => false;
  @override
  String get boardTitle => 'Festival';
  @override
  Future<void> duplicateBoard() async {}
  @override
  Future<void> saveAsTemplate() async {}
  @override
  Future<List<BoardVersion>> listVersions() async => const [];
  @override
  Future<BoardVersion> saveVersion(String name) => throw UnimplementedError();
  @override
  Future<BoardVersion> renameVersion(String id, String name) => throw UnimplementedError();
  @override
  Future<bool> restoreVersion(String id) async => true;
  @override
  Future<void> openVersionCopy(String id, String title) async {}
  @override
  Future<Map<String, Object?>> versionSnapshot(String id) async => const {};
  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async {}
  @override
  Future<McpTokens> listTokens() async {
    if (fail != null) throw fail!;
    return McpTokens([...tokens], 'https://s.test/mcp');
  }

  @override
  Future<McpNewToken> createToken(String label) async {
    final t = McpToken(id: 't${tokens.length + 1}', label: label, hint: 'zz99', createdAt: DateTime(2026, 11, 2));
    tokens.insert(0, t);
    return McpNewToken(token: t, secret: 'stk_geheim', mcpUrl: 'https://s.test/mcp');
  }

  @override
  Future<void> revokeToken(String id) async {
    revoked.add(id);
    tokens.removeWhere((t) => t.id == id);
  }

  @override
  Future<void> shareText(String text, {String? subject}) async => shared.add((text, subject));
  @override
  Future<void> copyText(String text) async => copied.add(text);
}

Future<BoardUi> _ui(WidgetTester tester, BoardHost host) async {
  final controller = BoardController(FixtureBoardSource(BoardSnapshot.fromJson({'objects': []})), presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
  await controller.start();
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  return ui;
}

void main() {
  group('Einrichtung wie im Web (mcp.test.ts)', () {
    const url = 'https://stachel.example.org/mcp';
    const token = 'stk_abc123';

    test('Claude Code: claude mcp add mit Transport http und Bearer-Header', () {
      final cc = mcpSetups(url, token).firstWhere((s) => s.id == 'claude-code');
      expect(
        cc.code,
        'claude mcp add --transport http stachel https://stachel.example.org/mcp --header "Authorization: Bearer stk_abc123"',
      );
    });

    test('Claude Desktop: gültiges JSON mit npx-Paket von der eigenen Instanz und Token als Umgebung', () {
      final d = jsonDecode(mcpSetups(url, token).firstWhere((s) => s.id == 'claude-desktop').code) as Map;
      final s = (d['mcpServers'] as Map)['stachel'] as Map;
      expect(s['command'], 'npx');
      expect(s['args'], ['-y', 'https://stachel.example.org/mcp/stachel-mcp.tgz', '--url', 'https://stachel.example.org']);
      expect(s['env'], {'STACHEL_TOKEN': token});
      expect(mcpSetups(url, token).map((s) => s.title), ['Claude Code', 'Claude Desktop', 'Andere MCP-Clients']);
    });

    test('Basis-Adresse aus der MCP-Adresse', () {
      expect(stachelUrlOf('https://x.test/mcp'), 'https://x.test');
      expect(stachelUrlOf('https://x.test/mcp/'), 'https://x.test');
    });

    test('zuletzt benutzt', () {
      final now = DateTime.parse('2026-10-30T12:00:00Z');
      expect(agoText(null, now: now), 'noch nie benutzt');
      expect(agoText(DateTime.parse('2026-10-30T11:59:30Z'), now: now), 'gerade eben benutzt');
      expect(agoText(DateTime.parse('2026-10-30T11:00:00Z'), now: now), 'vor 60 Minuten benutzt');
      expect(agoText(DateTime.parse('2026-10-29T00:00:00Z'), now: now), 'gestern benutzt');
      expect(agoText(DateTime.parse('2026-10-25T12:00:00Z'), now: now), 'vor 5 Tagen benutzt');
    });

    test('Token aus dem Server-JSON', () {
      final t = McpToken.fromJson({'id': 'x', 'label': 'L', 'hint': 'ab12', 'createdAt': '2026-11-02T10:00:00Z', 'lastUsedAt': null})!;
      expect((t.id, t.label, t.hint, t.lastUsedAt), ('x', 'L', 'ab12', null));
      expect(McpToken.fromJson({'label': 'ohne id'}), isNull);
      expect(t.expiresAt, isNull);
      final e = McpToken.fromJson({'id': 'y', 'createdAt': '2026-11-02T10:00:00Z', 'expiresAt': '2027-11-02T10:00:00Z'})!;
      expect(e.expiresAt, DateTime.parse('2027-11-02T10:00:00Z'));
    });
  });

  group('Blatt „KI-Zugang (MCP)“', () {
    Future<_Host> open(WidgetTester tester, {_Host? host}) async {
      final h = host ?? _Host();
      final ui = await _ui(tester, h);
      tester.view.physicalSize = const Size(420, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: McpSheet(ui: ui, host: h)))));
      await tester.pumpAndSettle();
      return h;
    }

    testWidgets('Liste mit „…hint · angelegt … · noch nie benutzt“, anlegen zeigt das Token einmal mit Einrichtung',
        (tester) async {
      final h = await open(tester);
      expect(find.text('Laptop'), findsOneWidget);
      expect(find.text('…ab12 · angelegt 3.10.2026 · noch nie benutzt'), findsOneWidget);
      expect(find.text('…cd34 · angelegt 1.9.2026 · noch nie benutzt · verfällt am 1.9.2027'), findsOneWidget);
      expect(find.byKey(const Key('stachelMcpFresh')), findsNothing);
      // legal CR-9: hint before creating a token
      expect(find.byKey(const Key('stachelMcpPrivacyNote')), findsOneWidget);
      expect(find.textContaining('auch Namen und Kommentare anderer'), findsOneWidget);
      expect(find.textContaining('12 Monate nicht benutzt'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('stachelMcpLabel')), 'Claude am Laptop');
      await tester.tap(find.byKey(const Key('stachelMcpCreate')));
      await tester.pumpAndSettle();
      expect(find.text('Token „Claude am Laptop“ ist angelegt'), findsOneWidget);
      expect(find.text('stk_geheim'), findsOneWidget);
      expect(
        find.text('claude mcp add --transport http stachel https://s.test/mcp --header "Authorization: Bearer stk_geheim"'),
        findsOneWidget,
      );
      expect(h.tokens.first.label, 'Claude am Laptop');

      // share the secret (phone instead of copy), copy too
      await tester.tap(find.byKey(const Key('stachelMcpSecretShare')));
      await tester.tap(find.byKey(const Key('stachelMcpSecretCopy')));
      await tester.pump();
      expect(h.shared.single.$1, 'stk_geheim');
      expect(h.copied.single, 'stk_geheim');
      expect(find.text('KOPIERT'), findsOneWidget);
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('KOPIERT'), findsNothing);

      // other setup
      await tester.tap(find.byKey(const Key('stachelMcpTab-http')));
      await tester.pumpAndSettle();
      expect(find.text('Streamable HTTP mit Bearer-Token.'), findsOneWidget);
      expect(find.text('URL:    https://s.test/mcp\nHeader: Authorization: Bearer stk_geheim'), findsOneWidget);
    });

    testWidgets('ohne Bezeichnung heißt das Token „KI-Assistent“', (tester) async {
      final h = await open(tester);
      await tester.tap(find.byKey(const Key('stachelMcpCreate')));
      await tester.pumpAndSettle();
      expect(h.tokens.first.label, 'KI-Assistent');
    });

    testWidgets('Widerrufen fragt nach; das angezeigte Token verschwindet mit', (tester) async {
      final h = await open(tester);
      await tester.tap(find.byKey(const Key('stachelMcpCreate')));
      await tester.pumpAndSettle();
      final fresh = h.tokens.first.id;
      await tester.tap(find.byKey(Key('stachelMcpRevoke-$fresh')));
      await tester.pumpAndSettle();
      expect(find.text('Token widerrufen?'), findsOneWidget);
      expect(find.textContaining('funktioniert danach sofort nicht mehr'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelMcpRevokeConfirm')));
      await tester.pumpAndSettle();
      expect(h.revoked, [fresh]);
      expect(find.byKey(const Key('stachelMcpFresh')), findsNothing);
      expect(find.byKey(Key('stachelMcpToken-$fresh')), findsNothing);
    });

    testWidgets('Fehler beim Laden wird angezeigt; leere Liste', (tester) async {
      await open(tester, host: _Host()..fail = 'weg');
      expect(find.text('Fehler: weg'), findsOneWidget);
      expect(find.text('Lade …'), findsOneWidget);
    });

    testWidgets('leere Liste', (tester) async {
      await open(tester, host: _Host()..tokens.clear());
      expect(find.text('Noch keine. Lege oben eins an.'), findsOneWidget);
    });
  });

  testWidgets('Board-Menü „KI-Zugang (MCP) …“ nur mit dem Host der App', (tester) async {
    final with_ = await _ui(tester, _Host());
    final without = await _ui(tester, const BoardHost());
    MenuEntry? entry(BoardUi ui) => ui.registry.menuItems['mcp.tokens']!.entry(ui, const MenuAt(Offset.zero));
    expect(entry(with_)?.label, 'KI-Zugang (MCP) …');
    expect(entry(with_)?.key, 'stachelBoardMcp');
    expect(entry(without), isNull);
    expect(with_.registry.menuItems['mcp.tokens']!.order, 85);
  });
}
