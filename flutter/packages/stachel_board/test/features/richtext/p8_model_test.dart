// P8 model (parity audit F04, F06, F08, F11, F12, F13): the editor shows the board's bullets/numbers/boxes (its text
// equals the board's text span), paragraph styles incl. quote and code block, indent/outdent, Backspace/Enter in
// lists, Markdown shortcuts like Tiptap's input rules, links like the web's link field, part sizes in em, check boxes.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/richtext/board_hits.dart';
import 'package:stachel_board/stachel_board.dart';

Map<String, Object?> p(String t, [List<Map<String, Object?>>? marks]) => {
  'type': 'paragraph',
  if (t.isNotEmpty)
    'content': [
      {'type': 'text', 'text': t, 'marks': ?marks},
    ],
};
Map<String, Object?> list(String type, List<Object?> items, {bool? checked}) => {
  'type': type,
  'content': [
    for (final it in items)
      {
        'type': type == 'taskList' ? 'taskItem' : 'listItem',
        if (type == 'taskList') 'attrs': {'checked': checked ?? false},
        'content': it is List ? it : [p(it as String)],
      },
  ],
};
Map<String, Object?> doc(List<Object?> content) => {'type': 'doc', 'content': content};

/// A controller over [d] that edits it the way the board editor does (text → setText, structure → change).
RichTextEditingController ctl(RichEditDoc d) => RichTextEditingController(
  d,
  fonts: const BoardFonts(),
  onChanged: (t, caret) => d.setText(t, caret: caret),
  onFormat: (change) => change(d),
);

/// Types [s] at the caret (one change per character, like a keyboard).
void type(RichTextEditingController c, String s) {
  if (!c.selection.isValid) c.selection = TextSelection.collapsed(offset: c.text.length);
  for (final ch in s.split('')) {
    final v = c.value;
    final at = v.selection.extentOffset;
    final t = v.text.replaceRange(at, at, ch);
    c.value = TextEditingValue(
      text: t,
      selection: TextSelection.collapsed(offset: at + 1),
    );
  }
}

/// Backspace at the caret.
void backspace(RichTextEditingController c) {
  final v = c.value;
  final at = v.selection.extentOffset;
  c.value = TextEditingValue(
    text: v.text.replaceRange(at - 1, at, ''),
    selection: TextSelection.collapsed(offset: at - 1),
  );
}

String plainSpan(Map<String, Object?> json) =>
    richTextSpan(RichDoc.fromJson(json)!, base: const TextStyle(fontSize: 20), fonts: const BoardFonts()).toPlainText();

