// UX-A3 (docs/ux_review_app_2026-11.md P4, P7, P11, P15): Kontextleiste mit beschrifteten Kernaktionen und gruppiertem
// „Mehr“, Board-Menü am Handy mit Schnellzeile und Gruppen (gleiche Einträge und Reihenfolge wie im Web im Register),
// Schreiben zoomt kleine Texte heran, Kommentar-Pin nicht auf dem Rahmentitel.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'},
  {'id': 'b', 'type': 'sticky', 'x': 300, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bar', 'z': 'a1'},
];

class _Board {
  _Board(this.controller, this.editor, this.ui);
  final BoardController controller;
  final BoardEditor editor;
  final BoardUi ui;
}

Future<_Board> _pump(
  WidgetTester tester, {
  Size size = const Size(390, 844),
  List<Map<String, Object?>> objects = _objects,
  Map<String, Object?> ext = const {},
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot(objects: [for (final o in objects) BoardObject(o)], ext: ext),
    rev: 20,
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
  return _Board(controller, editor, ui);
}

CtxItem _item(String key, {bool primary = false, double width = 48}) =>
    CtxItem(key: key, label: key, primary: primary, width: width, onTap: (_, _) {});

void main() {
  group('Kontextleiste (P4)', () {
    test('Kernaktionen zuerst, dann was passt, der Rest hinter „Mehr“', () {
      final items = [_item('f'), _item('color', primary: true), _item('g'), _item('del', primary: true)];
      final phone = splitContextItems(items, 200);
      expect([for (final i in phone.primary) i.key], ['color', 'del']);
      expect(phone.inline, isEmpty, reason: '200 − 2 × 64 − 64 lässt keinen Platz');
      expect([for (final i in phone.more) i.key], ['f', 'g']);
      final wide = splitContextItems(items, 1000);
      expect([for (final i in wide.inline) i.key], ['f', 'g']);
      expect(wide.more, isEmpty);
    });

    testWidgets('Haftnotiz am Handy: Farbe · Text · Duplizieren · Löschen · Mehr, beschriftet', (tester) async {
      final b = await _pump(tester);
      b.editor.select({'a'});
      await tester.pump();
      final bar = find.byKey(const Key('stachelBoardSelection'));
      double x(String k) => tester.getCenter(find.descendant(of: bar, matching: find.byKey(Key(k)))).dx;
      final keys = ['stachelCtxColor', 'stachelCtxEdit', 'stachelCtxDuplicate', 'stachelCtxDelete', 'stachelCtxMore'];
      for (final k in keys) {
        expect(
          find.descendant(of: bar, matching: find.byKey(Key(k))),
          findsOneWidget,
          reason: k,
        );
      }
      for (var i = 1; i < keys.length; i++) {
        expect(x(keys[i - 1]), lessThan(x(keys[i])), reason: '${keys[i - 1]} vor ${keys[i]}');
      }
      for (final t in ['Farbe', 'Text', 'Duplizieren', 'Löschen', 'Mehr']) {
        expect(
          find.descendant(of: bar, matching: find.text(t)),
          findsOneWidget,
          reason: t,
        );
      }
      // the rest is not inline
      expect(find.byKey(const Key('stachelCtxFont')), findsNothing);
      // „Text“ opens the writing
      await tester.tap(find.byKey(const Key('stachelCtxEdit')));
      await tester.pump();
      expect(b.editor.editingId, 'a');
    });

    testWidgets('„Mehr“: Gruppen mit Überschriften in fester Reihenfolge (Schrift vor Anordnen vor Verknüpfen)', (
      tester,
    ) async {
      final b = await _pump(tester);
      b.editor.select({'a'});
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCtxMore')));
      await tester.pumpAndSettle();
      final sheet = find.byKey(const Key('stachelCtxMoreSheet'));
      expect(sheet, findsOneWidget);
      double y(String k) => tester.getTopLeft(find.byKey(Key(k))).dy;
      for (final s in ['text', 'arrange', 'link']) {
        await tester.ensureVisible(find.byKey(Key('stachelCtxSection-$s')));
      }
      await tester.pumpAndSettle();
      // the sheet scrolls: compare inside one scroll position via the column's order
      final col = tester.widget<Column>(sheet);
      final keys = [
        for (final w in col.children)
          if (w.key is ValueKey<String>) (w.key! as ValueKey<String>).value,
      ];
      int at(String k) => keys.indexOf(k);
      expect(at('stachelCtxSection-text'), greaterThanOrEqualTo(0));
      expect(at('stachelCtxSection-text'), lessThan(at('stachelCtxFont')));
      expect(at('stachelCtxFont'), lessThan(at('stachelCtxSection-arrange')));
      expect(at('stachelCtxSection-arrange'), lessThan(at('stachelCtxFront')));
      expect(at('stachelCtxFront'), lessThan(at('stachelCtxSection-link')));
      expect(at('stachelCtxSection-link'), lessThan(at('stachelObjectLink')));
      expect(keys, isNot(contains('stachelCtxDelete')), reason: 'Löschen steht schon in der Leiste');
      expect(y('stachelCtxSection-link'), greaterThan(y('stachelCtxSection-arrange')));
    });

    testWidgets('Form: Füllfarbe steht als „Farbe“ vorn in der Leiste', (tester) async {
      final b = await _pump(
        tester,
        objects: [
          {'id': 's', 'type': 'shape', 'shape': 'rect', 'x': 0, 'y': 0, 'w': 200, 'h': 100, 'text': 'Bar', 'z': 'a0'},
        ],
      );
      b.editor.select({'s'});
      await tester.pump();
      final bar = find.byKey(const Key('stachelBoardSelection'));
      expect(
        find.descendant(of: find.byKey(const Key('stachelCtxFill')), matching: find.text('Farbe')),
        findsOneWidget,
      );
      expect(
        tester.getCenter(find.descendant(of: bar, matching: find.byKey(const Key('stachelCtxFill')))).dx,
        lessThan(tester.getCenter(find.byKey(const Key('stachelCtxEdit'))).dx),
      );
    });

    testWidgets('gesperrt: Duplizieren und Entsperren sind die Kernaktionen', (tester) async {
      final b = await _pump(
        tester,
        objects: [
          {'id': 'l', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'locked': true, 'z': 'a0'},
        ],
      );
      b.editor.select({'l'});
      await tester.pump();
      expect(find.text('Entsperren'), findsOneWidget);
      expect(find.text('Duplizieren'), findsOneWidget);
    });

    test('jede Kontextleisten-Gruppe des Registers hat eine Überschrift (neue Pakete tragen sich ein)', () {
      final r = standardBoardRegistry();
      expect([
        for (final a in r.contextActions.list())
          if (a.section == null) a.id,
      ], isEmpty);
    });
  });

  group('Board-Menü am Handy (P7)', () {
    test('jeder Eintrag hat eine Gruppe; Gruppen enthalten dieselben Einträge wie die Web-Liste', () {
      final r = standardBoardRegistry();
      expect([
        for (final m in r.menuItems.list())
          if (m.on == MenuTarget.board && m.section == null) m.id,
      ], isEmpty);
    });

    testWidgets('Schnellzeile oben (Suchen), dann ZUSAMMENARBEIT · ANSICHT · BOARD · MEHR', (tester) async {
      final b = await _pump(tester);
      final ctx = tester.element(find.byType(BoardView));
      final grouped = menuSections(b.ui, const MenuAt(Offset.zero));
      final flat = menuEntries(b.ui, MenuTarget.board, const MenuAt(Offset.zero));
      final keys = {
        for (final (_, l) in grouped)
          for (final e in l) e.key,
      };
      expect(keys, {for (final e in flat) e.key}, reason: 'gleiche Einträge, nur anders gegliedert');
      expect(grouped.first.$1, MenuSection.quick);
      expect([for (final (s, _) in grouped) s.index], orderedEquals([for (final (s, _) in grouped) s.index]..sort()));
      unawaited(showBoardMenu(ctx, b.ui, MenuTarget.board, const MenuAt(Offset.zero)));
      await tester.pumpAndSettle();
      final quick = find.byKey(const Key('stachelMenuQuick'));
      expect(quick, findsOneWidget);
      expect(find.descendant(of: quick, matching: find.text('Suchen')), findsOneWidget);
      expect(find.byKey(const Key('stachelMenuSection-view')), findsOneWidget);
      // a row in a group still works like before
      await tester.ensureVisible(find.byKey(const Key('stachelBoardGestures')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelBoardGestures')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelGesturesSheet')), findsOneWidget);
    });

    testWidgets('Kachel mit Zähler und Kurzname; sectionOrder ordnet innerhalb der Gruppe', (tester) async {
      final b = await _pump(tester);
      b.ui.registry
        ..defineMenuItem(
          MenuItemDef(
            id: 'test.late',
            on: MenuTarget.board,
            order: 5,
            section: MenuSection.quick,
            sectionOrder: 99,
            entry: (ui, at) => const MenuEntry(key: 'late', label: 'Spät …', icon: Icons.abc),
          ),
        )
        ..defineMenuItem(
          MenuItemDef(
            id: 'test.badge',
            on: MenuTarget.board,
            order: 100,
            section: MenuSection.quick,
            sectionOrder: 0,
            entry: (ui, at) => const MenuEntry(
              key: 'badge',
              label: 'Kommentare (3 offen)',
              short: 'Kommentare',
              badge: '3',
              icon: Icons.mode_comment_outlined,
            ),
          ),
        );
      final quick = menuSections(b.ui, const MenuAt(Offset.zero)).first.$2;
      expect(quick.first.key, 'badge');
      expect(quick.last.key, 'late');
      expect(tileLabel(quick.last), 'Spät');
      unawaited(
        showBoardMenu(tester.element(find.byType(BoardView)), b.ui, MenuTarget.board, const MenuAt(Offset.zero)),
      );
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byKey(const Key('badge')), matching: find.text('3')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('badge')), matching: find.text('Kommentare')), findsOneWidget);
    });
  });

  group('Schreiben (P11)', () {
    testWidgets('kleiner Zoom: Schreiben zoomt auf lesbare Schrift heran und hält das Objekt im Bild', (tester) async {
      final b = await _pump(
        tester,
        objects: [
          {
            'id': 't',
            'type': 'text',
            'x': 2000,
            'y': 1500,
            'w': 120,
            'h': 30,
            'text': 'klein',
            'fontSize': 16,
            'z': 'a0',
          },
        ],
      );
      b.editor.camera.value = const Camera(0, 0, 0.2);
      await tester.pump();
      b.ui.view!.editText('t');
      await tester.pump();
      await tester.pump();
      final cam = b.editor.camera.value;
      expect(cam.z, closeTo(BoardViewState.readableFontPx / 16, 1e-9));
      final r = cam.rectToScreen(const Rect.fromLTWH(2000, 1500, 120, 30));
      expect((Offset.zero & const Size(390, 844)).contains(r.center), isTrue);
    });

    testWidgets('schon groß genug: kein Zoom', (tester) async {
      final b = await _pump(tester);
      b.editor.camera.value = const Camera(10, 10, 1);
      await tester.pump();
      b.ui.view!.editText('a');
      await tester.pump();
      await tester.pump();
      expect(b.editor.camera.value.z, 1);
    });
  });

  group('Kommentar-Pin (P15)', () {
    testWidgets('über einem Rahmentitel rutscht der Pin unter den Punkt; frei bleibt er oben rechts', (tester) async {
      final b = await _pump(
        tester,
        objects: [
          {'id': 'f', 'type': 'frame', 'x': 0, 'y': 100, 'w': 400, 'h': 300, 'title': 'Aufbau', 'z': 'a0'},
          {'id': 's', 'type': 'sticky', 'x': 20, 'y': 110, 'w': 100, 'h': 100, 'z': 'a1'},
          {'id': 'o', 'type': 'sticky', 'x': 20, 'y': 600, 'w': 100, 'h': 100, 'z': 'a2'},
        ],
        ext: {
          'collab.comments': {
            't1': {
              'x': 0,
              'y': 0,
              'objectId': 's',
              'dx': 10,
              'dy': 2,
              'messages': [
                {'id': 'm', 'by': 'm:2', 'name': 'Jonas', 'text': 'hier', 'at': '2026-11-01T10:00:00Z'},
              ],
            },
            't2': {
              'x': 0,
              'y': 0,
              'objectId': 'o',
              'dx': 10,
              'dy': 2,
              'messages': [
                {'id': 'm', 'by': 'm:2', 'name': 'Jonas', 'text': 'frei', 'at': '2026-11-01T10:00:00Z'},
              ],
            },
          },
        },
      );
      const cam = Camera(0, 0, 1);
      final layer = CollabLayer(controller: b.controller, scene: b.editor.scene);
      final t1 = layer.threads.firstWhere((t) => t.id == 't1');
      final t2 = layer.threads.firstWhere((t) => t.id == 't2');
      final p1 = cam.toScreen(layer.pinPoint(t1));
      expect(layer.pinCenter(t1, cam).dy, greaterThan(p1.dy), reason: 'unter den Punkt, nicht auf den Titel');
      final p2 = cam.toScreen(layer.pinPoint(t2));
      expect(layer.pinCenter(t2, cam), p2 + CollabLayer.pinOffset);
    });
  });
}
