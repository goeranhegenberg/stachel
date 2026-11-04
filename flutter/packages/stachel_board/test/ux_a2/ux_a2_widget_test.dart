// UX-A2 (Welle UX+Q, docs/ux_review_app_2026-11.md): P13 finger taps (two = Rückgängig, three = Wiederholen, two twice
// = 100 %), P6 „Mehrere wählen“ chip with counter that ends after moving/acting, P3 voting regression (Bild 28c: a tap
// on a box in the overview voted for the connector), P5 gesture introduction (once per device, skippable, menu).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../features/follow/p5_harness.dart' show p5Actions, sticky;
import 'hit_test_zoom_test.dart' show festivalObjects;

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final hints = <String>[];
  BoardViewState get view => ui.view!;
  Camera get cam => view.camera.value;

  List<String> get history => [
    for (final m in source.sent)
      if (m['t'] == 'undo' || m['t'] == 'redo') m['t']! as String,
  ];

  List<(String, Map<String, Object?>)> get acts => [
    for (final m in source.sent)
      if (m['t'] == 'ops')
        for (final o in (m['ops'] as List).cast<Map<String, Object?>>())
          if (o['op'] == 'act') (o['name']! as String, (o['args'] as Map).cast<String, Object?>()),
  ];
}

/// Board view with overlays, context bar and board menu (like the app's screen), 390 × 760.
Future<_Board> _pump(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = const [],
  Map<String, Object?> ext = const {},
}) async {
  tester.view.physicalSize = const Size(390, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects, 'ext': ext}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: p5Actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  final b = _Board(controller, source, editor, ui);
  final sub = ui.hints.messages.listen(b.hints.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      home: BoardUiScope(
        ui: ui,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Board'),
            actions: [
              Builder(
                builder: (context) => IconButton(
                  key: const Key('stachelBoardMenu'),
                  icon: const Icon(Icons.more_vert),
                  onPressed: () => showBoardMenu(context, ui, MenuTarget.board, const MenuAt(Offset.zero)),
                ),
              ),
            ],
          ),
          body: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
                    ),
                    Positioned.fill(child: BoardOverlays(ui: ui)),
                  ],
                ),
              ),
              ListenableBuilder(
                listenable: Listenable.merge([editor, editor.selection]),
                builder: (context, _) => BoardContextBar(ui: ui),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await controller.start();
  controller.user = const NativeUser(key: 'a:mara', name: 'Mara Kern');
  await tester.pump();
  await tester.pump();
  return b;
}

Duration ms(int v) => Duration(milliseconds: v);

/// Scrolls the topmost sheet until the entry [key] is built and visible.
Future<void> _scrollTo(WidgetTester tester, String key) async {
  await tester.scrollUntilVisible(find.byKey(Key(key)), 200, scrollable: find.byType(Scrollable).last);
  await tester.pump();
}

/// Opens the board menu and taps the entry [key] (scrolled into view; the menu builds lazily).
Future<void> _menu(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(const Key('stachelBoardMenu')));
  await tester.pump();
  await tester.pump(ms(400));
  await _scrollTo(tester, key);
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
  await tester.pump(ms(400));
}

Offset _global(WidgetTester tester, _Board b, Offset world) =>
    tester.getTopLeft(find.byType(BoardView)) + b.cam.toScreen(world);

/// Taps with [fingers] fingers around [at] (screen, global), held [hold].
Future<void> fingerTap(
  WidgetTester tester,
  Offset at, {
  int fingers = 2,
  Duration hold = const Duration(milliseconds: 60),
}) async {
  final gs = <TestGesture>[];
  for (var i = 0; i < fingers; i++) {
    gs.add(await tester.startGesture(at + Offset(40.0 * i - 20.0 * (fingers - 1), 0), pointer: 10 + i));
  }
  await tester.pump(hold);
  for (final g in gs) {
    await g.up();
  }
  await tester.pump();
}