void main() {
  final box = String.fromCharCode(Icons.check_box_outline_blank.codePoint);
  final checked = String.fromCharCode(Icons.check_box.codePoint);

  group('Editor zeigt Listen-Zeichen wie das Board (F04)', () {
    final docs = {
      'Absätze': doc([p('Eins'), p('Zwei')]),
      'Aufzählung': doc([
        list('bulletList', ['A', 'B']),
      ]),
      'Nummern ab 3': doc([
        {
          ...list('orderedList', ['A', 'B']),
          'attrs': {'start': 3},
        },
      ]),
      'Checkliste': doc([
        list('taskList', ['offen']),
        list('taskList', ['fertig'], checked: true),
      ]),
      'verschachtelt': doc([
        list('bulletList', [
          [
            p('oben'),
            list('bulletList', ['unten']),
          ],
          'B',
        ]),
      ]),
      'Zitat + Code + Überschrift': doc([
        {
          'type': 'blockquote',
          'content': [p('zitiert')],
        },
        {
          'type': 'codeBlock',
          'content': [
            {'type': 'text', 'text': 'x = 1'},
          ],
        },
        {
          'type': 'heading',
          'attrs': {'level': 2},
          'content': [
            {'type': 'text', 'text': 'Titel'},
          ],
        },
      ]),
      'zweiter Absatz im Eintrag + Trennlinie': doc([
        list('bulletList', [
          [p('erste'), p('zweite')],
        ]),
        {'type': 'horizontalRule'},
        p('danach'),
      ]),
    };
    for (final e in docs.entries) {
      test('${e.key}: Text im Feld = Text auf dem Board', () {
        final c = ctl(RichEditDoc(e.value));
        expect(c.text, plainSpan(e.value));
      });
    }

    test('Zeichen: „• “, „3. “, Kästchen (offen/abgehakt), Einrückung', () {
      expect(ctl(RichEditDoc(docs['Aufzählung']!)).text, '• A\n• B');
      expect(ctl(RichEditDoc(docs['Nummern ab 3']!)).text, '3. A\n4. B');
      expect(ctl(RichEditDoc(docs['Checkliste']!)).text, '$box offen\n$checked fertig');
      expect(ctl(RichEditDoc(docs['verschachtelt']!)).text, '• oben\n • unten\n• B', reason: 'Geviert-Leerzeichen');
    });

    test('Schreibmarke nie im Zeichen; Auswahl in Dokument-Offsets', () {
      final d = RichEditDoc(docs['Aufzählung']!);
      final c = ctl(d);
      c.value = c.value.copyWith(selection: const TextSelection.collapsed(offset: 4)); // vor „B“s Punkt
      expect(c.selection.baseOffset, 6, reason: 'nach „• “ der zweiten Zeile');
      expect(c.docSelection, (start: 2, end: 2));
      expect(c.toDisplay(3), 7);
      expect(c.toDoc(1), 0);
    });

    test('Tippen in einem Eintrag, Enter = neuer Eintrag mit Punkt, Enter im leeren Eintrag beendet die Liste', () {
      final d = RichEditDoc(
        doc([
          list('bulletList', ['A']),
        ]),
      );
      final c = ctl(d);
      c.value = c.value.copyWith(selection: TextSelection.collapsed(offset: c.text.length));
      type(c, 'b');
      expect(d.text, 'Ab');
      type(c, '\n');
      expect(c.text, '• Ab\n• ');
      expect(c.selection.baseOffset, c.text.length);
      type(c, 'C');
      expect(d.toJson()['content'], [
        list('bulletList', ['Ab', 'C']),
      ]);
      type(c, '\n');
      type(c, '\n');
      expect(c.text, '• Ab\n• C\n', reason: 'zweites Enter: leerer Eintrag wird Absatz');
      expect((d.toJson()['content'] as List).last, {'type': 'paragraph'});
    });

    test('Rücktaste am Anfang eines Eintrags hebt ihn heraus (verschachtelt: eine Ebene), sonst verbindet sie', () {
      final d = RichEditDoc(
        doc([
          list('bulletList', ['A', 'B']),
        ]),
      );
      final c = ctl(d);
      c.value = c.value.copyWith(selection: const TextSelection.collapsed(offset: 6));
      backspace(c);
      expect(c.text, '• A\nB');
      expect(d.toJson()['content'], [
        list('bulletList', ['A']),
        p('B'),
      ]);
      backspace(c);
      expect(c.text, '• AB', reason: 'Absatz: Rücktaste verbindet mit dem Eintrag davor');
      final n = RichEditDoc(
        doc([
          list('bulletList', [
            [
              p('oben'),
              list('bulletList', ['unten']),
            ],
          ]),
        ]),
      );
      final c2 = ctl(n);
      c2.value = c2.value.copyWith(selection: const TextSelection.collapsed(offset: 10));
      backspace(c2);
      expect(c2.text, '• oben\n• unten');
    });

    test('Trennlinie: sichtbar, Rücktaste danach entfernt sie', () {
      final d = RichEditDoc(
        doc([
          p('vor'),
          {'type': 'horizontalRule'},
          p('nach'),
        ]),
      );
      final c = ctl(d);
      expect(c.text, 'vor\n——————\nnach');
      c.value = c.value.copyWith(selection: const TextSelection.collapsed(offset: 7));
      expect(c.selection.baseOffset, 11, reason: 'nicht auf der Linie');
      backspace(c);
      expect(c.text, 'vor\nnach');
      expect(d.toJson()['content'], [p('vor'), p('nach')]);
    });
  });

  group('Markdown-Kürzel beim Tippen (F11)', () {
    Map<String, Object?> typed(String s) {
      final d = RichEditDoc(doc([]));
      final c = ctl(d);
      type(c, s);
      return d.toJson();
    }

    test('- / * / + und 1. und [ ] / [x] werden Listen, das Kürzel verschwindet', () {
      expect(typed('- Punkt')['content'], [
        list('bulletList', ['Punkt']),
      ]);
      expect(typed('* Punkt')['content'], [
        list('bulletList', ['Punkt']),
      ]);
      expect(typed('1. Eins')['content'], [
        list('orderedList', ['Eins']),
      ]);
      expect(typed('5. Fünf')['content'], [
        {
          ...list('orderedList', ['Fünf']),
          'attrs': {'start': 5},
        },
      ]);
      expect(typed('[ ] offen')['content'], [
        list('taskList', ['offen']),
      ]);
      expect(typed('[x] fertig')['content'], [
        list('taskList', ['fertig'], checked: true),
      ]);
    });

    test('# … ###### Überschrift, > Zitat, ``` Code-Block (auch mit Sprache), --- Trennlinie', () {
      expect(typed('# Titel')['content'], [
        {
          'type': 'heading',
          'attrs': {'level': 1},
          'content': [
            {'type': 'text', 'text': 'Titel'},
          ],
        },
      ]);
      expect((typed('### Klein')['content'] as List).single, containsPair('attrs', {'level': 3}));
      expect(typed('> Zitat')['content'], [
        {
          'type': 'blockquote',
          'content': [p('Zitat')],
        },
      ]);
      expect(typed('``` x')['content'], [
        {
          'type': 'codeBlock',
          'content': [
            {'type': 'text', 'text': 'x'},
          ],
        },
      ]);
      expect((typed('```js\n')['content'] as List).single, {
        'type': 'codeBlock',
        'attrs': {'language': 'js'},
      });
      expect(typed('---')['content'], [
        {'type': 'horizontalRule'},
        {'type': 'paragraph'},
      ]);
    });

    test(r'Einfügen aus Windows-Programmen: \r\n wird \n (F16)', () {
      final d = RichEditDoc(doc([]));
      final c = ctl(d);
      c.value = const TextEditingValue(text: 'a\r\nb', selection: TextSelection.collapsed(offset: 4));
      expect(d.text, 'a\nb');
      expect(c.text, 'a\nb');
      expect(c.selection.baseOffset, 3);
    });

    test('mitten im Text, in Listen und in Code-Blöcken: kein Kürzel', () {
      expect(plainOf(typed('a - b')), 'a - b');
      final d = RichEditDoc(
        doc([
          list('bulletList', ['']),
        ]),
      );
      final c = ctl(d);
      type(c, '- x');
      expect(d.toJson()['content'], [
        list('bulletList', ['- x']),
      ]);
    });
  });

  group('Absatz-Stile, Einrücken (F06, F12)', () {
    test('Zitat ein/aus, Code-Block ein/aus (Marks weg, Umbruch bleibt Text), Überschrift aus Code', () {
      final d = RichEditDoc(
        doc([
          p('fett', [
            {'type': 'bold'},
          ]),
          p('zwei'),
        ]),
      );
      expect(d.setBlockKind(0, 0, 'quote'), isTrue);
      expect(d.blockKind(0, 0), 'quote');
      expect(d.toJson()['content'], [
        {
          'type': 'blockquote',
          'content': [
            p('fett', [
              {'type': 'bold'},
            ]),
          ],
        },
        p('zwei'),
      ]);
      d.setBlockKind(0, 0, 'quote');
      expect(d.blockKind(0, 0), 'p');
      d.setBlockKind(0, 0, 'code');
      expect(d.blockKind(0, 0), 'code');
      expect((d.toJson()['content'] as List).first, {
        'type': 'codeBlock',
        'content': [
          {'type': 'text', 'text': 'fett'},
        ],
      });
      d.setBlockKind(0, 0, 'h2');
      expect(d.blockKind(0, 0), 'h2');
      d.setBlockKind(0, 0, 'h2');
      expect(d.blockKind(0, 0), 'p', reason: 'nochmal = zurück');
      expect(d.text, 'fett\nzwei');
    });

    test('Einrücken in den Eintrag davor (gleiche Liste), Ausrücken zurück; erster Eintrag nicht', () {
      final d = RichEditDoc(
        doc([
          list('bulletList', ['A', 'B', 'C']),
        ]),
      );
      expect(d.indent(0, 0), isFalse);
      expect(d.indent(2, 2), isTrue);
      expect(d.toJson()['content'], [
        list('bulletList', [
          [
            p('A'),
            list('bulletList', ['B']),
          ],
          'C',
        ]),
      ]);
      expect(d.indent(4, 4), isTrue, reason: 'C kommt in dieselbe Unterliste');
      expect(ctl(d).text, '• A\n • B\n • C');
      expect(d.outdent(2, 2), isTrue);
      expect(d.toJson()['content'], [
        list('bulletList', [
          'A',
          [
            p('B'),
            list('bulletList', ['C']),
          ],
        ]),
      ]);
      expect(d.outdent(0, 0), isTrue, reason: 'oberste Ebene wird Absatz');
      expect((d.toJson()['content'] as List).first, p('A'));
      expect(d.text, 'A\nB\nC');
    });
  });

  group('Links und Teil-Größen (F08, F10, F14)', () {
    test('Eingabe wie normalizeHref des Web', () {
      expect(normalizeHref('beispiel.org'), 'https://beispiel.org/');
      expect(normalizeHref('beispiel.org/plan'), 'https://beispiel.org/plan');
      expect(normalizeHref('HTTPS://Beispiel.ORG'), 'https://beispiel.org/');
      expect(normalizeHref('mara@example.org'), 'mailto:mara@example.org');
      expect(normalizeHref('tel:+4930123'), 'tel:+4930123');
      expect(normalizeHref('javascript:alert(1)'), isNull);
      expect(normalizeHref('zwei worte'), isNull);
      expect(safeLink('beispiel.org'), isNull, reason: 'auf dem Board nur volle Adressen');
      expect(shortHref('https://beispiel.org/'), 'beispiel.org');
      expect(shortHref('https://beispiel.org/${'x' * 80}', 20).length, 20);
    });

    test('Link ohne Auswahl fügt verlinkten Text ein; Bereich des Links; Attribute wie Tiptap', () {
      final d = RichEditDoc(doc([p('Siehe ')]));
      expect(d.insertLink(6, 'beispiel.org', 'beispiel.org'), 18);
      expect(d.text, 'Siehe beispiel.org');
      expect(d.linkRangeAt(10), (6, 18));
      expect(d.linkRangeAt(3), isNull);
      expect(d.markAttr(6, 18, 'link', 'href'), 'https://beispiel.org/');
      expect(d.markAttr(6, 18, 'link', 'rel'), 'noopener noreferrer nofollow');
      d.setText('Siehe beispiel.org!', caret: 19);
      expect(d.hasMark(18, 19, 'link'), isFalse, reason: 'Getipptes nach dem Link ist kein Link');
    });

    test('Teil-Größe in em: Darstellung relativ zur Objektgröße (Text wie Web cssSize)', () {
      final m = RichMarks.fromJson([
        {
          'type': 'textStyle',
          'attrs': {'fontSize': '1.5em'},
        },
      ]);
      expect(m.fontScale, 1.5);
      expect(m.fontSize, isNull);
      expect(markedStyle(const TextStyle(fontSize: 20), m, const BoardFonts()).fontSize, 30);
      expect(
        RichMarks.fromJson([
          {
            'type': 'textStyle',
            'attrs': {'fontSize': '12pt'},
          },
        ]).fontSize,
        16,
      );
      final d = RichEditDoc(doc([p('groß klein')]));
      expect(d.hasInlineSize, isFalse);
      d.setMarkAttr(0, 4, 'textStyle', 'fontSize', '2em');
      expect(d.hasInlineSize, isTrue);
    });

    test('Kästchen Nummer n in Dokument-Reihenfolge abhaken (wie toggleTask)', () {
      final d = RichEditDoc(
        doc([
          list('taskList', ['A', 'B']),
        ]),
      );
      expect(d.toggleTaskAt(1), isTrue);
      expect(d.toggleTaskAt(2), isFalse);
      expect(d.toJson()['content'], [
        {
          'type': 'taskList',
          'content': [
            {
              'type': 'taskItem',
              'attrs': {'checked': false},
              'content': [p('A')],
            },
            {
              'type': 'taskItem',
              'attrs': {'checked': true},
              'content': [p('B')],
            },
          ],
        },
      ]);
    });

    test('Treffer-Bereiche = Kästchen-Zeichen und Links im Text des Boards', () {
      final json = doc([
        list('taskList', ['A', 'B']),
        p('mehr', [
          {
            'type': 'link',
            'attrs': {'href': 'https://beispiel.org'},
          },
        ]),
        p('böse', [
          {
            'type': 'link',
            'attrs': {'href': 'javascript:alert(1)'},
          },
        ]),
      ]);
      final rich = RichDoc.fromJson(json)!;
      final plain = plainSpan(json);
      final t = richTargetsOf(rich);
      expect(t.length, 3, reason: 'zwei Kästchen, ein sicherer Link');
      expect(plain.substring(t[0].start, t[0].end), box);
      expect(t[0].task, 0);
      expect(t[1].task, 1);
      expect(plain.substring(t[2].start, t[2].end), 'mehr');
      expect(t[2].href, 'https://beispiel.org/');
    });
  });
}

String plainOf(Map<String, Object?> json) => pmPlainText(json);
