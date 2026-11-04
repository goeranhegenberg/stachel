// Large-window layout (UX-Review P12 „Querformat und Tablet“, docs/features/desktop.md): from BoardDesktop.wideWidth the
// tool bar floats at the left edge with every tool and the web's key letters, the context bar floats above the
// selection, comments and frames open as panels at the right, sheets stay narrow, the board list is a grid of cards.
// Narrow windows (phone) keep the bars at the bottom.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Zelte', 'z': 'a0', 'color': '#fff27a'},
  {'id': 'n2', 'type': 'sticky', 'x': 400, 'y': 300, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a1'},
];

Map<String, Object?> _ext() => {
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
        {'id': 'x', 'by': 'u:mara', 'name': 'Mara', 'text': 'Reicht das?', 'at': '2026-11-01T10:00:00Z'},
      ],
    },
  },
};

Future<void> _board(WidgetTester tester, Size size) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  final server = FakeStachelServer(myRole: 'edit');
  final client = TestStachelClient(server.client);
  final snap = BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: _ext());
  final source = FixtureBoardSource(snap, rev: 9, title: 'Sommerfest');
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
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
        boardTitle: 'Sommerfest',
        role: 'edit',
        user: const NativeUser(key: 'u:flo', name: 'Flo'),
        features: const ['objects', 'ext', 'ops', 'undo', 'text', 'comments', 'presence'],
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
}

BoardViewState _view(WidgetTester tester) => tester.state<BoardViewState>(find.byType(BoardView));
BoardUi _ui(WidgetTester tester) => tester.widget<BoardUiScope>(find.byType(BoardUiScope).first).ui;

/// Selects [id] and returns its box on the screen (global coordinates).
Future<Rect> _select(WidgetTester tester, String id) async {
  final v = _view(tester);
  v.editor.select({id});
  await tester.pump();
  final world = v.editor.selectionBounds({id})!;
  final origin = tester.getTopLeft(find.byType(BoardView));
  return v.camera.value.rectToScreen(world).shift(origin);
}

