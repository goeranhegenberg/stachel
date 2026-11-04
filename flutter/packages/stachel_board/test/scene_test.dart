// Culling and hit-testing (concept §3.2): grid index over the state, connectors follow their objects, hidden objects
// are neither drawn nor hit, frames only through their title or as background, lines by distance.
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

BoardScene sceneOf(List<Map<String, Object?>> objects) {
  final state = BoardState()..applySnapshot(BoardSnapshot.fromJson({'objects': objects}), rev: 1, epoch: 'e');
  return BoardScene(state)..sync();
}

void main() {
  group('Culling', () {
    test('nur Objekte im Ausschnitt, in Zeichenreihenfolge', () {
      final s = sceneOf([
        {'id': 'top', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'z': 'b'},
        {'id': 'bottom', 'type': 'sticky', 'x': 50, 'y': 50, 'w': 100, 'h': 100, 'z': 'a'},
        {'id': 'far', 'type': 'sticky', 'x': 5000, 'y': 5000, 'w': 100, 'h': 100, 'z': 'c'},
        {'id': 'frame', 'type': 'frame', 'x': -100, 'y': -100, 'w': 400, 'h': 400, 'z': 'z'},
      ]);
      expect(s.visible(const Rect.fromLTWH(0, 0, 300, 300)).map((o) => o.id), ['frame', 'bottom', 'top']);
      expect(s.visible(const Rect.fromLTWH(4900, 4900, 300, 300)).map((o) => o.id), ['far']);
      expect(s.bounds, const Rect.fromLTRB(-100, -128, 5100, 5100)); // frame title space included
    });

    test('gedrehte Objekte: umschließendes Rechteck', () {
      final r = objectRect(
        BoardObject.fromJson({'id': 'r', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'rotation': 45})!,
      );
      expect(r.width, closeTo(141.42, 0.01));
      expect(r.center, const Offset(50, 50));
    });

    test('Verbinder folgen verschobenen Objekten (inkrementell)', () {
      final s = sceneOf([
        {'id': 'a', 'type': 'shape', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'z': 'a'},
        {'id': 'b', 'type': 'shape', 'x': 300, 'y': 0, 'w': 100, 'h': 100, 'z': 'b'},
        {
          'id': 'c',
          'type': 'connector',
          'from': {'objectId': 'a'},
          'to': {'objectId': 'b'},
          'z': 'c',
        },
      ]);
      expect(s.connector('c')!.b.dx, closeTo(294, 0.01));
      final changed = s.state.applyPatch(
        PatchMessage.fromJson({
          'rev': 2,
          'changes': [
            {
              'id': 'b',
              'set': {'x': 3000},
            },
          ],
        }),
      );
      s.sync(changed);
      expect(s.connector('c')!.b.dx, closeTo(2994, 0.01));
      expect(s.visible(const Rect.fromLTWH(1500, 40, 10, 20)).map((o) => o.id), ['c']);
      // object removed → connector has no route and leaves the index
      s.sync(
        s.state.applyPatch(
          PatchMessage.fromJson({
            'rev': 3,
            'changes': [
              {'id': 'b', 'removed': true},
            ],
          }),
        ),
      );
      expect(s.connector('c'), isNull);
      expect(s.visible(const Rect.fromLTWH(1500, 40, 10, 20)), isEmpty);
    });

    test('Mindmap: Kante macht den Kindknoten auch beim Elternknoten sichtbar; Farbe wie im Web (eigene oder erste Zweigfarbe)', () {
      final s = sceneOf([
        {
          'id': 'root',
          'type': 'mindnode',
          'x': 0,
          'y': 0,
          'w': 100,
          'h': 40,
          'color': '#000000',
          'mind': {'level': 0},
        },
        {
          'id': 'main',
          'type': 'mindnode',
          'x': 500,
          'y': 0,
          'w': 100,
          'h': 40,
          'color': '#ec4e92',
          'mind': {'parent': 'root', 'level': 1},
        },
        {
          'id': 'sub',
          'type': 'mindnode',
          'x': 900,
          'y': 0,
          'w': 100,
          'h': 40,
          'mind': {'parent': 'main', 'level': 2},
        },
      ]);
      expect(s.visible(const Rect.fromLTWH(250, 0, 10, 10)).map((o) => o.id), ['main']);
      // like the web: a node without own color shows the first branch color (no inheritance when drawing)
      expect(mindNodeColor(s.state['sub']!), mindColors.first);
      expect(mindNodeColor(s.state['root']!), s.state['root']!.color);
      expect(s.mindParent(s.state['root']!), isNull);
    });
  });

  group('Hit-Test', () {
    final s = sceneOf([
      {'id': 'frame', 'type': 'frame', 'x': 0, 'y': 0, 'w': 1000, 'h': 1000, 'title': 'F', 'z': 'a'},
      {'id': 'low', 'type': 'sticky', 'x': 100, 'y': 100, 'w': 200, 'h': 200, 'z': 'b'},
      {'id': 'high', 'type': 'sticky', 'x': 200, 'y': 200, 'w': 200, 'h': 200, 'z': 'c'},
      {'id': 'hidden', 'type': 'sticky', 'x': 500, 'y': 100, 'w': 100, 'h': 100, 'z': 'd', 'hidden': true},
      {'id': 'ell', 'type': 'shape', 'shape': 'ellipse', 'x': 600, 'y': 600, 'w': 200, 'h': 100, 'z': 'e'},
      {
        'id': 'line',
        'type': 'connector',
        'from': {'x': 0, 'y': 900},
        'to': {'x': 1000, 'y': 900},
        'z': 'f',
      },
      {
        'id': 'pen',
        'type': 'pen',
        'x': 600,
        'y': 300,
        'w': 200,
        'h': 10,
        'points': [0, 5, 200, 5],
        'strokeWidth': 4,
        'z': 'g',
      },
      {'id': 'rot', 'type': 'sticky', 'x': 700, 'y': 100, 'w': 200, 'h': 20, 'rotation': 90, 'z': 'h'},
    ]);

    test('oberstes Objekt gewinnt', () {
      expect(s.hitTest(const Offset(250, 250), 1)!.id, 'high');
      expect(s.hitTest(const Offset(150, 150), 1)!.id, 'low');
    });

    test('Rahmen: über den Titel direkt, sonst nur als Hintergrund', () {
      expect(s.hitTest(const Offset(10, -10), 1)!.id, 'frame');
      expect(s.hitTest(const Offset(50, 500), 1)!.id, 'frame');
      expect(s.hitTest(const Offset(-50, 500), 1), isNull);
    });

    test('ausgeblendete Objekte werden nicht getroffen', () {
      expect(s.hitTest(const Offset(550, 150), 1)!.id, 'frame');
    });

    test('Form typgenau: Ecke außerhalb der Ellipse trifft nicht', () {
      expect(s.hitTest(const Offset(700, 650), 1)!.id, 'ell');
      expect(s.hitTest(const Offset(603, 603), 1)!.id, 'frame');
    });

    test('Linien: Abstand ≤ 12 Bildschirmpunkte (bei Zoom umgerechnet)', () {
      expect(s.hitTest(const Offset(500, 910), 1)!.id, 'line');
      expect(s.hitTest(const Offset(500, 920), 1)!.id, 'frame');
      expect(s.hitTest(const Offset(500, 920), 0.5)!.id, 'line'); // 12 px = 24 world points
      expect(s.hitTest(const Offset(700, 312), 1)!.id, 'pen');
    });

    test('gedrehtes Objekt: Punkt im gedrehten Rechteck', () {
      // 200×20 rotated by 90° around (800, 110): spans x 790…810, y 10…210
      expect(s.hitTest(const Offset(800, 30), 1)!.id, 'rot');
      expect(s.hitTest(const Offset(720, 110), 1)!.id, 'frame');
    });
  });
}
