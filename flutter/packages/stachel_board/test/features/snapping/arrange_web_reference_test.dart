// Reference values of the web code (P1, audit D13–D16, D32–D36): `stachel/tools/native-arrange-fixtures.mts` runs the
// real web functions (snapping.ts, lasso.ts, grid.ts, geometry.ts, resize.ts, rotate.ts, pen.ts) and writes
// docs/native_fixtures/web/arrange.json. The Dart ports must give the same results.
// Refresh: in the stachel repo `server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-arrange-fixtures.mts`,
// then copy docs/native_fixtures/web/arrange.json here.
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

final Map<String, Object?> _f = (jsonDecode(File('../../../docs/native_fixtures/web/arrange.json').readAsStringSync()) as Map)
    .cast<String, Object?>();

List<Map<String, Object?>> _cases(String k) =>
    (_f[k] as List).cast<Map>().map((m) => m.cast<String, Object?>()).toList();

double _d(Object? v) => (v as num).toDouble();

/// JSON with all numbers as doubles (JS integers vs. Dart doubles).
Object? _num(Object? v) => switch (v) {
  num n => n.toDouble(),
  Map m => {for (final e in m.entries) e.key: _num(e.value)},
  List l => [for (final x in l) _num(x)],
  _ => v,
};

Rect _rect(Object? j) {
  final m = j! as Map;
  return Rect.fromLTWH(_d(m['x']), _d(m['y']), _d(m['w']), _d(m['h']));
}

Offset _pt(Object? j) {
  final m = j! as Map;
  return Offset(_d(m['x']), _d(m['y']));
}

Map<String, double> _rectJson(Rect r) => {'x': r.left, 'y': r.top, 'w': r.width, 'h': r.height};

Matcher _close(Map<String, Object?> expected, [double eps = 1e-6]) => predicate<Map<String, double>>((m) {
  for (final e in expected.entries) {
    if ((m[e.key]! - _d(e.value)).abs() > eps) return false;
  }
  return true;
}, 'nahe $expected');

List<Map<String, double>> _lines(List<GuideLine> l) => [for (final x in l) x.toJson()];

List<Map<String, double>> _jsonLines(Object? j) => [
  for (final m in (j! as List).cast<Map>()) {for (final e in m.entries) e.key as String: _d(e.value)},
];

