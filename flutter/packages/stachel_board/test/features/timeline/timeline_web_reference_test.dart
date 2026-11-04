// Reference values of the web code for the timeline (parity audit P9): `stachel/tools/native-timeline-fixtures.mts` runs
// the web's model.ts/create.ts (dates, layout, packing, header, hits, dragging, side handles, new timelines, dialog days,
// milestone toggle, range extension) and writes docs/native_fixtures/web/timeline.json; the Dart port must give the same.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/timeline/timeline_model.dart';
import 'package:stachel_board/src/model/board_object.dart';

final _ref = (jsonDecode(File('../../../docs/native_fixtures/web/timeline.json').readAsStringSync()) as Map).cast<String, Object?>();

List<Map<String, Object?>> _list(String key, [Map<String, Object?>? from]) => [
  for (final x in ((from ?? _ref)[key]! as List)) (x as Map).cast<String, Object?>(),
];

double _d(Object? v) => (v! as num).toDouble();

Map<String, Object?> _hitJson(TlHit? h) => h == null
    ? const {'null': true}
    : {
        'kind': h.kind,
        if (h.kind == 'header') 'day': h.day,
        if (h.kind == 'label' || h.kind == 'lane' || h.kind == 'item') 'lane': h.lane,
        if (h.kind == 'lane' || h.kind == 'item') 'day': h.day,
        if (h.kind == 'item') 'id': h.id,
      };

Map<String, Object?> _webHit(Object? h) => h == null ? const {'null': true} : (h as Map).cast<String, Object?>();

Map<String, Object?> _tick(TlTick t) => {
  'x': t.x,
  'w': t.w,
  'label': t.label,
  'sub': t.sub,
  'weekend': t.weekend,
  'today': t.today,
};

Map<String, Object?> _webTick(Map<String, Object?> t) => {
  'x': _d(t['x']),
  'w': _d(t['w']),
  'label': t['label'],
  'sub': t['sub'],
  'weekend': t['weekend'] ?? false,
  'today': t['today'] ?? false,
};