void main() {
  setUp(() => GestureOnboarding.autoShow = false);

  group('Großes Fenster (1440 × 900)', () {
    testWidgets('Werkzeugleiste links mit allen Werkzeugen und Tasten, unten keine Leiste', (tester) async {
      await _board(tester, const Size(1440, 900));
      final bar = find.byKey(const Key('stachelSideToolbar'));
      expect(bar, findsOneWidget);
      final r = tester.getRect(bar);
      expect(r.left, lessThan(30));
      expect(r.center.dy, closeTo(tester.getRect(find.byType(BoardView)).center.dy, 60));
      expect(find.byType(BoardToolbar), findsNothing);
      // tools the phone keeps behind „Weitere Werkzeuge“ stand in the bar too, tooltips name the web's keys
      expect(find.descendant(of: bar, matching: find.byKey(const Key('stachelToolMore'))), findsNothing);
      expect(find.byTooltip('Haftnotiz (N)'), findsOneWidget);
      expect(find.byTooltip('Rückgängig (Strg Z)'), findsOneWidget);
      // picking the pen shows its options to the right of the bar
      final pen = _ui(tester).registry.tools.list().firstWhere((t) => t.id == 'pen');
      await tester.tap(find.byKey(Key(pen.keyName ?? 'stachelTool-pen')));
      await tester.pump();
      final options = find.byKey(const Key('stachelSideToolOptions'));
      expect(options, findsOneWidget);
      expect(tester.getRect(options).left, greaterThan(r.right));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Kontextleiste schwebt über der Auswahl und folgt der Kamera', (tester) async {
      await _board(tester, const Size(1440, 900));
      final box = await _select(tester, 'n2');
      final bar = find.byKey(const Key('stachelBoardSelection'));
      expect(bar, findsOneWidget);
      var r = tester.getRect(bar);
      expect(r.bottom, lessThanOrEqualTo(box.top));
      expect(r.center.dx, closeTo(box.center.dx, 2));
      expect(r.width, lessThan(BoardContextBar.floatingMaxWidth + 1));
      // not docked at the bottom
      expect(r.bottom, lessThan(tester.getRect(find.byType(BoardView)).bottom - 100));
      // the camera moves: the bar goes along
      _view(tester).camera.panBy(const Offset(60, 40));
      await tester.pump();
      final moved = tester.getRect(bar);
      expect(moved.center.dx - r.center.dx, closeTo(60, 1));
      expect(moved.top - r.top, closeTo(40, 1));
      // no room above the selection: the bar goes below it
      final v = _view(tester);
      Rect local() => v.camera.value.rectToScreen(v.editor.selectionBounds({'n2'})!);
      v.camera.panBy(Offset(0, 10 - local().top));
      await tester.pump();
      final origin = tester.getTopLeft(find.byType(BoardView));
      expect(tester.getRect(bar).top, greaterThanOrEqualTo(local().shift(origin).bottom));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Kommentare und Rahmen als Leiste rechts, Blätter schmal', (tester) async {
      await _board(tester, const Size(1440, 900));
      final ui = _ui(tester);
      (ui.host as dynamic).showComments();
      await tester.pumpAndSettle();
      final panel = find.byKey(const Key('stachelCommentPanel'));
      expect(panel, findsOneWidget);
      expect(find.byKey(const Key('stachelCommentList')), findsOneWidget);
      final side = tester.getRect(find.descendant(of: panel, matching: find.byType(Material)).first);
      expect(side.right, 1440);
      expect(side.width, 380);
      expect(side.height, 900);
      await tester.tap(find.byKey(const Key('stachelSidePanelClose')));
      await tester.pumpAndSettle();
      expect(panel, findsNothing);

      final context = tester.element(find.byType(BoardView));
      ui.openRegisteredSheet(context, framesListSheet);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelSidePanel')), findsOneWidget);
      expect(find.text('RAHMEN'), findsOneWidget);
      // a click on the board beside it closes it
      await tester.tapAt(const Offset(400, 450));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelSidePanel')), findsNothing);

      // other sheets stay at the bottom, at most 560 wide
      ui.openSheet<void>(context, (_) => const SizedBox(key: Key('probe'), height: 100));
      await tester.pumpAndSettle();
      expect(tester.getRect(find.byKey(const Key('probe'))).width, lessThanOrEqualTo(BoardUi.wideSheetWidth));
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('Handy (400 × 800): Leisten unten wie bisher', (tester) async {
    await _board(tester, const Size(400, 800));
    expect(find.byKey(const Key('stachelSideToolbar')), findsNothing);
    expect(find.byType(BoardToolbar), findsOneWidget);
    await _select(tester, 'n2');
    final bar = tester.getRect(find.byKey(const Key('stachelBoardSelection')));
    // docked at the bottom over the full width
    expect(bar.width, greaterThan(370));
    expect(bar.bottom, greaterThan(tester.getRect(find.byType(BoardView)).bottom - 20));
    (_ui(tester).host as dynamic).showComments();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelCommentPanel')), findsNothing);
    expect(find.byType(BottomSheet), findsOneWidget);
  });

  testWidgets('Board-Liste ab 600 Breite als Raster', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
    final client = TestStachelClient(FakeStachelServer().client);
    Future<void> pump(Size size) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        MaterialApp(
          home: StachelHomeScreen(
            client: client,
            boardsApi: TestBoardsApi(client),
            boardScreen: (id, title, object) => Scaffold(body: Text('Board $id')),
            showNativePreview: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    addTearDown(tester.view.reset);
    await pump(const Size(1200, 900));
    expect(find.byKey(const Key('stachelBoardGrid')), findsOneWidget);
    final a = tester.getRect(find.byKey(const Key('stachelBoard-b1')));
    final b = tester.getRect(find.byKey(const Key('stachelBoard-b2')));
    // side by side in one row (1200 / 340 → 3 columns)
    expect(b.top, a.top);
    expect(b.left, greaterThan(a.right));
    await pump(const Size(400, 900));
    expect(find.byKey(const Key('stachelBoardGrid')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
