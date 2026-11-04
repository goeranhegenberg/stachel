// F19: automatische Schriftgröße von Haftnotiz und Form wie im Web. Die Referenzwerte rechnet der echte Web-Code
// (`stickyFontSize`/`shapeFontSize`) im Chromium mit Canvas-Messung (stachel/tools/native-textfit-fixtures.mts →
// docs/native_fixtures/web/textfit.json, hierher kopiert); die App rechnet mit den Chromium-Schriftmaßen.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/render/text_fit.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  final cases = ((jsonDecode(File('../../../docs/native_fixtures/web/textfit.json').readAsStringSync()) as Map)['cases'] as List)
      .cast<Map<String, Object?>>();

  test('Referenzwerte vorhanden (Haftnotizen und Formen, mit fett/kursiv)', () {
    expect(cases.where((c) => c['kind'] == 'sticky').length, greaterThan(300));
    expect(cases.where((c) => c['kind'] == 'shape').length, greaterThan(100));
  });

  test('Haftnotiz: gleiche Auto-Schriftgröße wie der Browser', () {
    final off = <String>[];
    for (final c in cases.where((c) => c['kind'] == 'sticky')) {
      final fs = stickyAutoFontSize(
        c['text']! as String,
        (c['w']! as num).toDouble(),
        (c['h']! as num).toDouble(),
        bold: c['bold'] == true,
        italic: c['italic'] == true,
      );
      if (fs != (c['fs']! as num).toDouble()) off.add('${jsonEncode(c)} → $fs');
    }
    expect(off, isEmpty);
  });

  test('Form: gleiche Schriftgröße wie der Browser', () {
    final off = <String>[];
    for (final c in cases.where((c) => c['kind'] == 'shape')) {
      final fs = shapeAutoFontSize(
        c['text']! as String,
        (c['wanted']! as num).toDouble(),
        (c['innerW']! as num).toDouble(),
        (c['innerH']! as num).toDouble(),
        bold: c['bold'] == true,
        italic: c['italic'] == true,
      );
      if (fs != (c['fs']! as num).toDouble()) off.add('${jsonEncode(c)} → $fs');
    }
    expect(off, isEmpty);
  });

  test(
    'Rich-Text misst wie das Web im Layout (needsDomFit): Listen, Überschriften, fett/kursiv/code, andere Schrift',
    () {
      Map<String, Object?> doc(List<Object?> content) => {'type': 'doc', 'content': content};
      Map<String, Object?> p(List<Object?> c) => {'type': 'paragraph', 'content': c};
      BoardObject o(Map<String, Object?> d, {String? font}) =>
          BoardObject({'id': 'n', 'type': 'sticky', 'text': 'x', 'content': d, 'fontFamily': ?font});
      final plain = doc([
        p([
          {'type': 'text', 'text': 'x'},
        ]),
      ]);
      expect(needsLayoutFit(o(plain)), isFalse);
      expect(needsLayoutFit(o(plain, font: 'serif')), isTrue);
      expect(
        needsLayoutFit(
          o(
            doc([
              p([
                {
                  'type': 'text',
                  'text': 'x',
                  'marks': [
                    {'type': 'bold'},
                  ],
                },
              ]),
            ]),
          ),
        ),
        isTrue,
      );
      expect(
        needsLayoutFit(
          o(
            doc([
              {
                'type': 'heading',
                'attrs': {'level': 1},
                'content': [
                  {'type': 'text', 'text': 'x'},
                ],
              },
            ]),
          ),
        ),
        isTrue,
      );
      // underline/highlight/color measure like plain Barlow
      expect(
        needsLayoutFit(
          o(
            doc([
              p([
                {
                  'type': 'text',
                  'text': 'x',
                  'marks': [
                    {'type': 'underline'},
                    {
                      'type': 'textStyle',
                      'attrs': {'color': '#ff0000', 'fontSize': ''},
                    },
                  ],
                },
              ]),
            ]),
          ),
        ),
        isFalse,
      );
    },
  );

  test('Umbruch wie im Browser: nach Bindestrichen, überlange Wörter hart', () {
    double mono(String t, double fs) => t.length * fs * 0.5;
    expect(wrapTextLines('Beispiel-Festival', 10, 50, mono), ['Beispiel-', 'Festival']);
    expect(wrapTextLines('abcdefghijkl', 10, 30, mono), ['abcdef', 'ghijkl']);
    expect(wrapTextLines('a\n\nb', 10, 30, mono), ['a', '', 'b']);
    expect(webFitFontSize('', 100, 100, mono, min: 5, max: 20), 15);
  });
}