void main() {
  test('Einrasten beim Verschieben: Kanten, Mitten, gleiche Abstände, Hilfslinien, Abstandsmarken (snapMove)', () {
    final cases = _cases('snapMove');
    var snapped = 0, gaps = 0;
    for (final c in cases) {
      final others = [for (final r in c['others']! as List) _rect(r)];
      final res = snapMove(_rect(c['box']), others, _d(c['tol']));
      final e = c['result']! as Map;
      expect(res.dx, closeTo(_d(e['dx']), 1e-9), reason: jsonEncode(c));
      expect(res.dy, closeTo(_d(e['dy']), 1e-9), reason: jsonEncode(c));
      expect(_lines(res.lines), _jsonLines(e['lines']), reason: jsonEncode(c));
      expect(_lines(res.gaps), _jsonLines(e['gaps']), reason: jsonEncode(c));
      if (res.dx != 0 || res.dy != 0) snapped++;
      gaps += res.gaps.length;
    }
    // the cases really exercise snapping and gap marks
    expect(snapped, greaterThan(cases.length ~/ 2));
    expect(gaps, greaterThan(0));
  });

  test('Einrasten beim Größe-Ändern nur an gezogenen Kanten (snapResize) und Hilfslinien (guideLines)', () {
    for (final c in _cases('snapResize')) {
      final others = [for (final r in c['others']! as List) _rect(r)];
      final nb = _rect(c['nb']);
      final res = snapResize(nb, c['handle']! as String, others, _d(c['tol']));
      final e = c['result']! as Map;
      expect((res.dx, res.dy), (_d(e['dx']), _d(e['dy'])), reason: jsonEncode(c));
      expect(_lines(guideLines(nb, others)), _jsonLines(c['lines']), reason: jsonEncode(c));
    }
  });

  test('Lasso: nur ganz Umschlossenes (rectInLasso, lassoBounds)', () {
    var inside = 0;
    for (final c in _cases('lasso')) {
      final poly = [for (final p in c['poly']! as List) _pt(p)];
      expect(rectInLasso(_rect(c['rect']), poly), c['inside'], reason: jsonEncode(c));
      expect(_rectJson(lassoBounds(poly)), _close((c['bounds']! as Map).cast<String, Object?>()));
      if (c['inside'] == true) inside++;
    }
    expect(inside, greaterThan(0));
  });

  test('Größe ändern: resizeRect, rotatedResize (gedreht, Gegenecke bleibt), mapRect', () {
    for (final c in _cases('resizeRect')) {
      final r = resizeRect(
        _rect(c['start']),
        c['handle']! as String,
        _d(c['dx']),
        _d(c['dy']),
        keepAspect: c['keep'] == true,
        min: _d(c['min']),
      );
      expect(_rectJson(r), _close((c['result']! as Map).cast<String, Object?>()), reason: jsonEncode(c));
    }
    for (final c in _cases('rotatedResize')) {
      final r = rotatedResize(
        _rect(c['box']),
        c['handle']! as String,
        _d(c['dx']),
        _d(c['dy']),
        _d(c['rot']),
        c['keep'] == true,
        widthOnly: c['widthOnly'] == true,
      );
      expect(_rectJson(r), _close((c['result']! as Map).cast<String, Object?>(), 1e-6), reason: jsonEncode(c));
    }
    for (final c in _cases('mapRect')) {
      final r = mapRect(_rect(c['r']), _rect(c['from']), _rect(c['to']));
      expect(_rectJson(r), _close((c['result']! as Map).cast<String, Object?>()), reason: jsonEncode(c));
    }
  });

  test('Drehen: Einrasten bei 0/90/180/270 ± 5°, Winkel-Etikett ohne „-0°“, Feld rotation', () {
    for (final c in _cases('angles')) {
      final a = _d(c['a']);
      final s = snapAngle(a);
      final e = c['snap']! as Map;
      expect(s.deg, closeTo(_d(e['deg']), 1e-9), reason: 'snapAngle($a)');
      expect(s.snapped, e['snapped'], reason: 'snapAngle($a)');
      expect(angleLabel(a), c['label'], reason: 'angleLabel($a)');
      expect(
        rotationField(a),
        c['field'] == null ? isNull : closeTo(_d(c['field']), 1e-9),
        reason: 'rotationField($a)',
      );
    }
  });

  test('Mehrere drehen um die gemeinsame Mitte: Objekte, Stift-Punkte, freie Verbinder-Enden (rotateMany)', () {
    final f = _f['rotateMany']! as Map;
    final objs = {
      for (final o in (f['objects']! as List).cast<Map>()) o['id'] as String: BoardObject(o.cast<String, Object?>()),
    };
    for (final c in (f['cases']! as List).cast<Map>()) {
      final got = rotateMany(objs, _pt(c['c']), _d(c['delta']));
      final want = (c['result']! as Map).cast<String, Object?>();
      expect(got.keys.toSet(), want.keys.toSet());
      for (final id in want.keys) {
        final w = (want[id]! as Map).cast<String, Object?>();
        final g = got[id]!;
        for (final k in w.keys) {
          final wv = w[k];
          final gv = g[k];
          if (wv is num) {
            // pen boxes: the app keeps 0.1 precision (penFromPoints, E3)
            expect(
              _d(gv),
              closeTo(wv.toDouble(), objs[id]!.type == 'pen' ? 0.051 : 1e-9),
              reason: '$id.$k bei ${c['delta']}',
            );
          } else if (wv is List) {
            expect(
              [for (final v in gv! as List) _d(v)],
              [for (final v in wv) _d(v)],
              reason: '$id.$k bei ${c['delta']}',
            );
          } else {
            expect(_num(gv), _num(wv), reason: '$id.$k bei ${c['delta']}');
          }
        }
      }
    }
  });

  test('Raster 24 (snapToGrid) und Stift-Punkte skalieren (scalePoints)', () {
    expect(snapGrid, _d(_f['grid']));
    for (final c in _cases('snapToGrid')) {
      expect(snapToGrid(_d(c['v'])), _d(c['result']), reason: 'snapToGrid(${c['v']})');
    }
    for (final c in _cases('scalePoints')) {
      final pts = [for (final v in c['points']! as List) _d(v)];
      expect(scalePoints(pts, _d(c['sx']), _d(c['sy'])), [for (final v in c['result']! as List) _d(v)]);
    }
  });
}
