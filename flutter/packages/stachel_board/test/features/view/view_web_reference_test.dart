// Reference values of the web code for the view (parity audit P4): `stachel/tools/native-view-fixtures.mts` runs the
// web's search, frame list, frame formats, zoom steps and fitRect and writes docs/native_fixtures/web/view.json; the Dart
// ports must give the same results. Refresh: generator in the stachel repo, then `dart run tool/gen_view_fixtures.dart`.
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/editor/camera.dart';
import 'package:stachel_board/src/features/frames/frames_model.dart';
import 'package:stachel_board/src/features/search/search_model.dart';
import 'package:stachel_board/src/features/view/board_background.dart';
import 'package:stachel_board/src/features/view/view_camera.dart';
import 'package:stachel_board/src/model/board_object.dart';
import 'package:stachel_board/src/render/board_scene.dart';

final _view = (jsonDecode(File('../../../docs/native_fixtures/web/view.json').readAsStringSync()) as Map).cast<String, Object?>();

Rect _rect(Object? j) {
  final m = j! as Map;
  return Rect.fromLTWH(
    (m['x'] as num).toDouble(),
    (m['y'] as num).toDouble(),
    (m['w'] as num).toDouble(),
    (m['h'] as num).toDouble(),
  );
}

Offset _pt(Object? j) {
  final m = j! as Map;
  return Offset((m['x'] as num).toDouble(), (m['y'] as num).toDouble());
}

List<BoardObject> _objects(Object? list) => [
  for (final o in list! as List) BoardObject((o as Map).cast<String, Object?>()),
];

void main() {
  group('Suche wie im Web', () {
    test('Faltung je Zeichen = Web-Faltung (Tabelle aktuell)', () {
      final fold0 = (_view['fold']! as Map).cast<String, String>();
      for (final e in fold0.entries) {
        expect(fold(e.key).text, e.value, reason: 'U+${e.key.codeUnitAt(0).toRadixString(16)}');
      }
    });

    test('findMatch: Umlaute, ae/oe/ue, ß, Akzente, Leerzeichen, Emoji, Hangul, Deseret', () {
      for (final c in (_view['find']! as List).cast<Map>()) {
        final m = c['match'] as List?;
        final got = findMatch(c['text'] as String, c['query'] as String);
        expect(got == null ? null : [got.$1, got.$2], m, reason: '${c['text']} / ${c['query']}');
      }
    });

    test(
      'Suchtext je Objekttyp (Klartext, Rahmentitel, Tags, zuständige Person, Tabelle, Zeitleiste, Sticker, PDF)',
      () {
        final st = (_view['searchText']! as Map).cast<String, Object?>();
        final objs = {for (final o in _objects(st['objects'])) o.id: o};
        for (final t in (st['texts']! as List).cast<Map>()) {
          expect(searchText(objs[t['id']]!), t['text'], reason: t['id'] as String);
        }
      },
    );

    test('Treffer in Lesereihenfolge, Ausgeblendete nur mit „zeigen“', () {
      final st = (_view['searchText']! as Map).cast<String, Object?>();
      final objs = _objects(st['objects']);
      for (final c in (st['hits']! as List).cast<Map>()) {
        final hits = findHits(
          objs,
          c['query'] as String,
          (o) => o.type == 'connector' ? null : objectRect(o),
          includeHidden: c['includeHidden'] as bool,
        );
        expect([for (final h in hits) h.object.id], c['ids'], reason: '${c['query']} ${c['includeHidden']}');
      }
    });

    test('Lesereihenfolge beliebiger Rechtecke', () {
      for (final c in (_view['readingOrder']! as List).cast<Map>()) {
        final items = [for (final it in c['items'] as List) ((it as Map)['id'] as String, _rect(it['r']))];
        expect([for (final it in readingOrder(items, (it) => it.$2)) it.$1], c['order']);
      }
    });
  });

  group('Rahmen wie im Web', () {
    test('Rahmen-Liste: slide zuerst (gleiche Schlüssel in Lesereihenfolge), dann Lesereihenfolge', () {
      final frames = (_view['frames']! as Map).cast<String, Object?>();
      for (final c in (frames['order']! as List).cast<Map>()) {
        expect([for (final f in framesInOrderWeb(_objects(c['frames']))) f.id], c['order']);
      }
    });

    test('Formate beim Aufziehen (Seitenverhältnis, Quadrat bei „Frei“)', () {
      final frames = (_view['frames']! as Map).cast<String, Object?>();
      for (final c in (frames['presets']! as List).cast<Map>()) {
        final r = presetRect(
          _pt(c['start']),
          _pt(c['end']),
          framePreset(c['preset'] as String),
          square: c['square'] as bool,
        );
        final e = _rect(c['rect']);
        expect(
          [r.left, r.top, r.width, r.height],
          [
            for (final v in [e.left, e.top, e.width, e.height]) closeTo(v, 1e-9),
          ],
          reason: '${c['preset']} ${c['start']} ${c['end']} ${c['square']}',
        );
      }
    });

    test('Formate aus den Web-Konstanten', () {
      expect([for (final p in framePresets) p.label], ['Frei', '16:9', '4:3', 'A4', 'A4 quer', 'Handy', 'Quadrat']);
      expect(frameGridSizes, [50, 100, 140, 200]);
    });
  });

  group('Zoom wie im Web', () {
    test('Zoom-Stufen − / +', () {
      final zoom = (_view['zoom']! as Map).cast<String, Object?>();
      for (final c in (zoom['steps']! as List).cast<Map>()) {
        final z = (c['z'] as num).toDouble();
        expect(nextZoomStep(z, 1), c['up'], reason: '+ $z');
        expect(nextZoomStep(z, -1), c['down'], reason: '− $z');
      }
    });

    test('Einpassen = fitRect', () {
      final zoom = (_view['zoom']! as Map).cast<String, Object?>();
      for (final c in (zoom['fit']! as List).cast<Map>()) {
        final p = c['pad'] as Map;
        double n(Object? v) => (v as num).toDouble();
        final cam = Camera.fit(
          _rect(c['r']),
          Size(n(c['w']), n(c['h'])),
          padding: FitPadding.fromLTRB(n(p['left']), n(p['top']), n(p['right']), n(p['bottom'])),
          maxZoomFit: n(c['max']),
        );
        final e = c['cam'] as Map;
        expect([cam.x, cam.y, cam.z], [closeTo(n(e['x']), 1e-9), closeTo(n(e['y']), 1e-9), closeTo(n(e['z']), 1e-12)]);
      }
    });
  });

  group('Hintergrund wie im Web', () {
    test('Farben, Namen, Muster, dunkel', () {
      final s = (_view['settings']! as Map).cast<String, Object?>();
      expect(boardBgColors, s['colors']);
      expect(boardBgNames, s['names']);
      expect([for (final p in boardPatterns) p], s['patterns']);
      expect(boardPatternLabels, s['patternLabels']);
      for (final c in (s['dark']! as List).cast<Map>()) {
        expect(isDarkColor(c['color'] as String), c['dark'], reason: c['color'] as String);
      }
    });
  });
}
