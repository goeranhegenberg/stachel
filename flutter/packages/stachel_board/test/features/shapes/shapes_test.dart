// P2 shapes (parity audit C04, C06–C07, D39, E03–E05, E11, J01): library catalog and search like the web, the shape
// tool (quick choice, library size, drawing), the note tool (color, square/rectangle; also double tap), the shape's
// context bar (Form ändern, Füllfarbe with own color/none/opacity, Rand), note shape, „Form anhängen“.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/shapes/attach.dart';
import 'package:stachel_board/src/features/shapes/catalog.dart';
import 'package:stachel_board/src/features/shapes/shape_state.dart';
import 'package:stachel_board/src/features/shapes/shape_widgets.dart';
import 'package:stachel_board/stachel_board.dart';

import 'p2_board.dart';

const _note = {
  'id': 'n1',
  'type': 'sticky',
  'x': 0,
  'y': 0,
  'w': 200,
  'h': 200,
  'text': 'Bühne',
  'z': 'a0',
  'color': '#fff27a',
};
const _shape = {
  'id': 's1',
  'type': 'shape',
  'shape': 'rect',
  'x': 300,
  'y': 0,
  'w': 180,
  'h': 120,
  'text': '',
  'z': 'a1',
  'color': '#ffffff',
  'stroke': '#0a0a0a',
  'strokeWidth': 0,
};

