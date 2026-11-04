// UX-A1 (docs/ux_review_app_2026-11.md P1, P2, P14) on the board screen: app bar with the title ≥ 60 % of the width
// (no „Alles zeigen“, no undo/redo there – they sit in the tool bar and, while writing, in the edit bar), the mention
// as a slim chip that shrinks to „@ 1“, dark mode through `Sk.darkStyle` (bars dark, things on the board keep the
// light ink), the extension points of host apps (no own templates in the package, the organisation's name in texts).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Zelte', 'z': 'a0', 'color': '#fff27a'},
];

Map<String, Object?> _mention() => {
  'collab.comments': {
    't1': {
      'x': 100,
      'y': 100,
      'objectId': 'n1',
      'dx': 100,
      'dy': 100,
      'resolved': false,
      'createdBy': 'u:mara',
      'createdAt': '2026-11-01T10:00:00Z',
      'messages': [
        {
          'id': 'x',
          'by': 'u:mara',
          'name': 'Mara',
          'text': '@Flo reicht das?',
          'at': '2026-11-01T10:00:00Z',
          'mentions': ['u:flo'],
        },
      ],
    },
  },
};

const _darkStyle = StachelStyle(ink: Color(0xFFF1F1EC), paper: Color(0xFF1B1B1E), grey: Color(0xFFA6A6A0));

