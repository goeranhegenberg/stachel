// UX P3 (B3, Bild 28c): hit-testing at small zoom – surfaces before thin lines, line tolerance shrinks with the zoom
// and is capped by the line's length, a running vote prefers votable objects. Board: the web's festival template
// (docs/native_fixtures/web/templates.json), where a tap on „Bühne, Zelte und Bar aufbauen“ in the overview used to hit
// the short connector between the boxes.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

/// The festival template's objects with z in creation order (connectors above the boxes, like on a real board).
List<Map<String, Object?>> festivalObjects() {
  final f = jsonDecode(File('../../../docs/native_fixtures/web/templates.json').readAsStringSync()) as Map;
  final list = ((f['templates'] as Map)['festival'] as List).cast<Map<String, Object?>>();
  return [
    for (final (i, o) in list.indexed) {...o, 'z': 'a${i.toString().padLeft(3, '0')}'},
  ];
}

BoardScene sceneOf(List<Map<String, Object?>> objects) {
  final state = BoardState()..applySnapshot(BoardSnapshot.fromJson({'objects': objects}), rev: 1, epoch: 'e');
  return BoardScene(state)..sync();
}

void main() {
  group('Festival-Board: Tipp auf die Form trifft die Form, nicht den Verbinder (B3)', () {
    final s = sceneOf(festivalObjects());
    // „Bühne, Zelte und Bar aufbauen“ (30, 310, 460 × 110), connectors 4→5 above and 5→7 below it
    const buehne = 'festival-5';
    const above = 'festival-6', below = 'festival-8';

    for (final z in [1.0, 0.5, 0.35, 0.25, 0.17, 0.1]) {
      test('Zoom ${(z * 100).round()} %: Mitte, oberer und unterer Rand der Form → Form', () {
        expect(s.hitTest(const Offset(260, 365), z)?.id, buehne, reason: 'Mitte');
        // 4 screen px inside the top/bottom edge (the connectors end right there)
        expect(s.hitTest(Offset(260, 310 + 4 / z), z)?.id, buehne, reason: 'oberer Rand');
        expect(s.hitTest(Offset(260, 420 - 4 / z), z)?.id, buehne, reason: 'unterer Rand');
      });
    }

    test('zwischen den Kästen bleibt der Verbinder treffbar (auch bei kleinem Zoom)', () {
      for (final z in [1.0, 0.5, 0.17]) {
        expect(s.hitTest(const Offset(260, 285), z)?.id, above, reason: 'Zoom $z: Lücke oberhalb');
        expect(s.hitTest(const Offset(260, 445), z)?.id, below, reason: 'Zoom $z: Lücke unterhalb');
      }
      // next to the line in the gap at 100 %: 10 px off still hits (12 px tolerance)
      expect(s.hitTest(const Offset(270, 285), 1)?.id, above);
    });

    test('genau auf der Linie gewinnt die Linie (oben gezeichnet), knapp daneben die Fläche darunter', () {
      final t = sceneOf([
        {'id': 'note', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a'},
        {
          'id': 'line',
          'type': 'connector',
          'from': {'x': -100, 'y': 100},
          'to': {'x': 300, 'y': 100},
          'z': 'b',
        },
      ]);
      expect(t.hitTest(const Offset(100, 102), 1)?.id, 'line', reason: 'auf der Linie (≤ 3 px + halbe Strichbreite)');
      expect(t.hitTest(const Offset(100, 110), 1)?.id, 'note', reason: '10 px daneben, auf der Notiz');
      expect(t.hitTest(const Offset(-50, 110), 1)?.id, 'line', reason: '10 px daneben, nichts darunter');
      // 20 %: 10 world units are 2 screen px – still „on the line“; 40 units (8 px) off: the note
      expect(t.hitTest(const Offset(100, 110), 0.2)?.id, 'line');
      expect(t.hitTest(const Offset(100, 140), 0.2)?.id, 'note', reason: 'kleiner Zoom, 8 px daneben: die Notiz');
    });
  });

  group('Toleranz je Zoom (P3)', () {
    test('12 px ab 50 %, auf 6 px bei 20 % und darunter', () {
      expect(lineHitToleranceAt(2), 12);
      expect(lineHitToleranceAt(0.5), 12);
      expect(lineHitToleranceAt(0.35), closeTo(9, 1e-9));
      expect(lineHitToleranceAt(0.2), 6);
      expect(lineHitToleranceAt(0.05), 6);
    });

    test('ein kurzer Verbinder hat höchstens seine halbe Länge als Zone', () {
      final t = sceneOf([
        {
          'id': 'short',
          'type': 'connector',
          'from': {'x': 0, 'y': 0},
          'to': {'x': 20, 'y': 0},
          'z': 'a',
        },
      ]);
      // zoom 0.2: 6 px = 30 world units, capped to 10 (half of 20) + 1 (stroke) – but at least the core 15
      expect(t.hitTest(const Offset(10, 14), 0.2)?.id, 'short');
      expect(t.hitTest(const Offset(10, 25), 0.2), isNull);
      // 100 %: core 3, cap 10 → 10 off hits, 12 off does not
      expect(t.hitTest(const Offset(10, 10), 1)?.id, 'short');
      expect(t.hitTest(const Offset(10, 12), 1), isNull);
    });

    test('Stiftstriche: wie Linien – Fläche darunter vor knapp daneben', () {
      final t = sceneOf([
        {'id': 'note', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a'},
        {
          'id': 'pen',
          'type': 'pen',
          'x': 0,
          'y': 95,
          'w': 200,
          'h': 10,
          'points': [0, 5, 200, 5],
          'strokeWidth': 4,
          'z': 'b',
        },
      ]);
      expect(t.hitTest(const Offset(100, 103), 1)?.id, 'pen');
      expect(t.hitTest(const Offset(100, 110), 1)?.id, 'note');
    });
  });

  group('Abstimmung: abstimmbare Objekte zuerst (prefer)', () {
    final s = sceneOf([
      {'id': 'frame', 'type': 'frame', 'x': -100, 'y': -100, 'w': 600, 'h': 600, 'z': 'a'},
      {'id': 'note', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'z': 'b'},
      {
        'id': 'line',
        'type': 'connector',
        'from': {'x': 50, 'y': -50},
        'to': {'x': 50, 'y': 300},
        'z': 'c',
      },
    ]);
    bool votable(BoardObject o) => o.type != 'connector' && o.type != 'frame' && o.type != 'pen';

    test('genau auf der Linie über der Notiz: ohne prefer die Linie, mit prefer die Notiz', () {
      expect(s.hitTest(const Offset(50, 50), 1)?.id, 'line');
      expect(s.hitTest(const Offset(50, 50), 1, prefer: votable)?.id, 'note');
      expect(s.hitTest(const Offset(50, 50), 0.17, prefer: votable)?.id, 'note');
    });

    test('ein paar Pixel neben der Notiz zählt noch; weiter weg geht der Tipp normal weiter', () {
      // 5 screen px right of the note at 17 %
      expect(s.hitTest(Offset(100 + 5 / 0.17, 20), 0.17, prefer: votable)?.id, 'note');
      // far off: nothing votable → the frame (background), like without prefer
      expect(s.hitTest(const Offset(400, 400), 0.17, prefer: votable)?.id, 'frame');
      expect(s.hitTest(const Offset(50, 200), 1, prefer: votable)?.id, 'line', reason: 'nur die Linie dort');
    });
  });
}