void main() {
  group('Katalog wie im Web (catalog.ts)', () {
    test('49 Einträge in drei Abschnitten, 41 Formen in der Reihenfolge des Formen-Registers', () {
      expect(shapeEntries, hasLength(49));
      expect([for (final (id, _) in shapeSections) id], ['basic', 'arrows', 'flow']);
      expect(shapeKindList, hasLength(41));
      expect({for (final (k, _) in shapeKindList) k}, shapeKinds.toSet());
      expect(shapeKindList.take(6).toList(), [
        ('rect', 'Rechteck'),
        ('ellipse', 'Ellipse'),
        ('diamond', 'Raute'),
        ('triangle', 'Dreieck'),
        ('roundrect', 'Abgerundetes Rechteck'),
        ('pentagon', 'Fünfeck'),
      ]);
      expect(entryById('circle')!.w, 140);
      expect(entryOfKind('cylinder')!.id, 'cylinder', reason: 'erster Eintrag der Form');
    });

    test('Suche: klein, Umlaute wie ae/oe/ue, alle Wörter; Stichwörter und Art zählen', () {
      expect(searchShapes('VERZÖG').map((e) => e.id), ['delay']);
      expect(searchShapes('verzoeg').map((e) => e.id), ['delay']);
      expect(searchShapes('pfeil rechts').map((e) => e.id), ['arrowRight']);
      expect(searchShapes('speicher').map((e) => e.id), ['database', 'storedData', 'internalStorage']);
      expect(searchShapes('zzz'), isEmpty);
      expect(searchShapes('  ').length, 49);
      expect(searchKinds('herz').map((k) => k.$1), ['heart']);
      expect(searchKinds('viereck').map((k) => k.$1), ['rect'], reason: 'Kern-Form mit den Wörtern ihres Eintrags');
    });

    test('Notizform aus dem Seitenverhältnis; Wechsel hält Höhe und Mitte', () {
      expect(stickyShapeOf(BoardObject(const {'id': 'a', 'type': 'sticky', 'w': 200, 'h': 200})), 'square');
      expect(stickyShapeOf(BoardObject(const {'id': 'a', 'type': 'sticky', 'w': 350, 'h': 200})), 'rect');
      expect(stickyShapeOf(BoardObject(const {'id': 'a', 'type': 'sticky', 'w': 260, 'h': 200})), 'free');
      expect(stickyShapePatch(BoardObject(const {'id': 'a', 'type': 'sticky', 'x': 0, 'w': 200, 'h': 200}), 'rect'), {
        'x': -75.0,
        'w': 350.0,
      });
      expect(
        stickyShapePatch(BoardObject(const {'id': 'a', 'type': 'sticky', 'x': 0, 'w': 200, 'h': 200}), 'square'),
        isNull,
      );
    });
  });

  group('Formen-Werkzeug (C06, C07, J01)', () {
    testWidgets('Schnellwahl: Kreis → Tippen legt ihn in Katalog-Größe 140² an, danach Auswahl', (tester) async {
      final b = await pumpP2Board(tester);
      await tester.tap(find.byKey(const Key('stachelToolShape')));
      await tester.pump();
      expect(b.editor.activeToolId, 'shape');
      expect(find.byKey(const Key('stachelShapeOptions')), findsOneWidget);
      for (final id in quickShapeIds) {
        expect(find.byKey(Key('stachelShape-$id')), findsOneWidget, reason: id);
      }
      await tester.tap(find.byKey(const Key('stachelShape-circle')));
      await tester.pump();
      expect(tester.widget<P2FlyButton>(find.byKey(const Key('stachelShape-circle'))).active, isTrue);
      await b.tapWorld(const Offset(400, 300));
      final o = b.created.single;
      expect((o['shape'], o['w'], o['h'], o['x'], o['y']), ('ellipse', 140.0, 140.0, 330.0, 230.0));
      expect((o['color'], o['stroke'], o['strokeWidth'], o['fontSize']), ('#ffffff', '#0a0a0a', 2, 20));
      expect(b.editor.tool, BoardTool.select, reason: 'einmalig');
      expect(b.editor.selection.value, {o['id']});
      expect(b.editor.editingId, isNull, reason: 'Formen werden nur gewählt (wie im Web)');
    });

    testWidgets('Aufziehen mit dem Finger: Rechteck aus dem Zug, mindestens 16; Vorschau während des Ziehens', (
      tester,
    ) async {
      final b = await pumpP2Board(tester);
      b.editor.useTool('shape');
      await tester.pump();
      final g = await tester.startGesture(b.screen(const Offset(100, 100)));
      await g.moveTo(b.screen(const Offset(150, 120)));
      await tester.pump();
      await g.moveTo(b.screen(const Offset(340.4, 260.6)));
      await tester.pump();
      expect(find.byKey(const Key('stachelShapeDraft')), findsOneWidget);
      await g.up();
      await tester.pump();
      final o = b.created.single;
      expect((o['x'], o['y'], o['w'], o['h']), (100.0, 100.0, 240.0, 161.0));
      expect(find.byKey(const Key('stachelShapeDraft')), findsNothing);
      expect(b.editor.tool, BoardTool.select);

      b.editor.useTool('shape');
      final g2 = await tester.startGesture(b.screen(const Offset(500, 500)));
      await g2.moveTo(b.screen(const Offset(520, 504)));
      await tester.pump();
      await g2.moveTo(b.screen(const Offset(505, 520)));
      await g2.up();
      await tester.pump();
      final o2 = b.created.single;
      expect((o2['w'], o2['h']), (16.0, 20.0), reason: 'schmal → 16');
    });

    testWidgets('„Alle Formen“: Bibliothek mit Abschnitten und Suche, Antippen wählt die Form fürs Werkzeug', (
      tester,
    ) async {
      final b = await pumpP2Board(tester);
      await tester.tap(find.byKey(const Key('stachelToolShape')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelShapeAll')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelLibrary')), findsOneWidget);
      expect(find.text('GRUNDFORMEN'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelLibSearch')), 'gibtsnicht');
      await tester.pump();
      expect(find.text('Keine Form gefunden.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelLibSearch')), 'datenbank');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelLibShape-database')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelLibrary')), findsNothing);
      expect(b.editor.activeToolId, 'shape');
      expect(
        find.byKey(const Key('stachelShape-database')),
        findsNothing,
        reason: 'Zylinder steht schon in der Schnellwahl',
      );
      await b.tapWorld(const Offset(400, 300));
      expect(
        (b.created.single['shape'], b.created.single['w'], b.created.single['h']),
        ('cylinder', 120.0, 140.0),
        reason: 'Größe des gewählten Eintrags',
      );
      await tester.tap(find.byKey(const Key('stachelToolShape')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelShapeAll')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelLibShape-heart')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelShape-heart')), findsOneWidget, reason: 'gewählte Bibliotheksform vorn');
    });
  });

  group('Haftnotiz-Werkzeug (C04, E11)', () {
    testWidgets('Optionen: Farbe und Rechteck gelten für neue Notizen – Werkzeug und Doppeltippen', (tester) async {
      final b = await pumpP2Board(tester);
      await tester.tap(find.byKey(const Key('stachelToolSticky')));
      await tester.pump();
      for (final c in stickyColors) {
        expect(find.byKey(Key('stachelStickyColor-$c')), findsOneWidget);
      }
      await tester.tap(find.byKey(const Key('stachelStickyColor-#9fd3ff')));
      await tester.tap(find.byKey(const Key('stachelStickyShape-rect')));
      await tester.pump();
      await b.tapWorld(const Offset(400, 300));
      final o = b.created.single;
      expect(
        (o['type'], o['w'], o['h'], o['x'], o['y'], o['color']),
        ('sticky', 350.0, 200.0, 225.0, 200.0, '#9fd3ff'),
      );
      expect(b.editor.editingId, o['id'], reason: 'schreibt gleich');
      b.view.finishEditing();
      await tester.pump(ms(400));
      final p = b.screen(const Offset(600, 700));
      await tester.tapAt(p);
      await tester.pump(ms(50));
      await tester.tapAt(p);
      await tester.pump(ms(400));
      expect(
        (b.created.single['w'], b.created.single['color']),
        (350.0, '#9fd3ff'),
        reason: 'Doppeltippen wie das Werkzeug',
      );
    });

    testWidgets('Kontextleiste „Form der Notiz“: Rechteck, Höhe und Mitte bleiben, wird Voreinstellung', (
      tester,
    ) async {
      final b = await pumpP2Board(tester, objects: [_note]);
      await b.tapWorld(const Offset(100, 100));
      await b.ctx('stachelCtxNoteShape');
      expect(find.byKey(const Key('stachelNoteShapeSheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelNoteShape-rect')));
      await tester.pumpAndSettle();
      expect(b.patches, {
        'n1': {'x': -75.0, 'w': 350.0},
      });
      expect(P2Tools.of(b.editor).stickyShape, 'rect');
    });
  });

  group('Kontextleiste der Form (E03–E05)', () {
    testWidgets('keine Farbe im Kern-Eintrag; Form ändern mit Suche; Füllung: Palette, eigene Farbe, ohne, Deckkraft', (
      tester,
    ) async {
      final b = await pumpP2Board(tester, objects: [_shape]);
      await b.tapWorld(const Offset(390, 60));
      expect(find.byKey(const Key('stachelCtxColor')), findsNothing, reason: 'Füllung hat eine eigene Palette');
      await b.ctx('stachelCtxShapeKind');
      expect(find.byKey(const Key('stachelKind-or')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelKindSearch')), 'liebe');
      await tester.pump();
      expect(find.byKey(const Key('stachelKind-rect')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelKind-heart')));
      await tester.pumpAndSettle();
      expect(b.patches, {
        's1': {'shape': 'heart'},
      });

      await b.ctx('stachelCtxFill');
      expect(find.byKey(const Key('stachelFillSheet')), findsOneWidget);
      expect(find.bySemanticsLabel('Füllfarbe Mint'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelFill-#b9ecd8')));
      await tester.pump();
      expect(b.patches, {
        's1': {'color': '#b9ecd8'},
      });
      expect(find.byKey(const Key('stachelFillSheet')), findsOneWidget, reason: 'bleibt offen wie im Web');
      await tester.tap(find.byKey(const Key('stachelFillNone')));
      await tester.pump();
      expect(b.patches, {
        's1': {'fillOpacity': 0},
      });
      // opacity: one drag, one closing patch
      final slider = tester.getRect(find.byKey(const Key('stachelFillOpacity')));
      final g = await tester.startGesture(Offset(slider.left + 24, slider.center.dy));
      await g.moveTo(Offset(slider.center.dx, slider.center.dy));
      await tester.pump();
      await g.up();
      await tester.pumpAndSettle();
      final a = (b.patches['s1'] as Map)['fillOpacity'] as double;
      expect(a, inInclusiveRange(0.4, 0.6));
      expect((a * 100).round() % 5, 0, reason: 'Schritte von 5 %');
      // own color
      await tester.tap(find.byKey(const Key('stachelFillCustom')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelCustomColorSheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelCustomColorOk')));
      await tester.pumpAndSettle();
      expect(b.patches, {
        's1': {'color': '#b9ecd8'},
      }, reason: 'unverändert übernommen');
    });

    testWidgets('100 % Deckkraft entfernt das Feld', (tester) async {
      final b = await pumpP2Board(
        tester,
        objects: [
          {..._shape, 'fillOpacity': 0.3},
        ],
      );
      await b.tapWorld(const Offset(390, 60));
      await b.ctx('stachelCtxFill');
      final slider = tester.getRect(find.byKey(const Key('stachelFillOpacity')));
      final g = await tester.startGesture(slider.center);
      await g.moveTo(Offset(slider.right + 40, slider.center.dy));
      await g.up();
      await tester.pumpAndSettle();
      expect(b.patches, {
        's1': {'fillOpacity': null},
      });
    });

    testWidgets('Rand: Farbe ohne Rand setzt 2, Breiten Ohne/1/2/4/8, Strichart', (tester) async {
      final b = await pumpP2Board(tester, objects: [_shape]);
      await b.tapWorld(const Offset(390, 60));
      await b.ctx('stachelCtxBorder');
      await tester.tap(find.byKey(const Key('stachelBorderColor-#1763b5')));
      await tester.pump();
      expect(b.patches, {
        's1': {'stroke': '#1763b5', 'strokeWidth': 2},
      });
      for (final w in [0, 1, 2, 4, 8]) {
        expect(find.byKey(Key('stachelBorderWidth-$w')), findsOneWidget);
      }
      await tester.tap(find.byKey(const Key('stachelBorderWidth-8')));
      await tester.pump();
      expect(b.patches, {
        's1': {'strokeWidth': 8.0},
      });
      await tester.tap(find.byKey(const Key('stachelBorderDash-dotted')));
      await tester.pump();
      expect(b.patches, {
        's1': {'dash': 'dotted'},
      });
      await tester.tap(find.byKey(const Key('stachelBorderDash-solid')));
      await tester.pump();
      expect(b.patches, {
        's1': {'dash': null},
      });
    });
  });

  group('Form anhängen (D39)', () {
    testWidgets(
      'Verbinder aus einem Objekt ins Leere → Auswahl am Ende; Kreis liegt hinter dem Ende, Linie geschwungen',
      (tester) async {
        final b = await pumpP2Board(tester, objects: [_note]);
        b.editor.useTool('connector');
        await tester.pump();
        final g = await tester.startGesture(b.screen(const Offset(100, 100)));
        await g.moveTo(b.screen(const Offset(300, 100)));
        await tester.pump();
        await g.moveTo(b.screen(const Offset(500, 100)));
        await tester.pump();
        await g.up();
        await tester.pump();
        final c = b.created.single;
        expect(c['type'], 'connector');
        expect(find.byKey(const Key('stachelAttachPicker')), findsOneWidget);
        expect(find.byKey(const Key('stachelAttach-same')), findsOneWidget, reason: 'aus einer Notiz: gleiche Form');
        await tester.tap(find.byKey(const Key('stachelAttach-circle')));
        await tester.pump();
        final ops = b.source.sent.lastWhere((m) => m['t'] == 'ops')['ops'] as List;
        final made = ((ops[0] as Map)['objects'] as List).single as Map;
        // web attachAt: center 70 px (half the circle) beyond the free end in the drag's direction
        expect((made['shape'], made['w'], made['x'], made['y']), ('ellipse', 140.0, 500.0, 30.0));
        expect((ops[1] as Map)['patches'], {
          c['id']: {
            'to': {'objectId': made['id']},
            'lineStyle': 'curved',
          },
        });
        expect(b.editor.selection.value, {made['id']});
        expect(b.editor.editingId, made['id'], reason: 'schreibt gleich');
        expect(find.byKey(const Key('stachelAttachPicker')), findsNothing);
      },
    );

    testWidgets('anderes ausgewählt → Auswahl verschwindet; ein alter Verbinder öffnet sie nicht', (tester) async {
      final b = await pumpP2Board(
        tester,
        objects: [
          _note,
          {
            'id': 'c0',
            'type': 'connector',
            'from': {'objectId': 'n1'},
            'to': {'x': 600, 'y': 100},
            'z': 'a5',
          },
        ],
      );
      b.editor.select({'c0'});
      await tester.pump();
      expect(find.byKey(const Key('stachelAttachPicker')), findsNothing, reason: 'vom Server bestätigt = alt');
      expect(attachFor(b.ui), isNull);
    });
  });
}