void main() {
  setUp(() {
    GestureOnboarding.autoShow = true;
    GestureOnboarding.resetForTest();
    BoardPrefs.load(const {});
    BoardPrefs.persist = null;
  });

  group('P13 Rückgängig/Wiederholen mit Fingern', () {
    testWidgets('zwei Finger tippen → Rückgängig (nach der Doppeltipp-Wartezeit), mit Hinweis', (tester) async {
      final b = await _pump(tester, objects: [sticky('n1', 40, 40, text: 'Bühne')]);
      b.editor.select({'n1'});
      b.editor.deleteSelection();
      expect(b.controller.canUndo, isTrue);
      final cam0 = b.cam;
      await fingerTap(tester, const Offset(195, 300));
      expect(b.history, isEmpty, reason: 'wartet noch auf einen zweiten Tipp');
      await tester.pump(ms(500));
      expect(b.history, ['undo']);
      expect(b.hints, contains(BoardViewState.undoneText));
      expect(b.cam, cam0, reason: 'die Ansicht springt nicht');
    });

    testWidgets('drei Finger tippen → Wiederholen sofort; nichts da → Hinweis', (tester) async {
      final b = await _pump(tester, objects: [sticky('n1', 40, 40)]);
      await fingerTap(tester, const Offset(195, 300), fingers: 3);
      expect(b.history, isEmpty);
      expect(b.hints, contains(BoardViewState.nothingToRedoText));
      b.controller.canRedo = true;
      await fingerTap(tester, const Offset(195, 300), fingers: 3);
      expect(b.history, ['redo']);
      expect(b.hints.last, BoardViewState.redoneText);
      await fingerTap(tester, const Offset(195, 300));
      await tester.pump(ms(500));
      expect(b.hints.last, BoardViewState.nothingToUndoText, reason: 'zwei Finger, nichts rückgängig zu machen');
    });

    testWidgets('zweimal mit zwei Fingern → 100 %, kein Rückgängig', (tester) async {
      final b = await _pump(tester, objects: [sticky('n1', 40, 40)]);
      b.editor.select({'n1'});
      b.editor.deleteSelection();
      b.view.camera.value = const Camera(0, 0, 0.4);
      await fingerTap(tester, const Offset(195, 300));
      await tester.pump(ms(150));
      await fingerTap(tester, const Offset(195, 300));
      expect(b.cam.z, 1);
      await tester.pump(ms(600));
      expect(b.history, isEmpty);
    });

    // (held too long: the unit test in e1_test.dart – widget-test pointer events carry no time stamps)
    testWidgets('zwei Finger ziehen (Pinch) ist kein Tipp', (tester) async {
      final b = await _pump(tester, objects: [sticky('n1', 40, 40)]);
      b.editor.select({'n1'});
      b.editor.deleteSelection();
      final g1 = await tester.startGesture(const Offset(150, 300), pointer: 1);
      final g2 = await tester.startGesture(const Offset(250, 300), pointer: 2);
      await tester.pump(ms(30));
      await g1.moveBy(const Offset(-60, 0));
      await g2.moveBy(const Offset(60, 0));
      await g1.up();
      await g2.up();
      await tester.pump(ms(600));
      expect(b.history, isEmpty);
      expect(b.cam.z, greaterThan(1), reason: 'gezoomt');
    });

    testWidgets('Gesten-Blatt nennt die neuen Gesten', (tester) async {
      await _pump(tester);
      await _menu(tester, 'stachelBoardGestures');
      for (final t in ['Mit zwei Fingern tippen', 'Rückgängig', 'Mit drei Fingern tippen', 'Wiederholen']) {
        await tester.scrollUntilVisible(find.text(t), 120, scrollable: find.byType(Scrollable).last);
        expect(find.text(t), findsOneWidget);
      }
    });
  });

  group('P6 „Mehrere wählen“', () {
    final objects = [sticky('a', 0, 0), sticky('b', 200, 0), sticky('c', 0, 200)];

    Future<void> tapWorld(WidgetTester tester, _Board b, Offset w) async {
      await tester.tapAt(_global(tester, b, w));
      await tester.pump(ms(350));
    }

    testWidgets('beschrifteter Chip mit Zähler; Tippen fügt hinzu', (tester) async {
      final b = await _pump(tester, objects: objects);
      b.view.camera.value = const Camera(20, 20, 1);
      await tapWorld(tester, b, const Offset(60, 60));
      expect(find.text('Mehrere wählen'), findsOneWidget);
      expect(find.byKey(const Key('stachelMultiSelectCount')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelMultiSelect')));
      await tester.pump();
      expect(b.editor.multiSelect, isTrue);
      expect(find.descendant(of: find.byKey(const Key('stachelMultiSelectCount')), matching: find.text('1')), findsOne);
      await tapWorld(tester, b, const Offset(260, 60));
      await tapWorld(tester, b, const Offset(60, 260));
      expect(b.editor.selection.value, {'a', 'b', 'c'});
      expect(find.descendant(of: find.byKey(const Key('stachelMultiSelectCount')), matching: find.text('3')), findsOne);
      expect(find.bySemanticsLabel('Mehrere wählen, an, 3 ausgewählt'), findsOneWidget);
      // tapping the chip again ends it, the selection stays
      await tester.tap(find.byKey(const Key('stachelMultiSelect')));
      await tester.pump();
      expect(b.editor.multiSelect, isFalse);
      expect(b.editor.selection.value, {'a', 'b', 'c'});
    });

    testWidgets('nach dem Verschieben schaltet es sich aus', (tester) async {
      final b = await _pump(tester, objects: objects);
      b.view.camera.value = const Camera(20, 20, 1);
      await tapWorld(tester, b, const Offset(60, 60));
      b.editor.multiSelect = true;
      await tapWorld(tester, b, const Offset(260, 60));
      expect(b.editor.selection.value, {'a', 'b'});
      // drag the selected note: moves the selection
      final g = await tester.startGesture(_global(tester, b, const Offset(60, 60)));
      await tester.pump(ms(50));
      for (var i = 0; i < 5; i++) {
        await g.moveBy(const Offset(0, 12));
        await tester.pump(ms(16));
      }
      await g.up();
      await tester.pump();
      expect(b.controller.state['a']!.y, greaterThan(40));
      expect(b.editor.multiSelect, isFalse, reason: 'aus nach dem Verschieben');
      expect(b.editor.selection.value, {'a', 'b'});
    });

    testWidgets('nach einer Aktion (Löschen, Farbe …) schaltet es sich aus; Tippen allein nicht', (tester) async {
      final b = await _pump(tester, objects: objects);
      b.view.camera.value = const Camera(20, 20, 1);
      await tapWorld(tester, b, const Offset(60, 60));
      b.editor.multiSelect = true;
      await tester.pump();
      await tapWorld(tester, b, const Offset(260, 60));
      expect(b.editor.multiSelect, isTrue, reason: 'Hinzufügen ändert nichts am Board');
      b.editor.deleteSelection();
      await tester.pump();
      expect(b.editor.multiSelect, isFalse);
    });
  });

  group('P3 Abstimmung im Festival-Board bei kleinem Zoom (Bild 28c)', () {
    var now = 1000000;
    setUp(() {
      now = 1000000;
      collabDeviceNow = () => now;
    });
    tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

    Map<String, Object?> vote() => {
      'collab.vote': {
        'session': {
          'id': 'v1',
          'title': 'Was zuerst?',
          'perPerson': 3,
          'multi': true,
          'endsAt': now + 300000,
          'startedBy': 'a:mara',
          'startedByName': 'Mara',
          'startedAt': 1,
          'ended': false,
          'anonymous': false,
        },
      },
    };

    for (final z in [0.17, 0.35, 1.0]) {
      testWidgets('Tipp auf „Bühne, Zelte und Bar aufbauen“ bei ${(z * 100).round()} % zählt als Stimme', (
        tester,
      ) async {
        final b = await _pump(tester, objects: festivalObjects(), ext: vote());
        // the box in the middle of the view
        b.view.camera.value = Camera(b.view.viewSize.width / 2 - 260 * z, b.view.viewSize.height / 2 - 365 * z, z);
        await tester.pump();
        expect(b.editor.hitPreference, isNotNull, reason: 'laufende Abstimmung bevorzugt Abstimmbares');
        for (final y in [365.0, 312 + 4 / z, 418 - 4 / z]) {
          await tester.tapAt(_global(tester, b, Offset(260, y)));
          await tester.pump(ms(350));
        }
        final votes = [
          for (final a in b.acts)
            if (a.$1 == 'collab.vote.cast') a.$2['objectId'],
        ];
        expect(votes, ['festival-5', 'festival-5', 'festival-5']);
        expect(b.editor.selection.value, isNot(contains('festival-6')), reason: 'kein Verbinder gewählt');
        expect(b.editor.selection.value, isNot(contains('festival-8')));
      });
    }

    testWidgets('nach der Abstimmung ist die Bevorzugung weg', (tester) async {
      final b = await _pump(tester, objects: festivalObjects());
      await tester.pump();
      expect(b.editor.hitPreference, isNull);
    });
  });

  group('P5 Gesten-Einführung', () {
    void device([Map<String, String> values = const {}]) {
      final stored = <String, String?>{};
      BoardPrefs.load(values);
      BoardPrefs.persist = (k, v) => stored[k] = v;
    }

    Future<void> next(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('stachelOnboardingNext')));
      await tester.pump();
      await tester.pump(ms(400));
    }

    testWidgets('erstes Board: erscheint von selbst, vier Karten, „Los geht’s“ merkt es sich', (tester) async {
      device();
      await _pump(tester, objects: [sticky('n1', 40, 40)]);
      await tester.pump();
      await tester.pump(ms(300));
      expect(find.byKey(const Key('stachelOnboarding')), findsOneWidget);
      expect(find.text('Ansicht bewegen'), findsOneWidget);
      await next(tester);
      expect(find.text('Halten = greifen'), findsOneWidget);
      await next(tester);
      expect(find.text('Halten und ziehen = auswählen'), findsOneWidget);
      await next(tester);
      expect(find.text('Zwei Finger tippen = rückgängig'), findsOneWidget);
      expect(find.byKey(const Key('stachelOnboardingSkip')), findsNothing, reason: 'letzte Karte');
      expect(find.text("Los geht's"), findsOneWidget);
      await next(tester);
      expect(find.byKey(const Key('stachelOnboarding')), findsNothing);
      expect(BoardPrefs.get(GestureOnboarding.seenKey), '1');
    });

    testWidgets('überspringen merkt es sich auch; schon gesehen → kommt nicht wieder', (tester) async {
      device();
      await _pump(tester);
      await tester.pump(ms(300));
      await tester.tap(find.byKey(const Key('stachelOnboardingSkip')));
      await tester.pump();
      await tester.pump(ms(400));
      expect(find.byKey(const Key('stachelOnboarding')), findsNothing);
      expect(GestureOnboarding.seen, isTrue);
    });

    testWidgets('schon gesehen, nur lesen oder ohne Gerätespeicher: kommt nicht von selbst', (tester) async {
      device({GestureOnboarding.seenKey: '1'});
      await _pump(tester);
      await tester.pump(ms(300));
      expect(find.byKey(const Key('stachelOnboarding')), findsNothing, reason: 'schon gesehen');
    });

    testWidgets('ohne Gerätespeicher (Tests, Hosts ohne Speicher) nicht von selbst', (tester) async {
      BoardPrefs.load(const {});
      BoardPrefs.persist = null;
      await _pump(tester);
      await tester.pump(ms(300));
      expect(find.byKey(const Key('stachelOnboarding')), findsNothing);
    });

    testWidgets('aus dem Board-Menü und aus dem Gesten-Blatt wieder zu öffnen', (tester) async {
      device({GestureOnboarding.seenKey: '1'});
      await _pump(tester);
      await _menu(tester, 'stachelBoardOnboarding');
      expect(find.byKey(const Key('stachelOnboarding')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelOnboardingSkip')));
      await tester.pump();
      await tester.pump(ms(400));
      await _menu(tester, 'stachelBoardGestures');
      await _scrollTo(tester, 'stachelGesturesOnboarding');
      await tester.tap(find.byKey(const Key('stachelGesturesOnboarding')));
      await tester.pump();
      await tester.pump(ms(400));
      expect(find.byKey(const Key('stachelOnboarding')), findsOneWidget);
      expect(find.byKey(const Key('stachelGesturesSheet')), findsNothing);
    });

    testWidgets('weniger Bewegung: Bilder stehen still (kein Dauer-Takt)', (tester) async {
      device();
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        disableAnimations: true,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await _pump(tester);
      await tester.pump(ms(300));
      expect(find.byKey(const Key('stachelOnboarding')), findsOneWidget);
      await tester.pumpAndSettle(); // would time out with a repeating animation
      expect(find.byType(CustomPaint), findsWidgets);
    });
  });
}
