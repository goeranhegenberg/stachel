// F16: HTML beim Schreiben einfügen wie der Rich-Text-Editor des Web. Referenz: der echte Web-Editor (Tiptap mit
// `richExtensions()`, `pasteHTML`) im Chromium (stachel/tools/native-paste-fixtures.mts →
// docs/native_fixtures/web/paste.json, hierher kopiert): Word-Listen, Word-Markierung, Google Docs, Browser-HTML,
// Größen in em (nur Text/Form), h5 → h3, unsichere Links/Skripte weg – in leere Notiz, mitten in Text, über eine
// Auswahl, in eine Liste, in eine Überschrift.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/richtext/paste_html.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  final cases = ((jsonDecode(File('../../../docs/native_fixtures/web/paste.json').readAsStringSync()) as Map)['cases'] as List)
      .cast<Map<String, Object?>>();

  test('Referenzfälle vorhanden', () => expect(cases.length, greaterThan(80)));

  for (final c in cases) {
    test('${c['start']} + ${c['htmlId']} (${c['variant']})', () {
      final doc = RichEditDoc(c['doc']! as Map<String, Object?>);
      final sel = (c['sel']! as List).cast<num>();
      final caret = pasteHtmlInto(
        doc,
        sel[0].toInt(),
        sel[1].toInt(),
        c['html']! as String,
        sizes: c['variant'] == 'text' || c['variant'] == 'shape',
      );
      expect(canonicalJson(doc.toJson()), canonicalJson(c['result']), reason: c['html'] as String);
      expect(caret, c['caret']);
    });
  }

  test('Farben wie der Canvas (fillStyle)', () {
    expect(normColor('rgb(236, 78, 146)'), '#ec4e92');
    expect(normColor('Red'), '#ff0000');
    expect(normColor('#abc'), '#aabbcc');
    expect(normColor('hsl(120, 100%, 25%)'), '#008000');
    expect(normColor('rgba(0, 0, 0, 0)'), isNull);
    expect(normColor('rgba(255, 0, 0, 0.5)'), 'rgba(255, 0, 0, 0.5)');
    expect(normColor('transparent'), isNull);
    expect(normColor('quatsch'), isNull);
  });
}
