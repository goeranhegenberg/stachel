// P8 UI (parity audit E08, F04–F08, F11–F15, F17): the format bar while writing (size incl. part size in em, „Mehr“
// with paragraph styles, lists, indent, alignment, font; link field), the context bar's format for the whole object
// (act `richtext.whole`), check boxes and links on the board (act `richtext.toggleTask`, „Link öffnen?“), the text
// scrolls inside an overfull note while writing.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'p8_board.dart';

Map<String, Object?> para(String t, [List<Map<String, Object?>>? marks]) => {
  'type': 'paragraph',
  'content': [
    {'type': 'text', 'text': t, 'marks': ?marks},
  ],
};

const _note = {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'};
const _text = {
  'id': 't1',
  'type': 'text',
  'x': 0,
  'y': 400,
  'w': 200,
  'h': 30,
  'text': 'Hallo Welt',
  'fontSize': 24,
  'z': 'a1',
};
final _todo = {
  'id': 'todo',
  'type': 'sticky',
  'x': 300,
  'y': 0,
  'w': 200,
  'h': 200,
  'fontSize': 24,
  'valign': 'top',
  'align': 'left',
  'text': 'Eins\nZwei',
  'content': {
    'type': 'doc',
    'content': [
      {
        'type': 'taskList',
        'content': [
          for (final t in ['Eins', 'Zwei'])
            {
              'type': 'taskItem',
              'attrs': {'checked': false},
              'content': [para(t)],
            },
        ],
      },
    ],
  },
  'z': 'a2',
};
final _linked = {
  'id': 'l1',
  'type': 'sticky',
  'x': 0,
  'y': 600,
  'w': 200,
  'h': 200,
  'fontSize': 24,
  'text': 'Plan',
  'content': {
    'type': 'doc',
    'content': [
      para('Plan', [
        {
          'type': 'link',
          'attrs': {'href': 'https://beispiel.org/plan'},
        },
      ]),
    ],
  },
  'z': 'a3',
};

void main() {
  group('Format-Leiste beim Schreiben (F05–F08, F12)', () {
    testWidgets('Leiste wie im Web am Handy: Größe, B/I/U, Farbe, Markierung, Link, Mehr', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note]);
      expect(b.view.editText('n1'), isTrue);
      await tester.pumpAndSettle();
      for (final k in ['size', 'bold', 'italic', 'underline', 'color', 'highlight', 'link', 'more']) {
        expect(find.byKey(Key('stachelFmt-$k')), findsOneWidget, reason: k);
      }
      expect(tester.widget<Text>(find.byKey(const Key('stachelFmtSizeValue'))).data, 'Auto');
      await b.tap('stachelFmt-underline');
      expect(jsonEncode(b.lastDoc), contains('"underline"'));
      await b.tap('stachelFmt-color');
      expect(find.bySemanticsLabel('Textfarbe Blau'), findsOneWidget, reason: 'deutsche Farbnamen (P03)');
      await b.tap('stachelFmtColor-#1763b5');
      expect(jsonEncode(b.lastDoc), contains('#1763b5'));
    });

    testWidgets('Mehr: Zitat, Code-Block, Liste + Einrücken, Ausrichtung, Schriftart', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note]);
      b.view.editText('n1');
      await tester.pumpAndSettle();
      await b.tap('stachelFmt-more');
      await b.tap('stachelFmtBlock-quote');
      expect((b.lastDoc['content'] as List).single, containsPair('type', 'blockquote'));
      await b.tap('stachelFmt-more');
      await b.tap('stachelFmtBlock-code');
      expect(jsonEncode(b.lastDoc), contains('codeBlock'));
      await b.tap('stachelFmt-more');
      await b.tap('stachelFmtBlock-p');
      expect(b.lastDoc['content'], [para('Bühne')]);
      await b.tap('stachelFmt-more');
      await b.tap('stachelFmt-bullets');
      expect(b.field.text, '• Bühne', reason: 'Punkt sichtbar beim Schreiben (F04)');
      await b.tap('stachelFmtAlign-left');
      final update = b.ops.lastWhere((o) => o['op'] == 'update');
      expect((update['patches'] as Map)['n1'], {'align': 'left'});
      await b.tap('stachelFmtFont-serif');
      expect(((b.ops.lastWhere((o) => o['op'] == 'update')['patches'] as Map)['n1'] as Map)['fontFamily'], 'serif');
    });

    testWidgets('Größe: ganzer Text = Objektgröße; markierter Teil eines Texts = em der Objektgröße', (tester) async {
      final b = await pumpP8Board(tester, objects: [_text]);
      b.view.editText('t1');
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const Key('stachelFmtSizeValue'))).data, '24');
      await b.selectText(0, 5);
      await b.tap('stachelFmt-size');
      await b.tap('stachelFmtSize-48');
      expect(jsonEncode(b.lastDoc), contains('"fontSize":"2em"'));
      expect(tester.widget<Text>(find.byKey(const Key('stachelFmtSizeValue'))).data, '48');
      await b.selectText(0, 0);
      await b.tap('stachelFmt-size');
      await b.tap('stachelFmtSize-32');
      expect(((b.ops.lastWhere((o) => o['op'] == 'update')['patches'] as Map)['t1'] as Map)['fontSize'], 32);
      expect(jsonEncode(b.lastDoc), isNot(contains('fontSize')), reason: 'Teil-Größen entfallen');
    });

    testWidgets('Link: ohne Auswahl wird die Eingabe als Link eingefügt; ungültig = Fehlertext', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note]);
      b.view.editText('n1');
      await tester.pumpAndSettle();
      await b.selectText(5, 5);
      await b.tap('stachelFmt-link');
      await tester.enterText(find.byKey(const Key('stachelFmtLinkField')), 'javascript:alert(1)');
      await b.tap('stachelFmtLinkSave');
      expect(find.text('Das ist kein gültiger Link.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelFmtLinkField')), 'beispiel.org');
      await b.tap('stachelFmtLinkSave');
      final doc = jsonEncode(b.lastDoc);
      expect(doc, contains('"text":"beispiel.org"'));
      expect(doc, contains('https://beispiel.org/'));
    });

    testWidgets('Markdown-Kürzel im echten Textfeld: „- “ wird Aufzählung mit Punkt', (tester) async {
      final b = await pumpP8Board(
        tester,
        objects: [
          {..._note, 'text': ''},
        ],
      );
      b.view.editText('n1');
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('boardTextField')), '-');
      await tester.enterText(find.byKey(const Key('boardTextField')), '- ');
      await tester.pump();
      expect(b.field.text, '• ');
      await tester.pump(ms(50));
      expect((b.lastDoc['content'] as List).single, containsPair('type', 'bulletList'));
    });

    testWidgets('Überfüllte Notiz: das Textfeld bleibt in der Notiz und scrollt (F17)', (tester) async {
      final long = List.filled(30, 'Zeile mit Text').join('\n');
      final b = await pumpP8Board(
        tester,
        objects: [
          {..._note, 'text': long, 'fontSize': 24},
        ],
      );
      b.view.editText('n1');
      await tester.pumpAndSettle();
      final field = tester.getRect(find.byKey(const Key('boardTextField')));
      final note = Rect.fromPoints(b.screen(Offset.zero), b.screen(const Offset(200, 200)));
      expect(field.height, lessThanOrEqualTo(note.height + 1));
      final scroll = tester.state<ScrollableState>(
        find.descendant(of: find.byKey(const Key('boardTextField')), matching: find.byType(Scrollable)),
      );
      expect(scroll.position.maxScrollExtent, greaterThan(0), reason: 'der Text scrollt im Feld');
    });
  });

  group('Kontextleiste fürs ganze Objekt (E08, F15)', () {
    testWidgets('Unterstrichen nach Kursiv, Textfarbe/Markierung/Liste/Link als richtext.whole', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note, _text]);
      await b.tapWorld(const Offset(100, 100));
      await b.ctx('stachelCtxUnderline');
      expect(b.acts.last, containsPair('name', 'richtext.whole'));
      expect(b.acts.last['args'], {
        'ids': ['n1'],
        'op': 'underline',
        'value': true,
      });
      await b.ctx('stachelCtxHighlight');
      await b.tap('stachelCtxHighlight-#c9e14a');
      expect(b.acts.last['args'], {
        'ids': ['n1'],
        'op': 'highlight',
        'value': '#c9e14a',
      });
      await b.ctx('stachelCtxTextColor');
      await b.tap('stachelCtxTextColor-none');
      expect((b.acts.last['args'] as Map)['value'], isNull);
      await b.ctx('stachelCtxList');
      await b.tap('stachelCtxList-taskList');
      expect(b.acts.last['args'], {
        'ids': ['n1'],
        'op': 'list',
        'value': 'taskList',
      });
      await b.ctx('stachelCtxRichLink');
      await tester.enterText(find.byKey(const Key('stachelFmtLinkField')), 'beispiel.org');
      await b.tap('stachelFmtLinkSave');
      expect(b.acts.last['args'], {
        'ids': ['n1'],
        'op': 'link',
        'value': 'beispiel.org',
      });
    });

    testWidgets('Reihenfolge wie im Web; ohne Aktion am Server keine Einträge', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note]);
      await b.tapWorld(const Offset(100, 100));
      final keys = [
        for (final def in b.ui.registry.contextActions.list())
          if (def.id == 'core.format' && def.appliesTo(CtxInfo(b.editor.selected), b.ui))
            for (final i in def.items(tester.element(find.byType(BoardView)), b.ui, CtxInfo(b.editor.selected))) i.key,
      ];
      expect(keys, [
        'stachelCtxBold',
        'stachelCtxItalic',
        'stachelCtxUnderline',
        'stachelCtxStrike',
        'stachelCtxTextColor',
        'stachelCtxHighlight',
        'stachelCtxList',
        'stachelCtxRichLink',
        'stachelCtxAlign',
      ]);
    });

    testWidgets('alter Server ohne richtext.whole: nur die Einträge von P2', (tester) async {
      final b = await pumpP8Board(tester, objects: [_note], actions: false);
      await b.tapWorld(const Offset(100, 100));
      expect(find.byKey(const Key('stachelCtxUnderline')), findsNothing);
    });
  });

  group('Kästchen und Links auf dem Board (F13, F14)', () {
    Offset boxOf(P8Board b, String id, int index) {
      final o = b.controller.state[id]!;
      // the first glyph of each line: left padding of the note + half a box
      final pad = (200 * 0.09).roundToDouble();
      return Offset(o.x + pad + 10, o.y + pad + 14 + index * 24 * 1.22);
    }

    testWidgets('ein Tipp aufs Kästchen hakt ab: act richtext.toggleTask, keine Auswahl, sofort sichtbar', (
      tester,
    ) async {
      final b = await pumpP8Board(tester, objects: [_todo]);
      await b.tapWorld(boxOf(b, 'todo', 1));
      expect(b.acts.single['name'], 'richtext.toggleTask');
      expect(b.acts.single['args'], {'id': 'todo', 'index': 1});
      expect(b.editor.selection.value, isEmpty, reason: 'ohne Auswahl');
      expect(b.editor.editingId, isNull);
      // a tap on the text itself selects as usual
      await tester.pump(ms(400));
      await b.tapWorld(const Offset(450, 150));
      expect(b.editor.selection.value, {'todo'});
    });

    testWidgets('gesperrt: kein Abhaken', (tester) async {
      final b = await pumpP8Board(
        tester,
        objects: [
          {..._todo, 'locked': true},
        ],
      );
      await b.tapWorld(boxOf(b, 'todo', 0));
      expect(b.acts, isEmpty);
    });

    testWidgets('Link antippen → „Link öffnen?“ mit kurzer Adresse; Öffnen geht an den Host, Abbrechen nicht', (
      tester,
    ) async {
      final b = await pumpP8Board(tester, objects: [_linked]);
      await b.tapWorld(const Offset(100, 700));
      expect(find.byKey(const Key('stachelLinkConfirm')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('stachelLinkConfirmUrl'))).data, 'beispiel.org/plan');
      await tester.tap(find.byKey(const Key('stachelLinkConfirmCancel')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelLinkConfirm')), findsNothing);
      expect(b.host.opened, isEmpty);
      // (test taps carry no time stamps: tap elsewhere so the next one is no double tap)
      await b.tapWorld(const Offset(600, 300));
      await b.tapWorld(const Offset(100, 700));
      await tester.tap(find.byKey(const Key('stachelLinkConfirmOpen')));
      await tester.pumpAndSettle();
      expect(b.host.opened, ['https://beispiel.org/plan']);
      expect(b.editor.editingId, isNull);
    });
  });
}
