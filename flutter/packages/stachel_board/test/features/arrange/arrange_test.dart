// P1 Auswahl & Anordnen (parity audit C02, D06, D08–D16, D18, D20, D27–D37, E22): handles per type, resizing (also
// rotated, several), rotating several with the angle label, snapping with guides and the grid, edge pan, rectangle and
// lasso selection, duplicating, locking, hiding, the web actions for align/distribute/group/layer/format, the format
// painter, „Link zu …“ and tags – against the web's rules.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _p1Actions = {
  'core.group': 1,
  'core.ungroup': 1,
  'core.align': 1,
  'core.distribute': 1,
  'tools.layerStep': 1,
  'tools.copyStyle': 1,
  'tools.pasteStyle': 1,
};

const _features = ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'];

Map<String, Object?> _sticky(String id, double x, double y, [Map<String, Object?> extra = const {}]) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 100,
  'h': 100,
  'text': id,
  'z': 'a$id',
  ...extra,
};

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui, this.hints);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final List<String> hints;
  BoardViewState get view => ui.view!;

  /// All op lists sent so far (flattened).
  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops']! as List).cast<Map<String, Object?>>(),
  ];
  List<Map<String, Object?>> get acts => [
    for (final o in ops)
      if (o['op'] == 'act') o,
  ];
}

