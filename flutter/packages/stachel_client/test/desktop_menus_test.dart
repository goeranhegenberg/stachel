// Desktop menus on the board screen (docs/features/desktop.md §1): a right click opens the object / board-area menu as
// a popup at the pointer (key hints at the right, submenus as their own popup), the board menu „⋮“ pops up in the
// desktop app, keys reach the board through BoardKeyboard, the introduction speaks of mouse and keyboard.

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Zelte', 'z': 'a0'},
  {'id': 'n2', 'type': 'sticky', 'x': 400, 'y': 300, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a1'},
];

Future<FixtureBoardSource> _board(WidgetTester tester, {Size size = const Size(1280, 800)}) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  GestureOnboarding.autoShow = false;
  addTearDown(() => GestureOnboarding.autoShow = true);
  addTearDown(BoardDesktop.resetForTest);
  final server = FakeStachelServer(myRole: 'edit');
  final client = TestStachelClient(server.client);
  final snap = BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)]);
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
        people: () async => const [Person('u:flo', 'Flo')],
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
      info: const ConnectionInfo(
        epoch: 'fixture',
        boardTitle: 'Sommerfest',
        role: 'edit',
        user: NativeUser(key: 'u:flo', name: 'Flo'),
        features: ['objects', 'ext', 'ops', 'undo', 'text', 'comments', 'presence'],
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
  return source;
}

BoardViewState _view(WidgetTester tester) => tester.state<BoardViewState>(find.byType(BoardView));

/// Screen point (global) of the world point [w].
Offset _at(WidgetTester tester, Offset w) =>
    tester.getTopLeft(find.byType(BoardView)) + _view(tester).editor.camera.value.toScreen(w);