void main() {
  final today = _ref['today']! as int;

  test('Datum: Tagnummern, KW, Beschriftungen wie im Web', () {
    for (final c in _list('dates')) {
      final n = tlParseDay(c['s']);
      expect(n, c['n'], reason: '${c['s']}');
      expect(tlIsoWeek(n!), c['iso'], reason: '${c['s']}');
      expect(tlDayLabel(n), c['label']);
      expect(tlDayLabel(n, true), c['labelYear']);
      expect(tlFmtDay(n), c['fmt']);
    }
    for (final c in _list('badDays')) {
      expect(tlParseDay(c['s']), c['n'], reason: '${c['s']}');
    }
    for (final c in _list('spans')) {
      expect(tlSpanLabel(c['a']! as int, c['b']! as int), c['label']);
    }
    for (final c in _list('msW')) {
      expect(tlMsLabelW(c['t']! as String), closeTo(_d(c['w']), 1e-9));
    }
  });

  group('Layout je Zeitleiste', () {
    for (final c in _list('layouts')) {
      test(c['name']! as String, () {
        final o = (c['o']! as Map).cast<String, Object?>();
        final data = safeTimeline(o['timeline']);
        expect(jsonDecode(jsonEncode(data.toJson())), c['data'], reason: 'safeTimeline');
        final r = tlRangeOf(o, today);
        final wr = (c['range']! as Map);
        expect([r.start, r.end, r.days], [wr['start'], wr['end'], wr['days']]);
        expect(tlUnitOf(o), c['unit']);
        final l = tlLayoutOf(data, r, tlUnitOf(o));
        final wl = (c['layout']! as Map).cast<String, Object?>();
        expect(l.dayPx, _d(wl['dayPx']));
        expect(l.w0, _d(wl['W0']));
        expect(l.h0, _d(wl['H0']));
        expect([l.before, l.after], [wl['before'], wl['after']]);
        expect(
          [
            for (final x in l.lanes) {'id': x.id, 'name': x.name, 'y': x.y, 'h': x.h, 'rows': x.rows},
          ],
          [
            for (final x in _list('lanes', wl))
              {'id': x['id'], 'name': x['name'], 'y': _d(x['y']), 'h': _d(x['h']), 'rows': x['rows']},
          ],
        );
        final items = _list('items', wl);
        expect(l.items.length, items.length);
        for (var i = 0; i < items.length; i++) {
          final a = l.items[i], b = items[i];
          expect(
            [a.id, a.a, a.b, a.lane, a.row, a.y, a.h, a.cutL, a.cutR],
            [b['id'], b['a'], b['b'], b['lane'], b['row'], _d(b['y']), _d(b['h']), b['cutL'], b['cutR']],
          );
          expect(a.x, closeTo(_d(b['x']), 1e-6));
          expect(a.w, closeTo(_d(b['w']), 1e-6));
        }
        final t = tlTicks(r, tlUnitOf(o), today);
        final wt = (c['ticks']! as Map).cast<String, Object?>();
        expect([for (final x in t.top) _tick(x)], [for (final x in _list('top', wt)) _webTick(x)]);
        expect([for (final x in t.bottom) _tick(x)], [for (final x in _list('bottom', wt)) _webTick(x)]);
        for (final h in _list('hits', c)) {
          final got = tlHitLocal(l, _d(h['lx']), _d(h['ly']));
          expect(_hitJson(got), _webHit(h['hit']), reason: '${h['lx']},${h['ly']}');
        }
        expect(tlScaleOf(_d(o['w']), l), closeTo(_d(c['scale']), 1e-12));
        expect(tlText(data), c['text']);
        for (final x in _list('dayAt', c)) {
          expect(tlDayAt(l, _d(x['lx'])), x['day']);
        }
        for (final x in _list('newItemSpan', c)) {
          final s = tlNewItemSpan(l, x['day'] as int?, x['today']! as int);
          expect([s.$1, s.$2], x['span']);
        }
        for (final x in _list('extend', c)) {
          final e = tlExtendRange(o, x['side']! as String, today);
          final w = x['r']! as Map;
          expect([e.start, e.end], [w['start'], w['end']]);
        }
      });
    }
  });

  test('Ziehen auf Tage und Einrasten wie im Web', () {
    final r = TlRange(tlParseDay('2026-11-02')!, tlParseDay('2026-12-27')!);
    for (final c in _list('drags')) {
      final out = tlDragDays(c['a']! as int, c['b']! as int, c['mode']! as String, c['dd']! as int, r);
      expect([out.$1, out.$2], c['out'], reason: '$c');
    }
    for (final c in _list('snaps')) {
      expect(tlSnapDays(_d(c['dx']), _d(c['dayPx'])), c['dd'], reason: '$c');
    }
  });

  test('Seitengriffe: Zeitraum, x und Größe wie `resize` im Web', () {
    final cases = {for (final c in _list('layouts')) c['name']: (c['o']! as Map).cast<String, Object?>()};
    for (final c in _list('resizes')) {
      final raw = cases[c['name']]!;
      final o = BoardObject({'id': 'x', 'type': 'timeline', ...raw});
      final west = c['west'] == true;
      final out = tlResize(o, {'x': o.x, 'y': o.y, 'w': _d(c['newW']), 'h': o.h}, west ? 'w' : 'e', today);
      final want = (c['out']! as Map).cast<String, Object?>();
      if (_d(c['newW']) == o.w) {
        // the web hook only runs when the width changed (`ctx.to.w !== ctx.from.w`)
        continue;
      }
      expect(
        {for (final e in out.entries) e.key: e.value is num ? (e.value! as num).toDouble() : e.value},
        {for (final e in want.entries) e.key: e.value is num ? (e.value! as num).toDouble() : e.value},
        reason: '$c',
      );
    }
  });

  test('Neue Zeitleiste und Standard-Zeitraum je Skala', () {
    for (final c in _list('defaults')) {
      final r = tlDefaultRange(c['unit']! as String, c['today']! as int);
      final w = c['r']! as Map;
      expect([r.start, r.end, r.days], [w['start'], w['end'], w['days']]);
    }
    for (final c in _list('created')) {
      final o = tlNewTimeline(
        500,
        300,
        today,
        unit: c['unit']! as String,
        start: c['start'] as int?,
        end: c['end'] as int?,
      );
      expect(jsonDecode(jsonEncode(o)), _normalize(c['o']));
    }
  });

  test('Meilenstein umschalten und Dialog-Tage wie im Web', () {
    TlItem item(Map j) => safeTimeline({
      'lanes': ['l1'],
      'items': {'k': j},
    }).items['k']!;
    for (final c in _list('toggles')) {
      final p = tlToggleMsPatch(item(c['it']! as Map), c['unit']! as String)..removeWhere((k, v) => v == null);
      expect(p, c['out']);
    }
    for (final c in _list('dayPatches')) {
      final p = tlDayPatch(item(c['it']! as Map), c['which']! as String, tlParseDay(c['day'])!);
      expect(p, c['out'], reason: '$c');
    }
  });
}

/// Web numbers as doubles where Dart writes doubles (x/y/w/h).
Object? _normalize(Object? j) {
  if (j is Map) {
    return {
      for (final e in j.entries)
        e.key: (e.key == 'x' || e.key == 'y' || e.key == 'w' || e.key == 'h') && e.value is num
            ? (e.value as num).toDouble()
            : _normalize(e.value),
    };
  }
  if (j is List) return [for (final x in j) _normalize(x)];
  return j;
}