Future<_Board> _pump(
  WidgetTester tester,
  List<Map<String, Object?>> objects, {
  Map<String, int> actions = _p1Actions,
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: _features,
    actions: actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  final hints = <String>[];
  final sub = ui.hints.messages.listen(hints.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
    showHiddenObjects = false;
    SnapPrefs.setGrid(false);
  });
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Builder(
            builder: (context) => Column(
              children: [
                Expanded(
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: BoardView(
                          key: ui.viewKey,
                          controller: controller,
                          editor: editor,
                          fitOnLoad: false,
                          onObjectMenu: (w, id) =>
                              showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id)),
                          onLongPress: (w) => showBoardMenu(context, ui, MenuTarget.canvas, MenuAt(w)),
                        ),
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
                ListenableBuilder(
                  listenable: Listenable.merge([editor, controller]),
                  builder: (context, _) => BoardToolbar(ui: ui, enabled: editor.editable),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _Board(controller, source, editor, ui, hints);
}

Offset _screen(_Board b, Offset world) => b.editor.camera.value.toScreen(world);

/// Drags a handle of the selection (screen) by [by] through the editor.
void _dragHandle(_Board b, String id, Offset by) {
  final h = b.editor.handles().firstWhere((x) => x.id == id);
  b.editor
    ..handleStart(id, h.at)
    ..handleUpdate(h.at + by)
    ..handleEnd(h.at + by);
}

/// Taps a context bar entry, inline or behind „Mehr“ (UX P4: only the core actions are always in the row).
Future<void> _ctx(WidgetTester tester, String key) async {
  if (find.byKey(Key(key)).evaluate().isEmpty) {
    await tester.tap(find.byKey(const Key('stachelCtxMore')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.pumpAndSettle();
  }
  await tester.tap(find.byKey(Key(key)).last);
  await tester.pump();
}

void main() {
  group('Griffe je Typ (D32, D33, D36, D37)', () {
    testWidgets('Notiz 8 Griffe + Drehen + Plus an 4 Seiten; Text Ecken + Seiten; Bild Ecken; Karte o/w; Stift 8', (
      tester,
    ) async {
      final b = await _pump(tester, [
        _sticky('s', 0, 0),
        {'id': 't', 'type': 'text', 'x': 300, 'y': 0, 'w': 120, 'h': 36, 'text': 'Hallo', 'z': 'b'},
        {'id': 'i', 'type': 'image', 'x': 0, 'y': 200, 'w': 100, 'h': 80, 'z': 'c'},
        {'id': 'k', 'type': 'card', 'x': 300, 'y': 200, 'w': 280, 'h': 120, 'text': 'Karte', 'z': 'd'},
        {
          'id': 'p',
          'type': 'pen',
          'x': 0,
          'y': 400,
          'w': 60,
          'h': 40,
          'points': [2, 2, 58, 38],
          'strokeWidth': 4,
          'z': 'e',
        },
      ]);
      List<String> ids(String id) {
        b.editor.select({id});
        return [for (final h in b.editor.handles()) h.id];
      }

      expect(ids('s'), [...allHandles, 'rotate', 'add-n', 'add-e', 'add-s', 'add-w']);
      expect(ids('t'), containsAll(['nw', 'ne', 'se', 'sw', 'e', 'w', 'rotate']));
      expect(ids('t'), isNot(contains('n')));
      expect(ids('i'), [...cornerHandles, 'rotate', 'anchor-e', 'anchor-s', 'anchor-w']);
      expect(ids('k'), ['e', 'w', 'add-n', 'add-e', 'add-s', 'add-w']);
      expect(ids('p'), allHandles);
      // several: 4 corners around the box, rotate when all can turn (D33, D36)
      b.editor.select({'s', 'i'});
      expect([for (final h in b.editor.handles()) h.id], [...cornerHandles, 'rotate']);
      b.editor.select({'s', 'k'});
      expect([for (final h in b.editor.handles()) h.id], cornerHandles, reason: 'Karten drehen sich nicht');
    });

    testWidgets('Plus oben legt eine leere Kopie darüber an (D37)', (tester) async {
      final b = await _pump(tester, [_sticky('s', 0, 200)]);
      b.editor.select({'s'});
      _dragHandle(b, 'add-n', Offset.zero);
      final created = b.ops.lastWhere((o) => o['op'] == 'create')['objects']! as List;
      final copy = (created.first as Map).cast<String, Object?>();
      expect((copy['x'], copy['y'], copy['text']), (0.0, 60.0, ''));
      expect(((created[1] as Map)['from'] as Map)['side'], 'n');
    });
  });

  group('Größe ändern wie im Web (D32–D34)', () {
    testWidgets('Notiz: Ecke proportional, Seite frei; ganze Zahlen', (tester) async {
      final b = await _pump(tester, [_sticky('s', 0, 0)]);
      b.editor.select({'s'});
      _dragHandle(b, 'se', const Offset(50, 10));
      var o = b.controller.state['s']!;
      expect((o.x, o.y, o.w, o.h), (0.0, 0.0, 150.0, 150.0));
      _dragHandle(b, 'e', const Offset(30.4, 99));
      o = b.controller.state['s']!;
      expect((o.w, o.h), (180.0, 150.0));
    });

    testWidgets('Text: Ecke skaliert die Schrift, Seite = feste Breite (autoWidth weg)', (tester) async {
      final b = await _pump(tester, [
        {
          'id': 't',
          'type': 'text',
          'x': 0,
          'y': 0,
          'w': 100,
          'h': 40,
          'fontSize': 24,
          'autoWidth': true,
          'text': 'A',
          'z': 'a',
        },
      ]);
      b.editor.select({'t'});
      _dragHandle(b, 'se', const Offset(50, 20));
      expect(b.controller.state['t']!.fontSize, 36);
      expect(b.controller.state['t']!.autoWidth, isTrue);
      _dragHandle(b, 'e', const Offset(-20, 0));
      final o = b.controller.state['t']!;
      expect((o.w, o.fontSize, o.autoWidth), (130.0, 36.0, false));
    });

    testWidgets('Stift: Punkte skalieren mit; gedreht: entlang der Achsen, Gegenecke bleibt', (tester) async {
      final b = await _pump(tester, [
        {
          'id': 'p',
          'type': 'pen',
          'x': 0,
          'y': 0,
          'w': 100,
          'h': 50,
          'points': [0, 0, 100, 50],
          'strokeWidth': 4,
          'z': 'a',
        },
        _sticky('r', 300, 0, {'rotation': 90}),
      ]);
      b.editor.select({'p'});
      _dragHandle(b, 'se', const Offset(100, 0));
      final p = b.controller.state['p']!;
      expect((p.w, p.h), (200.0, 50.0));
      expect(p.points, [0.0, 0.0, 200.0, 50.0]);
      // rotated note: the web's rotatedResize, rounded
      b.editor.select({'r'});
      _dragHandle(b, 'e', const Offset(0, 40));
      final want = rotatedResize(const Rect.fromLTWH(300, 0, 100, 100), 'e', 0, 40, 90, false);
      final r = b.controller.state['r']!;
      expect((r.x, r.y, r.w, r.h), (jsRound(want.left), jsRound(want.top), jsRound(want.width), jsRound(want.height)));
      expect(r.w, 140);
    });

    testWidgets('Mehrfachauswahl: 4 Ecken, proportional, freie Verbinder-Enden folgen (D33)', (tester) async {
      final b = await _pump(tester, [
        _sticky('a', 0, 0),
        _sticky('b', 200, 100),
        {
          'id': 'c',
          'type': 'connector',
          'from': {'objectId': 'a'},
          'to': {'x': 300, 'y': 200},
          'z': 'c',
        },
      ]);
      b.editor.select({'a', 'b'});
      _dragHandle(b, 'se', const Offset(300, 0));
      final a = b.controller.state['a']!, bb = b.controller.state['b']!;
      // box 300×200 → 600×400 (proportional)
      expect((a.x, a.y, a.w, a.h), (0.0, 0.0, 200.0, 200.0));
      expect((bb.x, bb.y, bb.w, bb.h), (400.0, 200.0, 200.0, 200.0));
      b.editor.select({'a', 'b', 'c'});
      final box = b.editor.selectionBounds(['a', 'b', 'c'])!;
      _dragHandle(b, 'nw', Offset(-box.width, 0) * 0.5);
      final to = b.controller.state['c']!.raw['to']! as Map;
      expect(to['x'], isNot(300));
    });

    testWidgets('Einrasten beim Größe-Ändern an der gezogenen Kante (D15)', (tester) async {
      final b = await _pump(tester, [_sticky('s', 0, 0), _sticky('o', 300, 0)]);
      b.editor.select({'s'});
      final h = b.editor.handles().firstWhere((x) => x.id == 'e');
      b.editor
        ..handleStart('e', h.at)
        ..handleUpdate(h.at + const Offset(196, 0));
      expect(b.controller.state['s']!.w, 300, reason: 'rechte Kante rastet auf die linke von o (300)');
      expect(b.editor.guides.value.lines, isNotEmpty);
      b.editor.handleEnd(h.at + const Offset(196, 0));
      expect(b.editor.guides.value.isEmpty, isTrue);
    });
  });

  group('Drehen (D35, D36)', () {
    testWidgets('mehrere um die gemeinsame Mitte; Winkel-Etikett während des Drehens', (tester) async {
      final b = await _pump(tester, [_sticky('a', 0, 0), _sticky('b', 200, 0)]);
      b.editor.select({'a', 'b'});
      final h = b.editor.handles().firstWhere((x) => x.id == 'rotate');
      final c = _screen(b, const Offset(150, 50));
      b.editor.handleStart('rotate', h.at);
      expect(b.editor.rotating.value, (deg: 0.0, snapped: true));
      // a quarter turn clockwise around the center
      final to = c + Offset(c.dy - h.at.dy, 0);
      b.editor.handleUpdate(to);
      expect(b.editor.rotating.value!.deg, 90);
      expect(angleLabel(b.editor.rotating.value!.deg), '90°');
      final want = rotateMany(
        {'a': b.controller.confirmed['a']!, 'b': b.controller.confirmed['b']!},
        const Offset(150, 50),
        90,
      );
      expect(b.controller.state['a']!.x, want['a']!['x']);
      expect(b.controller.state['a']!.rotation, 90);
      b.editor.handleEnd(to);
      expect(b.editor.rotating.value, isNull);
    });
  });

  group('Einrasten beim Ziehen (D13, D14, D16, D18)', () {
    testWidgets('an Kanten: Hilfslinie, ganze Zahlen; Raster 24; Rand schwenkt mit', (tester) async {
      final b = await _pump(tester, [_sticky('s', 0, 0), _sticky('o', 300, 200)]);
      b.editor.select({'s'});
      b.editor.dragStart(const Offset(50, 50));
      b.editor.dragUpdate(const Offset(50 + 297.6, 50 + 3.2));
      var s = b.controller.state['s']!;
      expect((s.x, s.y), (300.0, 3.0), reason: 'linke Kante rastet auf o ein; y ganzzahlig (nichts in Reichweite)');
      expect(b.editor.guides.value.lines, isNotEmpty);
      b.editor.dragEnd();
      expect(b.editor.guides.value.isEmpty, isTrue);
      // grid
      SnapPrefs.setGrid(true);
      b.editor.dragStart(const Offset(350, 50));
      b.editor.dragUpdate(const Offset(350 + 37, 50 + 1000));
      s = b.controller.state['s']!;
      expect((s.x % 24, s.y % 24), (0.0, 0.0));
      b.editor.dragEnd();
      SnapPrefs.setGrid(false);
      expect(edgeVelocity(const Offset(400, 300), const Size(800, 600)), Offset.zero);
      expect(edgeVelocity(const Offset(0, 300), const Size(800, 600)), const Offset(16, 0));
      expect(edgeVelocity(const Offset(790, 584), const Size(800, 600)).dx, closeTo(-11, 1e-9));
    });

    testWidgets('Objekt an den Bildrand ziehen schwenkt die Ansicht mit', (tester) async {
      final b = await _pump(tester, [_sticky('s', 300, 200)]);
      b.editor.select({'s'});
      await tester.pump();
      final start = _screen(b, const Offset(350, 250));
      final g = await tester.startGesture(start);
      await g.moveTo(start + const Offset(40, 0));
      await tester.pump(const Duration(milliseconds: 16));
      await g.moveTo(const Offset(795, 250));
      final cam0 = b.editor.camera.value.x;
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(b.editor.camera.value.x, lessThan(cam0), reason: 'Ansicht wandert nach rechts');
      expect(b.controller.state['s']!.x, greaterThan(300 + 400));
      await g.up();
      await tester.pump(const Duration(milliseconds: 50));
    });
  });

  group('Auswahl (C02, D06)', () {
    testWidgets('Rechteck: Notiz genügt Schneiden; Rahmen und Verbinder nur ganz drin; Lasso nur ganz umschlossen', (
      tester,
    ) async {
      final b = await _pump(tester, [
        _sticky('s', 0, 0),
        {'id': 'f', 'type': 'frame', 'x': 300, 'y': 0, 'w': 200, 'h': 200, 'title': 'R', 'z': 'a0'},
        {
          'id': 'c',
          'type': 'connector',
          'from': {'x': 600, 'y': 0},
          'to': {'x': 700, 'y': 100},
          'z': 'c',
        },
      ]);
      b.editor.marquee(_screen(b, const Offset(50, 50)), _screen(b, const Offset(650, 300)));
      expect(b.editor.selection.value, {'s'});
      b.editor.marquee(_screen(b, const Offset(-20, -50)), _screen(b, const Offset(750, 300)));
      expect(b.editor.selection.value, {'s', 'f', 'c'});
      // lasso around s only partly → nothing; all around → s
      b.editor.lassoSelect(const [Offset(-10, -10), Offset(60, -10), Offset(60, 120), Offset(-10, 120)]);
      expect(b.editor.selection.value, isEmpty);
      b.editor.lassoSelect(const [Offset(-10, -10), Offset(120, -10), Offset(120, 120), Offset(-10, 120)]);
      expect(b.editor.selection.value, {'s'});
    });

    testWidgets('Auswählen zweimal antippen → Rechteck/Lasso; Lasso über Halten + Ziehen', (tester) async {
      final b = await _pump(tester, [_sticky('s', 100, 100)]);
      await tester.tap(find.byKey(const Key('stachelToolSelect')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelSelectLasso')));
      await tester.pumpAndSettle();
      expect(b.editor.lasso, isTrue);
      final g = await tester.startGesture(_screen(b, const Offset(60, 60)));
      await tester.pump(const Duration(milliseconds: 600));
      for (final p in const [Offset(260, 60), Offset(260, 260), Offset(60, 260), Offset(58, 70)]) {
        await g.moveTo(_screen(b, p));
        await tester.pump(const Duration(milliseconds: 16));
      }
      await g.up();
      await tester.pump();
      expect(b.editor.selection.value, {'s'});
    });
  });

  group('Duplizieren (D20)', () {
    testWidgets('+24/+24, Verbinder zwischen Kopien mit, angedockt an Fremdes → frei, Sperre weg, Gruppen neu', (
      tester,
    ) async {
      final b = await _pump(tester, [
        _sticky('a', 0, 0, {'groupId': 'G', 'locked': true}),
        _sticky('b', 200, 0, {'groupId': 'G'}),
        _sticky('x', 400, 0, {'groupId': 'H'}),
        _sticky('y', 600, 0, {'groupId': 'H'}),
        {
          'id': 'ab',
          'type': 'connector',
          'from': {'objectId': 'a'},
          'to': {'objectId': 'b'},
          'z': 'z1',
        },
        {
          'id': 'bx',
          'type': 'connector',
          'from': {'objectId': 'b'},
          'to': {'objectId': 'x'},
          'z': 'z2',
        },
      ]);
      b.editor.select({'a', 'b', 'x', 'bx'});
      b.editor.duplicateSelection();
      final created = (b.ops.lastWhere((o) => o['op'] == 'create')['objects']! as List).cast<Map<String, Object?>>();
      final a2 = created.firstWhere((o) => o['text'] == 'a'), b2 = created.firstWhere((o) => o['text'] == 'b');
      final x2 = created.firstWhere((o) => o['text'] == 'x');
      expect((a2['x'], a2['y'], a2['locked']), (24.0, 24.0, null));
      expect(a2['groupId'], isNotNull);
      expect(a2['groupId'], b2['groupId']);
      expect(a2['groupId'], isNot('G'));
      expect(x2['groupId'], isNull, reason: 'nur ein Mitglied von H kopiert');
      final conns = created.where((o) => o['type'] == 'connector').toList();
      expect(conns, hasLength(2), reason: 'ab kommt mit (beide Enden kopiert), bx war gewählt');
      final ab2 = conns.firstWhere((c) => (c['from']! as Map)['objectId'] == a2['id']);
      expect((ab2['to']! as Map)['objectId'], b2['id']);
      expect(b.editor.selection.value, {for (final c in created) c['id'] as String});
    });
  });

  group('Sperren, Ausblenden (D09, D10, D28, E22)', () {
    testWidgets('Kontextleiste Sperren; gesperrt: nur Duplizieren + Entsperren', (tester) async {
      final b = await _pump(tester, [_sticky('s', 100, 100)]);
      b.editor.select({'s'});
      await tester.pump();
      await _ctx(tester, 'stachelCtxLock');
      await tester.pump();
      expect(b.controller.state['s']!.locked, isTrue);
      expect(find.byKey(const Key('stachelCtxUnlock')), findsOneWidget);
      expect(find.byKey(const Key('stachelCtxDuplicate')), findsOneWidget);
      expect(find.byKey(const Key('stachelCtxDelete')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelCtxUnlock')));
      await tester.pump();
      expect(b.controller.state['s']!.locked, isFalse);
    });

    testWidgets('Ausblenden mit Hinweis; Ausgeblendete zeigen (wählbar); Alle einblenden', (tester) async {
      final b = await _pump(tester, [_sticky('s', 100, 100), _sticky('t', 300, 100)]);
      b.editor.select({'s'});
      toggleHidden(b.ui);
      await tester.pump();
      await tester.pump();
      expect(b.controller.state['s']!.hidden, isTrue);
      expect(b.editor.selection.value, isEmpty);
      expect(b.hints.last, ArrangeTexts.hiddenOne);
      expect(b.editor.scene.hitTest(const Offset(150, 150), 1), isNull);
      b.editor.setShowHidden(true);
      expect(b.editor.scene.hitTest(const Offset(150, 150), 1)?.id, 's');
      await tester.pump();
      b.editor.selectAll();
      expect(b.editor.selection.value, {'s', 't'});
      b.editor.setShowHidden(false);
      expect(b.editor.selection.value, {'t'});
      showAllHidden(b.ui);
      await tester.pump();
      expect(b.controller.state['s']!.hidden, isFalse);
      expect(b.hints.last, '1 Objekt eingeblendet.');
    });
  });

  group('Web-Aktionen (D08, D11, D12, D27, D30)', () {
    testWidgets(
      'Ausrichten-Blatt, Gruppieren in der Kontextleiste, Ebene im Menü – als act; ohne Aktion ausgeblendet',
      (tester) async {
        final b = await _pump(tester, [_sticky('a', 0, 0), _sticky('b', 200, 50), _sticky('c', 400, 100)]);
        b.editor.select({'a', 'b', 'c'});
        await tester.pump();
        await tester.tap(find.byKey(const Key('stachelCtxArrange')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('stachelAlign-top')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('stachelCtxArrange')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('stachelDistribute-x')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('stachelCtxGroup')));
        await tester.pump();
        expect([for (final a in b.acts) a['name']], ['core.align', 'core.distribute', 'core.group']);
        expect(
          [for (final a in b.acts) a['args']],
          [
            {
              'ids': ['a', 'b', 'c'],
              'mode': 'top',
            },
            {
              'ids': ['a', 'b', 'c'],
              'axis': 'x',
            },
            {
              'ids': ['a', 'b', 'c'],
            },
          ],
        );
        layerStep(b.ui, -1);
        expect(b.acts.last['name'], 'tools.layerStep');
        expect((b.acts.last['args']! as Map)['dir'], -1);
      },
    );

    testWidgets('ohne Server-Aktionen: kein Ausrichten/Gruppieren', (tester) async {
      final b = await _pump(tester, [_sticky('a', 0, 0), _sticky('b', 200, 50)], actions: const {});
      b.editor.select({'a', 'b'});
      await tester.pump();
      expect(find.byKey(const Key('stachelCtxArrange')), findsNothing);
      expect(find.byKey(const Key('stachelCtxGroup')), findsNothing);
    });

    testWidgets('Format-Pinsel: kopiert, Antippen überträgt auf die Gruppe, leere Fläche beendet', (tester) async {
      final b = await _pump(tester, [
        _sticky('src', 0, 0, {'color': '#c9e14a'}),
        _sticky('g1', 300, 300, {'groupId': 'G'}),
        _sticky('g2', 300, 450, {'groupId': 'G'}),
      ]);
      b.editor.select({'src'});
      await tester.pump();
      await _ctx(tester, 'stachelCtxPainter');
      await tester.pump();
      expect(b.acts.last, containsPair('name', 'tools.copyStyle'));
      expect(find.byKey(const Key('stachelPainterPill')), findsOneWidget);
      expect(b.editor.selection.value, isEmpty);
      await tester.tapAt(_screen(b, const Offset(350, 350)));
      await tester.pump(const Duration(milliseconds: 400));
      final paste = b.acts.last;
      expect(paste['name'], 'tools.pasteStyle');
      final args = paste['args']! as Map;
      expect((args['ids'] as List).toSet(), {'g1', 'g2'});
      expect((args['from'], args['painter']), ('src', true));
      await tester.tapAt(_screen(b, const Offset(650, 450)));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byKey(const Key('stachelPainterPill')), findsNothing);
    });
  });

  group('Link zu … (D29)', () {
    testWidgets('Ziel antippen setzt linkTo; Sprung-Knopf fährt hin und wählt; fehlendes Ziel → Hinweis', (
      tester,
    ) async {
      final b = await _pump(tester, [
        _sticky('s', 100, 100),
        {'id': 'f', 'type': 'frame', 'x': 2000, 'y': 2000, 'w': 400, 'h': 300, 'title': 'Bühne', 'z': 'a0'},
        _sticky('t', 300, 100),
        _sticky('broken', 500, 100, {'linkTo': 'weg'}),
      ]);
      b.editor.select({'s'});
      ArrangeModes.of(b.ui).startPicking();
      await tester.pump();
      expect(find.byKey(const Key('stachelPickPill')), findsOneWidget);
      await tester.tapAt(_screen(b, const Offset(350, 150)));
      await tester.pump(const Duration(milliseconds: 400));
      expect(b.controller.state['s']!.linkTo, 't');
      expect(b.hints.last, 'Verlinkt mit „t“.');
      await tester.tap(find.byKey(const Key('stachelLinkBadge-broken')));
      await tester.pump();
      await tester.pump();
      expect(b.hints.last, ArrangeTexts.linkGone);
      setLink(b.ui, ['s'], 'f');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelLinkBadge-s')));
      await tester.pump();
      expect(b.editor.selection.value, {'f'});
      expect(b.editor.camera.value.viewRect(b.editor.viewSize).contains(const Offset(2200, 2150)), isTrue);
    });
  });

  group('Tags (D31)', () {
    testWidgets('an/aus, neuer Tag mit Farbe, gleicher Name = gleiche Farbe, höchstens 8', (tester) async {
      final b = await _pump(tester, [
        _sticky('s', 0, 0, {
          'tags': [
            {'label': 'Zelt', 'color': '#ec4e92'},
          ],
        }),
        _sticky('t', 300, 0),
      ]);
      expect([for (final t in boardTags(b.controller.state.objects.values)) t.label], ['Zelt']);
      b.editor.select({'t'});
      setTag(b.ui, const BoardTag('zelt', '#0a0a0a'), true);
      expect(b.controller.state['t']!.tags.single.label, 'zelt');
      setTag(b.ui, const BoardTag('Zelt', '#ec4e92'), false);
      expect(b.controller.state['t']!.tags, isEmpty);
      final full = _sticky('n', 0, 0, {
        'tags': [
          for (var i = 0; i < 8; i++) {'label': 'T$i', 'color': '#c9e14a'},
        ],
      });
      expect(toggleTagPatch(BoardObject(full), const BoardTag('neu', '#c9e14a'), true), isNull);
      // the sheet: keyboard does not open by itself
      await tester.pump();
      await _ctx(tester, 'stachelCtxTags');
      await tester.pumpAndSettle();
      expect(tester.testTextInput.isVisible, isFalse);
      await tester.enterText(find.byKey(const Key('stachelTagInput')), 'Strom');
      await tester.tap(find.byKey(const Key('stachelTagColor-#1763b5')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelTagAdd')));
      await tester.pump();
      expect(b.controller.state['t']!.tags.single.color, '#1763b5');
    });
  });

  group('Zwischenablage (D21, D22)', () {
    testWidgets(
      'Kopieren schreibt Klartext; Einfügen an der Stelle mit neuen IDs; fremder Text → Notiz; nichts → Hinweis',
      (tester) async {
        String? system;
        BoardClipboard.objects = const [];
        BoardClipboard.text = null;
        BoardClipboard.read = () async => system;
        BoardClipboard.write = (t) async => system = t;
        final b = await _pump(tester, [
          _sticky('a', 0, 0),
          {'id': 'f', 'type': 'frame', 'x': 300, 'y': 0, 'w': 200, 'h': 200, 'title': 'Rahmen', 'z': 'a0'},
        ]);
        await pasteAt(b.ui, const Offset(500, 500));
        await tester.pump();
        expect(b.hints.last, ClipboardTexts.nothing);
        b.editor.select({'a', 'f'});
        await copySelection(b.ui);
        expect(system, 'a\nRahmen');
        await pasteAt(b.ui, const Offset(1000, 1000));
        final created = (b.ops.lastWhere((o) => o['op'] == 'create')['objects']! as List).cast<Map<String, Object?>>();
        expect(created, hasLength(2));
        expect(created.map((o) => o['id']), isNot(contains('a')));
        // box 0..500 × 0..200 centered at (1000, 1000)
        final a2 = created.firstWhere((o) => o['type'] == 'sticky');
        expect((a2['x'], a2['y']), (750.0, 900.0));
        system = 'Einkaufsliste';
        await pasteAt(b.ui, const Offset(0, 600));
        final note = (b.ops.lastWhere((o) => o['op'] == 'create')['objects']! as List).single as Map;
        expect((note['type'], note['text'], note['x'], note['y']), ('sticky', 'Einkaufsliste', -100.0, 500.0));
        // objects of the web format in the plain text
        system = serializeObjects([BoardObject(_sticky('w', 0, 0))]);
        await pasteAt(b.ui, const Offset(0, 0));
        final fromWeb = (b.ops.lastWhere((o) => o['op'] == 'create')['objects']! as List).single as Map;
        expect((fromWeb['text'], fromWeb['x']), ('w', -50.0));
        BoardClipboard.objects = const [];
      },
    );
  });
}
