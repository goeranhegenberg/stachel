// Geometry ported from the web: SVG path parser, all 41 shape paths (strings like the web), insets, connector
// routes (straight/elbow/curved, docking, rotation) and caps, spatial grid.
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

BoardObject box(
  String id,
  double x,
  double y,
  double w,
  double h, {
  String type = 'shape',
  String? shape,
  double? rotation,
}) => BoardObject.fromJson({
  'id': id,
  'type': type,
  'x': x,
  'y': y,
  'w': w,
  'h': h,
  'shape': ?shape,
  'rotation': ?rotation,
})!;

BoardObject connector(Map<String, Object?> from, Map<String, Object?> to, {String? style}) =>
    BoardObject.fromJson({'id': 'c', 'type': 'connector', 'from': from, 'to': to, 'lineStyle': ?style})!;

Matcher near(Offset o, [double tol = 0.01]) =>
    predicate<Offset>((p) => (p - o).distance <= tol, 'near (${o.dx.toStringAsFixed(2)}, ${o.dy.toStringAsFixed(2)})');

void main() {
  group('SVG-Pfad-Parser', () {
    test('absolute und relative Befehle, implizite Linien nach M', () {
      final p = parseSvgPath('M10 10 20 10 20 20Z m5 5 h10 v10 h-10 z');
      expect(p.getBounds(), const Rect.fromLTRB(10, 10, 25, 25));
      expect(p.contains(const Offset(19, 11)), isTrue);
      expect(p.contains(const Offset(11, 19)), isFalse);
    });

    test('Bögen (auch relativ, Flags ohne Trenner) und Kurven', () {
      final ellipse = parseSvgPath('M0 50a50 50 0 1 0 100 0a50 50 0 1 0 -100 0Z');
      final b = ellipse.getBounds();
      expect(b.left, closeTo(0, 0.5));
      expect(b.right, closeTo(100, 0.5));
      expect(b.top, closeTo(0, 0.5));
      expect(b.bottom, closeTo(100, 0.5));
      expect(ellipse.contains(const Offset(50, 50)), isTrue);
      expect(ellipse.contains(const Offset(3, 3)), isFalse);
      final compact = parseSvgPath('M0 0a5 5 0 105 5');
      expect(compact.getBounds().isEmpty, isFalse);
      final curves = parseSvgPath('M0 0C10 0 10 10 0 10S-10 20 0 20Q10 30 0 40T0 60');
      expect(curves.getBounds().bottom, closeTo(60, 0.01));
    });

    test('kaputte Daten beenden den Pfad statt zu werfen', () {
      expect(() => parseSvgPath('M0 0L10'), returnsNormally);
      expect(() => parseSvgPath('X1 2'), returnsNormally);
      expect(() => parseSvgPath(''), returnsNormally);
      expect(parseSvgPath('M0 0L10 0L10').getBounds(), const Rect.fromLTRB(0, 0, 10, 0));
    });
  });

  group('Formen', () {
    test('41 Formen, jede ergibt einen Pfad innerhalb ihres Rechtecks', () {
      expect(shapeKinds.length, 41);
      expect(shapeKinds.toSet().length, 41);
      for (final kind in shapeKinds) {
        expect(isKnownShapeKind(kind), isTrue, reason: kind);
        final path = parseSvgPath(shapePathData(kind, 180, 120, 1));
        final b = path.getBounds();
        expect(b.isEmpty, isFalse, reason: kind);
        // control points of curves may stick out a bit, the shape itself stays inside
        expect(b.left, greaterThanOrEqualTo(-8), reason: kind);
        expect(b.right, lessThanOrEqualTo(188), reason: kind);
        expect(
          path.contains(const Offset(90, 60)) || isOpenShapeKind(kind) || kind == 'braceLeft',
          isTrue,
          reason: kind,
        );
      }
    });

    test('Pfad-Texte wie im Web (Zahlenformat inklusive)', () {
      // core rect: radius min(6, w/4, h/4), numbers unrounded
      expect(shapePathData('rect', 180, 120, 1), 'M7 1H173Q179 1 179 7V113Q179 119 173 119H7Q1 119 1 113V7Q1 1 7 1Z');
      expect(shapePathData('diamond', 180, 120, 1), 'M90 1L179 60L90 119L1 60Z');
      expect(shapePathData('ellipse', 100, 60, 1), 'M1 30a49 29 0 1 0 98 0a49 29 0 1 0 -98 0Z');
      // library: polygon scaled into the inset rectangle, rounded to 2 decimals
      expect(shapePathData('hexagon', 200, 100, 1), 'M50.5 1L149.5 1L199 50L149.5 99L50.5 99L1 50Z');
      expect(shapePathData('merge', 101, 100, 0), 'M0 0L101 0L50.5 100Z');
      // unknown kind → rectangle (old web clients do the same)
      expect(shapePathData('quatsch', 180, 120, 1), shapePathData('rect', 180, 120, 1));
    });

    test('Textflächen (Insets) wie im Web', () {
      expect(shapeInsets('rect', 180, 120), (10.0, 12.0, 10.0, 12.0));
      final (et, er, eb, el) = shapeInsets('ellipse', 100, 50);
      expect([et, er, eb, el], [closeTo(7, 1e-9), closeTo(14, 1e-9), closeTo(7, 1e-9), closeTo(14, 1e-9)]);
      expect(shapeInsets('braceLeft', 100, 50), (0.0, 0.0, 0.0, 0.0));
      expect(shapeInsets('callout', 100, 100).$3, closeTo(32, 1e-9));
      expect(isOpenShapeKind('braceRight'), isTrue);
      expect(isOpenShapeKind('rect'), isFalse);
    });

    test('JS-Zahlenformat', () {
      expect(jsNum(12), '12');
      expect(jsNum(-0.0), '0');
      expect(jsNum(12.5), '12.5');
      expect(jsNum(0.1 + 0.2), '0.30000000000000004');
    });
  });

  group('Verbinder', () {
    final a = box('a', 0, 0, 100, 100);
    final b = box('b', 300, 0, 100, 100);
    final lookup = {'a': a, 'b': b}.cast<String, BoardObject>();
    BoardObject? find(String id) => lookup[id];

    test('gerade: Strahl Mitte–Mitte, 6 Punkte Abstand zur Kante', () {
      final g = connectorGeometry(connector({'objectId': 'a'}, {'objectId': 'b'}), find)!;
      expect(g.a, near(const Offset(106, 50)));
      expect(g.b, near(const Offset(294, 50)));
      expect(g.pts.length, 2);
      expect(g.dirB, near(const Offset(1, 0)));
      expect(g.mid, near(const Offset(200, 50)));
    });

    test('gewinkelt zwischen gegenüberliegenden Seiten: Z über die Mitte', () {
      final g = connectorGeometry(
        connector({'objectId': 'a', 'side': 'e'}, {'objectId': 'b', 'side': 'w'}, style: 'elbow'),
        find,
      )!;
      expect(g.pts.first, near(const Offset(106, 50)));
      expect(g.pts.last, near(const Offset(294, 50)));
      // same y: the Z collapses to a straight line (simplified)
      expect(g.pts.length, 2);
      final down = box('d', 300, 300, 100, 100);
      final g2 = connectorGeometry(
        connector({'objectId': 'a', 'side': 'e'}, {'objectId': 'd', 'side': 'w'}, style: 'elbow'),
        (id) => id == 'a' ? a : down,
      )!;
      expect(g2.pts, [
        near(const Offset(106, 50)),
        near(const Offset(200, 50)),
        near(const Offset(200, 350)),
        near(const Offset(294, 350)),
      ]);
    });

    test('elbowRoute: gleiche Seite außen herum, Ecke bei waagerecht raus/senkrecht rein', () {
      final sameSide = elbowRoute(const Offset(0, 0), const Offset(1, 0), const Offset(0, 100), const Offset(1, 0));
      expect(sameSide[1].dx, 28);
      final corner = elbowRoute(const Offset(0, 0), const Offset(1, 0), const Offset(100, 100), const Offset(0, -1));
      expect(corner, [const Offset(0, 0), const Offset(100, 0), const Offset(100, 100)]);
    });

    test('geschwungen: Kontrollpunkte senkrecht aus den Seiten, Länge 45 % (40…260)', () {
      final g = connectorGeometry(connector({'objectId': 'a'}, {'objectId': 'b'}, style: 'curved'), find)!;
      expect(g.pts.length, 4);
      expect(g.pts[0], near(const Offset(106, 50)));
      expect(g.pts[1], near(Offset(106 + 188 * 0.45, 50)));
      expect(g.mid, near(const Offset(200, 50)));
    });

    test('freie Enden und fehlende Objekte', () {
      final g = connectorGeometry(connector({'x': 0, 'y': 0}, {'x': 10, 'y': 0}), find)!;
      expect(g.a, const Offset(0, 0));
      expect(connectorGeometry(connector({'objectId': 'weg'}, {'objectId': 'b'}), find), isNull);
    });

    test('Andocken an Ellipse, Raute und gedrehte Objekte', () {
      final e = box('e', 0, 0, 200, 100, shape: 'ellipse');
      expect(boundaryPoint(e, const Offset(100 + 300, 50)), near(const Offset(200, 50)));
      final d = box('d', 0, 0, 100, 100, shape: 'diamond');
      expect(boundaryPoint(d, const Offset(100, 100)), near(const Offset(75, 75)));
      final r = box('r', 0, 0, 100, 100, rotation: 90);
      final (p, dir) = sidePoint(r, 'n');
      expect(p, near(const Offset(100, 50)));
      expect(dir, near(const Offset(1, 0)));
      // library shape outline (triangle-like merge): the ray hits the slanted edge
      final m = box('m', 0, 0, 100, 100, shape: 'merge');
      expect(boundaryPoint(m, const Offset(100, 50)).dx, lessThan(100));
    });

    test('Spitzen: Kürzung und Formen', () {
      expect(capTrim('triangle', 2), closeTo(14 * 0.7, 1e-9));
      expect(capTrim('none', 2), 0);
      for (final cap in [
        'triangle',
        'triangleOpen',
        'arrow',
        'circle',
        'circleOpen',
        'diamond',
        'diamondOpen',
        'bar',
      ]) {
        expect(capShape(cap, const Offset(10, 0), const Offset(1, 0), 2), isNotNull, reason: cap);
      }
      expect(capShape('none', Offset.zero, const Offset(1, 0), 2), isNull);
      expect(capShape('triangle', Offset.zero, const Offset(1, 0), 2)!.filled, isTrue);
      expect(capShape('triangleOpen', Offset.zero, const Offset(1, 0), 2)!.filled, isFalse);
      expect(dashPattern('dashed', 2), [10, 8]);
      expect(dashPattern('dotted', 2), [0, 6]);
      expect(dashPattern(null, 2), isNull);
    });

    test('Bounds einer Kurve ohne die weit außen liegenden Kontrollpunkte', () {
      final g = connectorGeometry(
        connector({'objectId': 'a', 'side': 's'}, {'objectId': 'b', 'side': 's'}, style: 'curved'),
        find,
      )!;
      final bounds = connectorBounds(g, 0);
      expect(bounds.bottom, lessThan(g.pts[1].dy));
    });
  });

  group('Raster-Index', () {
    test('Abfrage, Entfernen, große Objekte, Punkt, Grenzen', () {
      final grid = SpatialGrid(cell: 100, maxCells: 16);
      grid.set('a', const Rect.fromLTWH(0, 0, 50, 50));
      grid.set('b', const Rect.fromLTWH(1000, 1000, 50, 50));
      grid.set('huge', const Rect.fromLTWH(-5000, -5000, 10000, 10000));
      grid.set('nan', const Rect.fromLTWH(double.nan, 0, 1, 1));
      expect(grid.length, 3);
      expect(grid.query(const Rect.fromLTWH(-10, -10, 100, 100)), {'a', 'huge'});
      expect(grid.queryPoint(const Offset(1025, 1025)), {'b', 'huge'});
      grid.set('a', const Rect.fromLTWH(2000, 2000, 10, 10));
      expect(grid.query(const Rect.fromLTWH(-10, -10, 100, 100)), {'huge'});
      grid.remove('huge');
      expect(grid.bounds, const Rect.fromLTRB(1000, 1000, 2010, 2010));
      // a query larger than the occupied area checks every entry directly
      expect(grid.query(const Rect.fromLTWH(-1e6, -1e6, 2e6, 2e6)), {'a', 'b'});
    });

    test('viele Objekte: Abfrage liefert genau die geschnittenen', () {
      final grid = SpatialGrid();
      final rnd = math.Random(1);
      final rects = <String, Rect>{};
      for (var i = 0; i < 3000; i++) {
        final r = Rect.fromLTWH(rnd.nextDouble() * 20000, rnd.nextDouble() * 20000, 50 + rnd.nextDouble() * 300, 50);
        rects['o$i'] = r;
        grid.set('o$i', r);
      }
      const view = Rect.fromLTWH(5000, 5000, 1200, 2000);
      final expected = {
        for (final e in rects.entries)
          if (e.value.overlaps(view)) e.key,
      };
      expect(grid.query(view), expected);
    });
  });
}