Future<FixtureBoardSource> _board(
  WidgetTester tester, {
  String title = 'Sommerfest 2027 – Planung',
  Map<String, Object?> ext = const {},
  ThemeData? theme,
  double width = 390,
}) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  final server = FakeStachelServer(myRole: 'edit');
  final client = TestStachelClient(server.client);
  final snap = BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: ext);
  final source = FixtureBoardSource(snap, rev: 9, title: title);
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      builder: (context, child) {
        Sk.follow(context);
        return child!;
      },
      home: StachelBoardScreen(
        client: client,
        boardId: 'b1',
        boardsApi: TestBoardsApi(client),
        source: source,
        images: NoBoardImages(),
        cache: MemoryBoardCache(),
        uploads: MemoryStachelUploads(),
        pendingStore: MemoryPendingStore(),
        people: () async => const [Person('u:mara', 'Mara'), Person('u:flo', 'Flo')],
        template: false,
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
  source.push(
    WelcomeMessage(
      proto: 1,
      rev: 9,
      snapshot: snap,
      info: ConnectionInfo(
        epoch: 'fixture',
        boardTitle: title,
        role: 'edit',
        user: const NativeUser(key: 'u:flo', name: 'Flo'),
        features: const ['objects', 'ext', 'ops', 'undo', 'text', 'comments', 'presence'],
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
  return source;
}

BoardViewState _view(WidgetTester tester) => tester.state<BoardViewState>(find.byType(BoardView));

void main() {
  tearDown(() {
    Sk.darkStyle = null;
    Sk.brightness = Brightness.light;
  });

  testWidgets('P1: App-Leiste – Titel ≥ 60 % der Breite, kein „Alles zeigen“, Rückgängig unten links', (tester) async {
    await _board(tester);
    expect(find.byKey(const Key('stachelBoardFit')), findsNothing);
    final title = find.text('Sommerfest 2027 – Planung');
    expect(title, findsOneWidget);
    // the whole title fits next to the avatars and „⋮“, and it may take ≥ 60 % of the bar
    final appBar = tester.getRect(find.byType(AppBar));
    final peers = tester.getRect(find.byKey(const Key('stachelPeers')));
    final text = tester.getRect(title);
    expect(text.right, lessThanOrEqualTo(peers.left));
    expect((peers.left - text.left) / appBar.width, greaterThanOrEqualTo(0.6));
    final undo = find.byKey(const Key('stachelUndo'));
    expect(undo, findsOneWidget);
    expect(find.descendant(of: find.byType(BoardToolbar), matching: undo), findsOneWidget);
    expect(find.descendant(of: find.byType(AppBar), matching: undo), findsNothing);
  });

  testWidgets('P1: beim Schreiben Rückgängig in der Schreibleiste – beendet erst das Schreiben (web C20)', (
    tester,
  ) async {
    // the test font is wider than Barlow: room for „NÄCHSTE NOTIZ“ next to undo/redo
    final source = await _board(tester, width: 600);
    _view(tester).editor.select({'n1'});
    await tester.pump();
    _view(tester).editText('n1');
    await tester.pump();
    await tester.pump();
    expect(find.byType(BoardToolbar), findsNothing);
    final undo = find.byKey(const Key('stachelUndo'));
    expect(find.descendant(of: find.byType(StachelEditBar), matching: undo), findsOneWidget);
    await tester.enterText(find.byKey(const Key('boardTextField')), 'Zelte und');
    await tester.pump(const Duration(milliseconds: 400)); // a first text step, undo is possible
    await tester.enterText(find.byKey(const Key('boardTextField')), 'Zelte und Bühne');
    await tester.pump(const Duration(milliseconds: 50)); // text op still debounced
    await tester.tap(undo);
    await tester.pump();
    expect(find.byKey(const Key('boardTextField')), findsNothing, reason: 'Schreiben beendet');
    final kinds = [
      for (final m in source.sent)
        if (m['t'] == 'ops' || m['t'] == 'undo') m['t'] == 'undo' ? 'undo' : (m['ops'] as List).last['op'],
    ];
    expect(kinds.sublist(kinds.length - 2), ['text', 'undo'], reason: 'der Text geht vor dem undo raus');
  });

  testWidgets('P2: Erwähnung als schmaler Chip, nach 8 s klein „@ 1“, Antippen öffnet den Faden', (tester) async {
    await _board(tester, ext: _mention());
    expect(find.byKey(const Key('stachelMentioned')), findsOneWidget);
    expect(find.text('Mara: „@Flo reicht das?“'), findsOneWidget);
    expect(tester.getSize(find.byKey(const Key('stachelMentioned'))).height, lessThan(52), reason: 'eine Zeile');
    await tester.pump(const Duration(seconds: 9));
    expect(find.byKey(const Key('stachelMentionedSmall')), findsOneWidget);
    expect(find.text('@ 1'), findsOneWidget);
    expect(find.byKey(const Key('stachelMentionedQuote')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelMentionedSmall')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelThread')), findsOneWidget);
  });

  testWidgets(
    'P14: Dunkelmodus nur mit Sk.darkStyle – Leisten dunkel, Hinweise auf dem Board behalten die helle Tinte',
    (tester) async {
      // without the hook (a host app without dark mode): stays light even with a dark theme
      await _board(tester, theme: ThemeData(brightness: Brightness.dark));
      expect(Sk.dark, isFalse);
      expect(Sk.ink, StachelStyle.stachel.ink);

      Sk.darkStyle = _darkStyle;
      Sk.brightness = Brightness.light;
      await tester.pumpWidget(const SizedBox());
      await _board(tester, theme: ThemeData(brightness: Brightness.dark));
      expect(Sk.dark, isTrue);
      expect(Sk.ink, _darkStyle.ink);
      expect(Sk.canvasInk, StachelStyle.stachel.ink, reason: 'das Board bleibt hell');
      final ui = tester.widget<BoardUiScope>(find.byType(BoardUiScope)).ui;
      expect(ui.theme.surface, _darkStyle.paper);
      expect(ui.theme.canvasInk, StachelStyle.stachel.ink);
      final bar = tester.widget<Material>(
        find.descendant(of: find.byType(BoardToolbar), matching: find.byType(Material)).first,
      );
      expect(bar.color, _darkStyle.paper);
    },
  );

  test('P9: Mindmap-Vorlagen nur über die Host-App (mindmapTemplateTool), nicht im Paket', () {
    final tools = stachelBoardRegistry.tools.list().map((t) => t.id).toList();
    expect(tools, contains('structure.mindmap'));
    expect(tools.where((id) => id.contains('Template')), isEmpty);
    final own = registerStachelAppFeatures(standardBoardRegistry())
      ..defineTool(
        mindmapTemplateTool(
          id: 'host.plan',
          template: const MindTreeSpec('Plan', children: [MindTreeSpec('A')]),
        ),
      );
    expect(own.tools.list().map((t) => t.label), contains('Mindmap-Vorlage „Plan“'));
  });

  test('Vorlagen der Instanz: GET /api/templates/instance mit der App-Sitzung, Host leitet weiter', () async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
    final seen = <String>[];
    final client = MockClient((req) async {
      seen.add('${req.method} ${req.url.path} ${req.headers['Authorization']}');
      return json({
        'ok': true,
        'category': 'Beispielverein',
        'templates': [
          {'id': 'a.plan', 'name': 'Plan', 'desc': '', 'keywords': [], 'objects': _objects},
        ],
      });
    });
    final raw = await HttpStachelBoardsApi(TestStachelClient(client)).instanceTemplates();
    expect(seen, ['GET /api/templates/instance Bearer sts_test']);
    final pack = InstanceTemplates.fromJson(raw);
    expect((pack.category, pack.list.single.name), ('Beispielverein', 'Plan'));
  });

  test('Org-Name in den Fehlertexten: neutral ohne, mit stachelOrgName bzw. org', () {
    addTearDown(() => stachelOrgName = null);
    expect(stachelErrorText('invalid_token', null), 'Deine Anmeldung ist abgelaufen – bitte melde dich neu an.');
    expect(stachelErrorText('org_unreachable', null), startsWith('Deine Organisation ist gerade nicht erreichbar.'));
    expect(stachelErrorText('org_unreachable', 'Text vom Server'), 'Text vom Server');
    expect(StachelException.forCode('org_unreachable').canRescan, isTrue);
    stachelOrgName = 'Beispielverein';
    expect(StachelException.forCode('invalid_token').message, contains('bei Beispielverein'));
    expect(StachelException.forCode('pending').message, startsWith('Dein Konto bei Beispielverein wartet'));
    expect(stachelErrorText('org_unreachable', null, org: 'Anderer'), startsWith('Anderer ist gerade'));
  });
}
