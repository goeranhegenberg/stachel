// Reference values computed by the web code itself (concept §6.2): `stachel/tools/native-web-fixtures.mts` runs the
// real web functions and writes docs/native_fixtures/web/*.json. The Dart ports must give the same results:
// - shapes.json: SVG path text of every registered shape kind (5 sizes × 3 insets, same number format) and text insets,
// - connectors.json: connector geometry (straight/elbow/curved, sides, rotated objects, outlines, free ends),
// - order.json: paint order with frames, broken and equal `z` keys.
// A web shape kind the app does not know fails here (parity guard).
// Refresh: in the stachel repo `server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-fixtures.mts`,
// then copy docs/native_fixtures/web/*.json here.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Map<String, Object?> _fixture(String name) =>
    (jsonDecode(File('../../../docs/native_fixtures/web/$name').readAsStringSync()) as Map).cast<String, Object?>();

Offset _pt(Object? j) {
  final m = j! as Map;
  return Offset((m['x'] as num).toDouble(), (m['y'] as num).toDouble());
}

Matcher _near(Offset expected, [double eps = 1e-6]) => predicate<Offset>(
  (o) => (o.dx - expected.dx).abs() <= eps && (o.dy - expected.dy).abs() <= eps,
  'nahe $expected',
);

void main() {
  group('Formen wie im Web', () {
    final f = _fixture('shapes.json');
    final kinds = (f['kinds']! as List).cast<String>();
    final cases = (f['cases']! as List).cast<Map<String, Object?>>();

    test('jede Form des Webs kennt die App (${kinds.length} Formen)', () {
      expect(kinds.length, greaterThanOrEqualTo(41));
      expect([for (final k in kinds) if (!isKnownShapeKind(k)) k], isEmpty);
    });

    test('SVG-Pfad gleich (Text, inkl. Zahlenformat) für ${cases.length} Fälle', () {
      final wrong = <String>[];
      for (final c in cases) {
        final kind = c['kind']! as String;
        final w = (c['w']! as num).toDouble(), h = (c['h']! as num).toDouble(), inset = (c['inset']! as num).toDouble();
        final mine = shapePathData(kind, w, h, inset);
        if (mine != c['path']) wrong.add('$kind ${w}x$h/$inset\n  web:  ${c['path']}\n  app:  $mine');
      }
      expect(wrong, isEmpty, reason: wrong.take(5).join('\n'));
    });

    test('Textfläche (shapeInsets) gleich', () {
      final wrong = <String>[];
      for (final c in cases) {
        final kind = c['kind']! as String;
        final w = (c['w']! as num).toDouble(), h = (c['h']! as num).toDouble();
        final web = [for (final v in c['insets']! as List) (v as num).toDouble()];
        final (t, r, b, l) = shapeInsets(kind, w, h);
        final mine = [t, r, b, l];
        for (var i = 0; i < 4; i++) {
          if ((mine[i] - web[i]).abs() > 1e-9) {
            wrong.add('$kind ${w}x$h: web $web, app $mine');
            break;
          }
        }
      }
      expect(wrong, isEmpty, reason: wrong.take(5).join('\n'));
    });
  });

  group('Verbinder wie im Web', () {
    final f = _fixture('connectors.json');
    final objects = {
      for (final o in (f['objects']! as List).cast<Map<String, Object?>>()) o['id']! as String: BoardObject.fromJson(o)!,
    };
    final cases = (f['cases']! as List).cast<Map<String, Object?>>();

    test('Geometrie (Enden, Knicke/Kontrollpunkte, Mitte, Richtungen) für ${cases.length} Fälle', () {
      var checked = 0;
      for (final (i, c) in cases.indexed) {
        final conn = BoardObject.fromJson({
          'id': 'c$i',
          'type': 'connector',
          'from': c['from'],
          'to': c['to'],
          'lineStyle': c['lineStyle'],
        })!;
        final g = connectorGeometry(conn, (id) => objects[id]);
        final web = c['geometry'] as Map?;
        final what = '${c['lineStyle']} ${jsonEncode(c['from'])} → ${jsonEncode(c['to'])}';
        if (web == null) {
          expect(g, isNull, reason: what);
          continue;
        }
        expect(g, isNotNull, reason: what);
        expect(g!.style, web['style'], reason: what);
        expect(g.a, _near(_pt(web['a'])), reason: '$what: a');
        expect(g.b, _near(_pt(web['b'])), reason: '$what: b');
        final pts = (web['pts']! as List).map(_pt).toList();
        expect(g.pts.length, pts.length, reason: '$what: Punkte ${g.pts} statt $pts');
        for (var k = 0; k < pts.length; k++) {
          expect(g.pts[k], _near(pts[k]), reason: '$what: Punkt $k');
        }
        expect(g.mid, _near(_pt(web['mid']), 1e-4), reason: '$what: Mitte');
        expect(g.dirA, _near(_pt(web['dirA']), 1e-6), reason: '$what: dirA');
        expect(g.dirB, _near(_pt(web['dirB']), 1e-6), reason: '$what: dirB');
        checked++;
      }
      expect(checked, greaterThan(300));
    });
  });

  test('Zeichenreihenfolge wie im Web (Rahmen zuerst, z byteweise, dann id)', () {
    final f = _fixture('order.json');
    final state = BoardState()
      ..applySnapshot(BoardSnapshot.fromJson({'objects': f['objects']}), rev: 1, epoch: 'e');
    expect(state.ordered.map((o) => o.id), f['expected']);
  });
}
