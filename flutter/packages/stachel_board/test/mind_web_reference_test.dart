// Mind maps like the web (contract §8.6 `mind`): `stachel/tools/native-mind-fixtures.mts` runs the real web functions
// (mindmap/ops.ts, layout.ts, style.ts) with the server's font metrics on a Y.Doc and writes
// docs/native_fixtures/web/mindmap.json – start state, the ops the app sends, the result. The app's prediction
// ([MindPlanner], port of ops.ts) must give exactly the same positions, sizes, colors and `mind` fields, and its text
// measure the same widths.
// Refresh: in the stachel repo `server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-mind-fixtures.mts`,
// then copy docs/native_fixtures/web/mindmap.json here.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

final _f = (jsonDecode(File('../../../docs/native_fixtures/web/mindmap.json').readAsStringSync()) as Map).cast<String, Object?>();

/// Like the fixture's `result`: layout fields per node.
Map<String, Object?> _state(List<Map<String, Object?>> nodes) => {
  for (final o in nodes)
    o['id'] as String: {
      'x': o['x'],
      'y': o['y'],
      'w': o['w'],
      'h': o['h'],
      'text': o['text'] ?? '',
      'color': o['color'],
      'mind': o['mind'] ?? const {},
    },
};

/// Deep equality, numbers by value (2 == 2.0), maps without key order.
bool _same(Object? a, Object? b) {
  if (a is Map && b is Map) {
    final ka = a.keys.where((k) => a[k] != null).toSet(), kb = b.keys.where((k) => b[k] != null).toSet();
    return ka.length == kb.length && ka.every((k) => kb.contains(k) && _same(a[k], b[k]));
  }
  if (a is List && b is List) {
    return a.length == b.length && [for (var i = 0; i < a.length; i++) _same(a[i], b[i])].every((x) => x);
  }
  return a == b;
}

void main() {
  test('Textbreiten wie der Server (Schriftmaße aus dem Chromium)', () {
    final m = TextMetrics.instance;
    for (final c in (_f['measures']! as List).cast<Map<String, Object?>>()) {
      final w = m.measure(c['text'] as String, (c['fs'] as num).toDouble(), c['weight'] as int, c['family'] as String);
      expect(w, closeTo((c['width'] as num).toDouble(), 1e-9), reason: '${c['family']} „${c['text']}“');
    }
  });

  test(
    'Knotengrößen wie mindSize im Web (${(_f['sizes']! as List).length} Fälle: Umbruch, Platzhalter, Ligaturen)',
    () {
      for (final c in (_f['sizes']! as List).cast<Map<String, Object?>>()) {
        final s = mindSize(c['text'] as String, c['level'] as int);
        expect([s.w, s.h], [c['w'], c['h']], reason: 'Ebene ${c['level']} „${c['text']}“');
      }
    },
  );

  group('Mindmap-Ops wie der Web-Code', () {
    for (final c in (_f['cases']! as List).cast<Map<String, Object?>>()) {
      test(c['name'] as String, () {
        final plan = MindPlanner.fromRaw((c['start']! as List).cast<Map<String, Object?>>());
        for (final op in (c['ops']! as List).cast<Map<String, Object?>>()) {
          plan.applyJson(op);
        }
        final got = _state(plan.nodes);
        final want = (c['result']! as Map).cast<String, Object?>();
        expect(got.keys.toSet(), want.keys.toSet());
        for (final id in want.keys) {
          expect(
            _same(got[id], want[id]),
            isTrue,
            reason: '$id\n  App: ${jsonEncode(got[id])}\n  Web: ${jsonEncode(want[id])}',
          );
        }
      });
    }
  });

  test('Vorschau als Ops: gleicher Stand wie nach dem Planen (Overlay der App)', () {
    final start = (((_f['cases']! as List).first as Map)['start']! as List).cast<Map<String, Object?>>();
    final plan = MindPlanner.fromRaw(start)..child('root', 'n1');
    final op = plan.op({'do': 'child', 'id': 'root', 'new': 'n1'});
    expect(op.toJson(), {'op': 'mind', 'do': 'child', 'id': 'root', 'new': 'n1'});
    final state = BoardState()..applySnapshot(BoardSnapshot.fromJson({'objects': start}), rev: 1, epoch: 'e');
    final next = <String, BoardObject?>{};
    for (final id in {...state.objects.keys, 'n1'}) {
      next[id] = applyOp(op, id, state[id], zTop: () => 'z~', zBottom: () => ' ');
    }
    for (final o in plan.nodes) {
      final shown = next[o['id']]!;
      expect([shown.x, shown.y, shown.w, shown.h], [o['x'], o['y'], o['w'], o['h']], reason: '${o['id']}');
      expect(_same(shown.raw['mind'], o['mind']), isTrue);
    }
  });
}
