// Q2 Notiz-Stapel (web `features/shapes/stack/`): what a stack is (model port), drop → act `shapes.stackDrop` only when
// it can change something, count badge with ‹ › / tap / swipe → `shapes.stackCycle`, context bar (Vorige/Nächste,
// Auffächern, Oberste abnehmen, Vom Stapel nehmen) → the web actions with the web's arguments.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/stack/stack_model.dart';

const _actions = {'shapes.stackDrop': 1, 'shapes.stackCycle': 1, 'shapes.stackSpread': 1, 'shapes.stackTake': 1};
const _features = ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'];

Map<String, Object?> _note(String id, double x, double y, {String? stack, String z = ''}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 200,
  'h': 200,
  'text': id,
  'color': '#fff27a',
  'z': z.isEmpty ? 'a$id' : z,
  if (stack != null) ...{'groupId': stack, 'stacked': true},
};

/// a, b, c on one stack (c on top) at 0/0, d alone at 600/0.
List<Map<String, Object?>> _board() => [
  _note('a', 0, 0, stack: 'g'),
  _note('b', 0, 0, stack: 'g'),
  _note('c', 0, 0, stack: 'g'),
  _note('d', 600, 0),
];

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;

  List<Map<String, Object?>> get acts => [
    for (final m in source.sent)
      if (m['t'] == 'ops')
        for (final o in (m['ops']! as List).cast<Map<String, Object?>>())
          if (o['op'] == 'act') o,
  ];
}

Future<_Board> _pump(WidgetTester tester, List<Map<String, Object?>> objects) async {
  tester.view.physicalSize = const Size(900, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: _features,
    actions: _actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  editor.camera.value = const Camera(100, 100, 1);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Stack(
            children: [
              Positioned.fill(
                child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
              ),
              Positioned.fill(child: BoardOverlays(ui: ui)),
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: ListenableBuilder(
                  listenable: Listenable.merge([editor, controller]),
                  builder: (context, _) => BoardContextBar(ui: ui),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _Board(controller, source, editor, ui);
}

void main() {
  group('Modell wie im Web', () {
    BoardState state(List<Map<String, Object?>> objects) =>
        BoardState()..applySnapshot(BoardSnapshot.fromJson({'objects': objects}), rev: 0, epoch: 't');

    test('Stapel, ganzer Stapel gewählt, Ziel nur mittig und nicht gesperrt', () {
      final s = state(_board());
      expect([for (final o in stackOf(s['a'], s)) o.id], ['a', 'b', 'c']);
      expect(stackOf(s['d'], s), isEmpty);
      expect(allStacks(s).keys, ['g']);
      expect(selectedStack({'a', 'b', 'c'}, s), isNotNull);
      expect(selectedStack({'a', 'b'}, s), isNull);
      // d fast mittig auf den Stapel: Ziel = oberste Notiz c
      final moved = BoardObject({..._note('d', 40, 30)});
      expect(stackTarget([moved], s, 'd')?.id, 'c');
      expect(stackTarget([BoardObject({..._note('d', 120, 0)})], s, 'd'), isNull);
      final locked = state([_note('x', 0, 0)..['locked'] = true, _note('y', 10, 10)]);
      expect(stackTarget([locked['y']!], locked, 'y'), isNull);
      // ganzer Stapel ohne Ziel: nichts; eine Notiz herausgezogen: ja
      expect(dropMatters([s['a']!, s['b']!, s['c']!], s, 'c'), isFalse);
      expect(dropMatters([BoardObject({..._note('c', 900, 0, stack: 'g')})], s, 'c'), isTrue);
    });
  });

  testWidgets('Ablegen auf einer Notiz fragt shapes.stackDrop, Ablegen daneben nicht', (tester) async {
    final b = await _pump(tester, [_note('a', 0, 0), _note('d', 600, 0), _note('e', 600, 400)]);
    b.editor.select({'d'});
    b.editor
      ..dragStart(const Offset(700, 100), grab: 'd')
      ..dragUpdate(const Offset(130, 120))
      ..dragEnd();
    await tester.pump();
    expect(b.acts.single['name'], 'shapes.stackDrop');
    expect(b.acts.single['args'], {
      'ids': ['d'],
      'grabbed': 'd',
    });
    b.editor.select({'e'});
    b.editor
      ..dragStart(const Offset(700, 500), grab: 'e')
      ..dragUpdate(const Offset(1100, 500))
      ..dragEnd();
    await tester.pump();
    expect(b.acts, hasLength(1), reason: 'kein Stapel betroffen → keine Anfrage');
  });

  testWidgets('Zahl am Stapel: Tippen = nächste Notiz; ganzer Stapel gewählt: ‹ ›, Wischen', (tester) async {
    final b = await _pump(tester, _board());
    expect(find.byKey(const Key('stachelStackBadge-g')), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.byKey(const Key('stachelStackPrev')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelStackCount')));
    await tester.pump();
    expect(b.acts.last['name'], 'shapes.stackCycle');
    expect(b.acts.last['args'], {'id': 'c', 'dir': 1});

    b.editor.select({'a', 'b', 'c'});
    await tester.pump();
    await tester.tap(find.byKey(const Key('stachelStackPrev')));
    await tester.pump();
    expect(b.acts.last['args'], {'id': 'c', 'dir': -1});
    await tester.fling(find.byKey(const Key('stachelStackBadge-g')), const Offset(-120, 0), 800);
    await tester.pump();
    expect(b.acts.last['args'], {'id': 'c', 'dir': 1});
  });

  testWidgets('Kontextleiste: Auffächern, Oberste abnehmen; eine Notiz: Vom Stapel nehmen', (tester) async {
    final b = await _pump(tester, _board());
    b.editor.select({'a', 'b', 'c'});
    await tester.pump();
    Future<void> tapCtx(String key) async {
      final f = find.byKey(Key(key));
      if (f.evaluate().isEmpty) {
        await tester.tap(find.byKey(const Key('stachelCtxMore')));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(Key(key)).last);
      }
      await tester.tap(find.byKey(Key(key)).last);
      await tester.pumpAndSettle();
    }

    await tapCtx('stachelCtxStackSpread');
    expect(b.acts.last['name'], 'shapes.stackSpread');
    expect(b.acts.last['args'], {'id': 'a'});
    b.editor.select({'a', 'b', 'c'});
    await tester.pumpAndSettle();
    await tapCtx('stachelCtxStackTake');
    expect(b.acts.last['name'], 'shapes.stackTake');
    expect(b.acts.last['args'], {'id': 'a'});
    b.editor.select({'b'});
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelCtxStackSpread')), findsNothing);
    await tapCtx('stachelCtxStackTake');
    expect(b.acts.last['args'], {'id': 'b', 'which': 'b'});
  });
}