Future<void> _rightClick(WidgetTester tester, Offset at) async {
  await tester.tapAt(at, kind: PointerDeviceKind.mouse, buttons: kSecondaryMouseButton);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Rechtsklick auf eine Notiz: Objekt-Menü als Popup am Mauszeiger, mit Tastenkürzeln', (tester) async {
    await _board(tester);
    final at = _at(tester, const Offset(100, 100));
    await _rightClick(tester, at);
    expect(_view(tester).editor.selection.value, {'n1'});
    expect(find.byKey(const Key('stachelObjectMenuPopup')), findsOneWidget);
    expect(find.byKey(const Key('stachelObjectMenu')), findsNothing); // no sheet
    final copy = find.byKey(const Key('stachelMenuCopy'));
    expect(copy, findsOneWidget);
    expect(find.descendant(of: copy, matching: find.text('Strg C')), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('stachelMenuDuplicate')), matching: find.text('Strg D')),
      findsOneWidget,
    );
    // the popup opens at the pointer (moved up as far as needed to fit the window)
    final r = tester.getRect(copy);
    expect((r.left - at.dx).abs(), lessThan(40));
    // a row runs its action after the popup closed
    await tester.tap(find.byKey(const Key('stachelMenuDuplicate')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelObjectMenuPopup')), findsNothing);
    expect(_view(tester).editor.controller.state.objects.length, 3);
  });

  testWidgets('Untermenü öffnet als eigenes Popup', (tester) async {
    await _board(tester);
    await _rightClick(tester, _at(tester, const Offset(100, 100)));
    final layer = find.byKey(const Key('stachelMenuLayer'));
    expect(layer, findsOneWidget);
    await tester.tap(layer);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelMenuFront')), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('stachelMenuFront')), matching: find.text('Strg Umschalt ]')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('stachelMenuFront')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelMenuFront')), findsNothing);
  });

  testWidgets('Rechtsklick auf leere Fläche: Flächen-Menü (Alles auswählen)', (tester) async {
    await _board(tester);
    await _rightClick(tester, _at(tester, const Offset(750, 60)));
    expect(find.byKey(const Key('stachelCanvasMenuPopup')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelSelectAll')));
    await tester.pumpAndSettle();
    expect(_view(tester).editor.selection.value, {'n1', 'n2'});
  });

  testWidgets('Langes Drücken mit dem Finger bringt weiter das Blatt', (tester) async {
    await _board(tester);
    final g = await tester.startGesture(_at(tester, const Offset(100, 100)));
    await tester.pump(const Duration(milliseconds: 700));
    await g.up();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelObjectMenu')), findsOneWidget);
    expect(find.byKey(const Key('stachelObjectMenuPopup')), findsNothing);
  });

  testWidgets('Desktop-App: Board-Menü „⋮“ als Popup oben rechts', (tester) async {
    BoardDesktop.enabled = true;
    await _board(tester);
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelBoardMenuSheetPopup')), findsOneWidget);
    expect(find.text('ANSICHT'), findsOneWidget);
    expect(find.byKey(const Key('stachelBoardMenuSheet')), findsNothing);
    final search = tester.getRect(find.byKey(const Key('stachelBoardSearch')));
    expect(search.right, greaterThan(1280 - 400));
  });

  testWidgets('Desktop-App: Board-Menü „Mausrad“ schaltet Zoomen ↔ Schwenken (wie im Web)', (tester) async {
    BoardDesktop.enabled = true;
    await _board(tester);
    expect(BoardDesktop.wheel.value, WheelMode.zoom);
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelBoardWheel')), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(const Key('stachelBoardWheel')), matching: find.text('Zoomen')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('stachelBoardWheel')));
    await tester.pumpAndSettle();
    expect(BoardDesktop.wheel.value, WheelMode.pan);
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: find.byKey(const Key('stachelBoardWheel')), matching: find.text('Schwenken')),
      findsOneWidget,
    );
    await tester.tapAt(const Offset(5, 700));
    await tester.pumpAndSettle();
    BoardPrefs.set(BoardDesktop.wheelKey, null);
  });

  testWidgets('Tasten erreichen das Board: Strg A, Entf, Strg Z', (tester) async {
    final source = await _board(tester);
    await tester.tapAt(_at(tester, const Offset(750, 60)), kind: PointerDeviceKind.mouse);
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();
    expect(_view(tester).editor.selection.value, {'n1', 'n2'});
    await tester.sendKeyEvent(LogicalKeyboardKey.delete);
    await tester.pumpAndSettle();
    expect(_view(tester).editor.controller.state.objects, isEmpty);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyZ);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump(const Duration(milliseconds: 100));
    // the server undoes (contract §8.6)
    expect(source.sent.where((m) => m['t'] == 'undo'), hasLength(1));
  });

  testWidgets('Nach dem Popup (Esc) gehen die Tasten wieder ans Board: Strg K öffnet die Palette', (tester) async {
    await _board(tester);
    await _rightClick(tester, _at(tester, const Offset(750, 60)));
    expect(find.byKey(const Key('stachelCanvasMenuPopup')), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelCanvasMenuPopup')), findsNothing);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelPaletteSheet')), findsOneWidget);
  });

  testWidgets('Desktop-App: Einführung mit Maus und Tastatur statt Fingergesten', (tester) async {
    BoardDesktop.enabled = true;
    await _board(tester);
    final ui = tester.widget<BoardUiScope>(find.byType(BoardUiScope).first).ui;
    showGestureOnboarding(tester.element(find.byType(BoardView)), ui).ignore();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.byKey(const Key('stachelOnboardingCard-wheel')), findsOneWidget);
    expect(find.textContaining('Mausrad = zoomen, Umschalt + Mausrad = seitlich'), findsOneWidget);
    for (var i = 0; i < 3; i++) {
      await tester.tap(find.byKey(const Key('stachelOnboardingNext')));
      for (var f = 0; f < 4; f++) {
        await tester.pump(const Duration(milliseconds: 150));
      }
    }
    expect(find.text('Rechtsklick = Menü'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelOnboardingNext')));
    await tester.pump(const Duration(milliseconds: 600));
  });
}
