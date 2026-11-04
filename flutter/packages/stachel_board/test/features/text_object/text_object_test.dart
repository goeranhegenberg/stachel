// P2 text object (parity audit C05, D40, E06–E07, E09–E10): A−/A+ like the web's step over the 16 sizes, the size
// list with „Auto“ only for notes, bold/italic/strike for the whole object (on unless all have it), alignment sheet
// with vertical alignment for notes/shapes, fonts, a text with autoWidth following its width, the text tool editing
// an existing text, „Nächste Notiz“.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/text_object/text_format.dart';
import 'package:stachel_board/stachel_board.dart';

import '../shapes/p2_board.dart';

const _note = {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'};
const _text = {
  'id': 't1',
  'type': 'text',
  'x': 0,
  'y': 400,
  'w': 120,
  'h': 30,
  'text': 'Hallo Welt',
  'fontSize': 24,
  'autoWidth': true,
  'z': 'a1',
};
const _shape = {
  'id': 's1',
  'type': 'shape',
  'shape': 'rect',
  'x': 400,
  'y': 0,
  'w': 180,
  'h': 120,
  'text': 'Ja',
  'z': 'a2',
};

void main() {
  group('Schriftgröße wie im Web (core.font)', () {
    test('16 Stufen; A−/A+ springt zur nächsten Stufe, Zwischenwerte zur nächsten passenden', () {
      expect(fontSizes, [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 160]);
      expect(stepFontSize(24, 1), 28);
      expect(stepFontSize(24, -1), 20);
      expect(stepFontSize(25, 1), 28);
      expect(stepFontSize(25, -1), 24);
      expect(stepFontSize(160, 1), 160);
      expect(stepFontSize(10, -1), 10);
      expect(stepFontSize(300, -1), 128);
      expect(stepFontSize(31.6, 1), 40, reason: 'gerundet 32 → nächste Stufe');
    });

    test(
      'Breite eines Texts mit autoWidth: längste Zeile + Luft, Platzhalter wenn leer, Stärke wie die Darstellung',
      () {
        BoardObject t(Map<String, Object?> m) => BoardObject({'id': 'x', 'type': 'text', ...m});
        final plain = autoTextWidth(t({'text': 'Hallo Welt', 'fontSize': 24}));
        final measured = TextMetrics.instance.measure('Hallo Welt', 24, 500, 'Barlow');
        expect(plain, (measured + 24 * 0.25 + 4).ceilToDouble());
        expect(autoTextWidth(t({'text': 'Hallo Welt', 'fontSize': 24, 'bold': true})), greaterThan(plain));
        expect(autoTextWidth(t({'text': 'Hallo Welt', 'fontSize': 24, 'fontFamily': 'mono'})), greaterThan(plain));
        expect(autoTextWidth(t({'text': 'kurz\nHallo Welt', 'fontSize': 24})), plain, reason: 'längste Zeile');
        expect(
          autoTextWidth(t({'text': '', 'fontSize': 28})),
          autoTextWidth(t({'text': textPlaceholder, 'fontSize': 28})),
        );
        expect(autoTextWidth(t({'text': '', 'fontSize': 1000})), 2400, reason: 'höchstens 2400');
        expect(textWeight(24, false), 500);
        expect(textWeight(28, false), 600);
        expect(textWeight(48, true), 900);
      },
    );
  });

  group('Kontextleiste (E06, E07, E09, E10)', () {
    testWidgets('Notiz: A+ von Auto rechnet ab der automatischen Größe; Liste mit „Auto“; Werte 10 … 160', (
      tester,
    ) async {
      final b = await pumpP2Board(tester, objects: [_note]);
      await b.tapWorld(const Offset(100, 100));
      expect(find.byKey(const Key('stachelCtxFontValue')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('stachelCtxFontValue'))).data, 'Auto');
      await b.ctx('stachelCtxFontUp');
      final up = (b.patches['n1'] as Map)['fontSize'] as double;
      expect(fontSizes, contains(up));
      await b.ctx('stachelCtxFont');
      expect(find.byKey(const Key('stachelFont-auto')), findsOneWidget);
      expect(find.byKey(const Key('stachelFont-160')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelFont-64')));
      await tester.pumpAndSettle();
      expect(b.patches, {
        'n1': {'fontSize': 64.0},
      });
      await b.ctx('stachelCtxFontDown');
      expect(b.patches, {
        'n1': {'fontSize': 48.0},
      });
    });

    testWidgets('Text mit autoWidth: Größe, Fett, Schriftart ziehen die Breite nach; kein „Auto“', (tester) async {
      final b = await pumpP2Board(tester, objects: [_text]);
      await b.tapWorld(const Offset(40, 415));
      expect(tester.widget<Text>(find.byKey(const Key('stachelCtxFontValue'))).data, '24');
      await b.ctx('stachelCtxFontUp');
      final p = b.patches['t1'] as Map;
      expect(p['fontSize'], 28);
      expect(p['w'], autoTextWidth(BoardObject({..._text, 'fontSize': 28})));
      expect(p['h'], (28 * 1.22).ceilToDouble());
      await b.ctx('stachelCtxFont');
      expect(find.byKey(const Key('stachelFont-auto')), findsNothing, reason: '„Auto“ nur bei Notizen');
      await b.closeSheet();
      await b.ctx('stachelCtxBold');
      expect((b.patches['t1'] as Map)['bold'], true);
      expect((b.patches['t1'] as Map)['w'], greaterThan(p['w'] as double));
      await b.ctx('stachelCtxFamily');
      expect(find.byKey(const Key('stachelFamilySheet')), findsOneWidget);
      for (final k in ['barlow', 'condensed', 'serif', 'mono']) {
        expect(find.byKey(Key('stachelFamily-$k')), findsOneWidget);
      }
      await tester.tap(find.byKey(const Key('stachelFamily-serif')));
      await tester.pumpAndSettle();
      expect((b.patches['t1'] as Map)['fontFamily'], 'serif');
      expect((b.patches['t1'] as Map).containsKey('w'), isTrue);
      await b.ctx('stachelCtxFamily');
      await tester.tap(find.byKey(const Key('stachelFamily-barlow')));
      await tester.pumpAndSettle();
      expect((b.patches['t1'] as Map)['fontFamily'], isNull, reason: 'Barlow = Feld weg');
    });

    testWidgets('Fett/Kursiv/Durchgestrichen fürs ganze Objekt: an, wenn nicht alle haben', (tester) async {
      final b = await pumpP2Board(
        tester,
        objects: [
          _note,
          {..._shape, 'bold': true},
        ],
      );
      b.editor.select({'n1', 's1'});
      await tester.pump();
      await b.ctx('stachelCtxBold');
      expect(b.patches, {
        'n1': {'bold': true},
        's1': {'bold': true},
      });
      await b.ctx('stachelCtxItalic');
      expect(b.patches, {
        'n1': {'italic': true},
        's1': {'italic': true},
      });
      b.editor.select({'s1'});
      await tester.pump();
      await b.ctx('stachelCtxBold');
      expect(b.patches, {
        's1': {'bold': null},
      });
      await b.ctx('stachelCtxStrike');
      expect(b.patches, {
        's1': {'strike': true},
      });
    });

    testWidgets('Ausrichtung: Blatt mit links/Mitte/rechts und – bei Notiz/Form – oben/Mitte/unten', (tester) async {
      final b = await pumpP2Board(tester, objects: [_note, _text]);
      await b.tapWorld(const Offset(100, 100));
      await b.ctx('stachelCtxAlign');
      expect(find.byKey(const Key('stachelAlignSheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelAlign-right')));
      await tester.pump();
      expect(b.patches, {
        'n1': {'align': 'right'},
      });
      await tester.tap(find.byKey(const Key('stachelVAlign-bottom')));
      await tester.pump();
      expect(b.patches, {
        'n1': {'valign': 'bottom'},
      });
      await b.closeSheet();
      await b.tapWorld(const Offset(40, 415));
      await b.ctx('stachelCtxAlign');
      expect(find.byKey(const Key('stachelVAlign-top')), findsNothing, reason: 'Text: nur waagerecht');
    });
  });

  group('Text-Werkzeug (C05)', () {
    testWidgets('auf vorhandenem Text: bearbeitet ihn; daneben: neuer Text (28 px, Breite des Platzhalters)', (
      tester,
    ) async {
      final b = await pumpP2Board(tester, objects: [_text]);
      await tester.tap(find.byKey(const Key('stachelToolText')));
      await tester.pump();
      expect(b.editor.activeToolId, 'text');
      await b.tapWorld(const Offset(40, 415));
      expect(b.editor.editingId, 't1');
      expect(b.ops.where((o) => o['op'] == 'create'), isEmpty);
      expect(b.editor.tool, BoardTool.select);
      b.view.finishEditing();
      await tester.pump(ms(400));

      await tester.tap(find.byKey(const Key('stachelToolText')));
      await tester.pump();
      await b.tapWorld(const Offset(400, 600));
      final o = b.created.single;
      expect((o['type'], o['x'], o['y'], o['fontSize'], o['autoWidth']), ('text', 392.0, 582.0, 28, true));
      expect(o['w'], autoTextWidth(BoardObject(const {'id': 'x', 'type': 'text', 'fontSize': 28})));
      expect(b.editor.editingId, o['id']);
    });
  });

  group('Nächste Notiz (D40)', () {
    testWidgets('beim Schreiben: gleiche leere Notiz rechts an der nächsten freien Stelle, schreibt dort weiter', (
      tester,
    ) async {
      final b = await pumpP2Board(
        tester,
        objects: [
          {..._note, 'color': '#9fd3ff', 'tags': const []},
          const {'id': 'x', 'type': 'sticky', 'x': 240, 'y': 0, 'w': 200, 'h': 200, 'z': 'a5'},
        ],
      );
      expect(b.view.editText('n1'), isTrue);
      await tester.pump();
      expect(find.byKey(const Key('stachelEditNext')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelEditNext')));
      await tester.pump();
      final o = b.created.single;
      expect((o['x'], o['y'], o['w'], o['h'], o['color'], o['text']), (480.0, 0.0, 200, 200, '#9fd3ff', ''));
      expect(o.containsKey('tags'), isFalse);
      expect(b.editor.editingId, o['id']);
      expect(b.editor.selection.value, {o['id']});

      // left of the first: free right away
      b.view.finishEditing();
      expect(b.view.editText('n1'), isTrue);
      expect(editNext(b.ui, back: true), isNotNull);
      expect((b.created.single['x'], b.created.single['y']), (-240.0, 0.0));
    });

    testWidgets('nicht bei Text-Objekten', (tester) async {
      final b = await pumpP2Board(tester, objects: [_text]);
      expect(b.view.editText('t1'), isTrue);
      await tester.pump();
      expect(find.byKey(const Key('stachelEditNext')), findsNothing);
      expect(editNext(b.ui), isNull);
    });
  });
}
