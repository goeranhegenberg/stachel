// P8 accessibility (parity audit P01–P05): the selection is announced like the web (`describeSelection`), every
// visible object is a semantics node in z-order (screen reader swipes through them, double tap selects), German
// color names, buttons ≥ 40 px, „weniger Bewegung“ makes the camera jump.

import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/a11y/a11y_layer.dart';
import 'package:stachel_board/stachel_board.dart';

import '../richtext/p8_board.dart';

const _note = {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'};
const _shape = {
  'id': 's1',
  'type': 'shape',
  'shape': 'ellipse',
  'x': 300,
  'y': 0,
  'w': 180,
  'h': 120,
  'text': 'Ja',
  'locked': true,
  'z': 'a1',
};
const _frame = {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 300, 'w': 400, 'h': 200, 'title': 'Plan', 'z': 'a2'};
const _far = {'id': 'far', 'type': 'sticky', 'x': 9000, 'y': 9000, 'w': 200, 'h': 200, 'text': 'weit weg', 'z': 'a3'};

void main() {
  test('Beschreibungen wie das Web (a11yDescribeObject/a11yDescribeSelection)', () {
    expect(a11yDescribeObject(BoardObject(_note)), 'Haftnotiz „Bühne“');
    expect(a11yDescribeObject(BoardObject(_shape)), 'Ellipse „Ja“, gesperrt');
    expect(a11yDescribeObject(BoardObject(_frame)), 'Rahmen „Plan“');
    expect(a11yDescribeObject(BoardObject({..._note, 'text': 'x' * 80})), 'Haftnotiz „${'x' * 57}…“');
    expect(a11yDescribeSelection([BoardObject(_note)]), 'Haftnotiz „Bühne“ ausgewählt');
    expect(a11yDescribeSelection([BoardObject(_note), BoardObject(_shape)]), '2 Objekte ausgewählt');
    expect(a11yDescribeSelection(const []), 'Auswahl aufgehoben');
    expect(colorName('#FFF27A'), 'Gelb');
    expect(colorName('#123456'), '#123456');
  });

  testWidgets('Auswahl wird angesagt, nicht beim Start und nicht doppelt (P01)', (tester) async {
    final said = <String>[];
    final old = announceText;
    announceText = said.add;
    addTearDown(() => announceText = old);
    final b = await pumpP8Board(tester, objects: [_note, _shape]);
    expect(said, isEmpty);
    await b.tapWorld(const Offset(100, 100));
    expect(said, ['Haftnotiz „Bühne“ ausgewählt']);
    b.editor.select({'n1', 's1'});
    await tester.pump();
    b.editor.select({'n1', 's1'});
    await tester.pump();
    expect(said.last, '2 Objekte ausgewählt');
    expect(said.length, 2);
    b.editor.select(const {});
    await tester.pump();
    expect(said.last, 'Auswahl aufgehoben');
  });

  testWidgets('Screenreader: ein Knoten je sichtbarem Objekt in z-Reihenfolge, Doppeltippen wählt (P02)', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final b = await pumpP8Board(tester, objects: [_note, _shape, _frame, _far], screenReader: true);
    await tester.pumpAndSettle();
    final node = find.bySemanticsLabel('Haftnotiz „Bühne“');
    expect(node, findsOneWidget);
    expect(find.bySemanticsLabel('Ellipse „Ja“, gesperrt'), findsOneWidget);
    expect(find.bySemanticsLabel('Rahmen „Plan“'), findsOneWidget);
    expect(find.bySemanticsLabel('Haftnotiz „weit weg“'), findsNothing, reason: 'nur sichtbare');
    tester.semantics.tap(find.semantics.byLabel('Haftnotiz „Bühne“'));
    await tester.pump();
    expect(b.editor.selection.value, {'n1'});
    expect(tester.getSemantics(node).getSemanticsData().flagsCollection.isSelected, Tristate.isTrue);
    // the nodes take no touches: a tap on the board still selects
    await b.tapWorld(const Offset(390, 60));
    expect(b.editor.selection.value, {'s1'});
    handle.dispose();
  });

  testWidgets('ohne Screenreader keine Knoten (kein Aufwand je Kamerabewegung)', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpP8Board(tester, objects: [_note]);
    expect(find.bySemanticsLabel('Haftnotiz „Bühne“'), findsNothing);
    handle.dispose();
  });

  testWidgets('Werkzeuge mit Zustand, Knöpfe ≥ 40 px, Farben mit Namen (P03, P04)', (tester) async {
    final handle = tester.ensureSemantics();
    final b = await pumpP8Board(tester, objects: [_note]);
    await b.tapWorld(const Offset(100, 100));
    await b.ctx('stachelCtxColor');
    expect(find.bySemanticsLabel('Farbe Gelb'), findsOneWidget);
    // wie web core.color: unter der Palette „zuletzt benutzt“ mit „+ Eigene Farbe“ (Welle B)
    expect(find.byKey(const Key('stachelRecentColors')), findsOneWidget);
    // touch targets (an IconButton's tap area includes its padding) of the context bar, the sheet and the tool bar
    for (final f in [find.byType(IconButton), find.byKey(const Key('stachelColor-#fff27a'))]) {
      for (final e in f.evaluate()) {
        final r = tester.getRect(find.byWidget(e.widget));
        if (r.width < 1) continue;
        expect(r.width >= 40 && r.height >= 40, isTrue, reason: '${e.widget.key} $r');
      }
    }
    handle.dispose();
  });

  testWidgets('weniger Bewegung: Kamera springt statt zu gleiten (P05)', (tester) async {
    final b = await pumpP8Board(tester, objects: [_note], reduceMotion: true);
    await tester.pump();
    expect(reduceMotion, isTrue);
    BoardViewPrefs.of(b.ui).animateCamera(const Camera(-500, -300, 2));
    expect(b.view.camera.value, const Camera(-500, -300, 2), reason: 'sofort, ohne Animation');
  });

  test('Handgriffe 44 px (P04)', () {
    expect(handleRadius * 2, greaterThanOrEqualTo(44));
  });
}
