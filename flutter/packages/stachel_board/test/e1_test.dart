// E1 („Ansehen & dabei sein“) in the package: offline cache (file cache bounds, restore → resume), own presence
// (throttled, only while live, again after reconnect), the others' cursors/selections, link focus `?o=`, double tap
// with two fingers = 100 %.
import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

BoardSnapshot _snap(List<Map<String, Object?>> objects) => BoardSnapshot.fromJson({'objects': objects});

final _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a'},
  {'id': 'b', 'type': 'shape', 'shape': 'ellipse', 'x': 400, 'y': 0, 'w': 200, 'h': 200, 'z': 'b'},
  {'id': 'far', 'type': 'text', 'x': 3000, 'y': 2000, 'w': 100, 'h': 40, 'text': 'weit weg', 'z': 'c'},
];

/// Source that answers a `hello` with `resume` like the server: `resumed` with [missing] when the epoch matches.
class _ResumingSource implements BoardSource {
  _ResumingSource({required this.epoch, required this.rev, this.missing = const [], BoardSnapshot? snapshot})
    : snapshot = snapshot ?? _snap(_objects);

  final String epoch;
  final int rev;
  final List<PatchMessage> missing;
  final BoardSnapshot snapshot;
  final sent = <Map<String, Object?>>[];
  final _messages = StreamController<ServerMessage>.broadcast(sync: true);
  final _connection = ValueNotifier(BoardConnection.connecting);
  bool offlineOnOpen = false;

  @override
  Stream<ServerMessage> get messages => _messages.stream;
  @override
  ValueListenable<BoardConnection> get connection => _connection;
  @override
  String? get closeReason => null;

  @override
  Future<void> open({String? resumeEpoch, int? resumeRev}) async {
    sent.add(helloMessage(board: 'b1', app: 'test', resumeEpoch: resumeEpoch, resumeRev: resumeRev));
    if (offlineOnOpen) {
      _connection.value = BoardConnection.offline;
      return;
    }
    goLive(resumeEpoch: resumeEpoch);
  }

  void goLive({String? resumeEpoch}) {
    _connection.value = BoardConnection.live;
    final info = ConnectionInfo(epoch: epoch, boardTitle: 'Server-Titel', color: '#2b8a3e');
    if (resumeEpoch == epoch) {
      _messages.add(ResumedMessage(rev, missing, info: info));
    } else {
      _messages.add(WelcomeMessage(proto: 1, rev: rev, snapshot: snapshot, info: info));
    }
  }

  void push(ServerMessage m) => _messages.add(m);
  void drop() => _connection.value = BoardConnection.offline;

  @override
  void send(Map<String, Object?> message) => sent.add(message);

  @override
  Future<void> close() async {
    _connection.value = BoardConnection.closed;
    await _messages.close();
  }
}

PatchMessage _patch(int rev, String id, Map<String, Object?> set) => PatchMessage.fromJson({
  't': 'patch',
  'rev': rev,
  'changes': [
    {'id': id, 'set': set},
  ],
});

CachedBoard _cached({String epoch = 'e1', int rev = 5, DateTime? at}) => CachedBoard(
  boardId: 'b1',
  title: 'Aus dem Cache',
  snapshot: _snap(_objects),
  epoch: epoch,
  rev: rev,
  savedAt: at ?? DateTime(2026, 11, 1, 14, 32),
);

void main() {
  group('FileBoardCache', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('stachel_cache_test'));
    tearDown(() {
      if (dir.existsSync()) dir.deleteSync(recursive: true);
    });

    test('speichert und lädt einen Board-Stand (Objekte, ext, Epoche, Revision, Zeit, Titel)', () async {
      final cache = FileBoardCache(dir);
      final state = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': _objects,
            'ext': {
              'collab.comments': {'x': 1},
            },
          }),
          rev: 42,
          epoch: 'ep',
        );
      final at = DateTime(2026, 11, 1, 9, 15);
      await cache.save(CachedBoard.of('b1', state, title: 'Festival', savedAt: at));
      final back = (await cache.load('b1'))!;
      expect(back.rev, 42);
      expect(back.epoch, 'ep');
      expect(back.title, 'Festival');
      expect(back.savedAt, at);
      expect(back.snapshot.objects.map((o) => o.id), ['a', 'b', 'far']);
      expect(back.snapshot.ext['collab.comments'], {'x': 1});
      state.applyPatch(_patch(43, 'a', {'text': 'neu'}));
      await cache.save(CachedBoard.of('b1', state, savedAt: at));
      expect((await cache.load('b1'))!.rev, 43, reason: 'überschreibt den alten Stand');
      expect(await cache.load('anderes'), isNull);
      expect(await cache.load('../böse'), isNull, reason: 'nur Board-IDs werden zu Dateinamen');
    });

    test('bleibt in der Größe begrenzt: älteste Boards fliegen zuerst, zu große werden nicht gespeichert', () async {
      final cache = FileBoardCache(dir, maxBoards: 2);
      for (final id in ['eins', 'zwei', 'drei']) {
        await cache.save(
          CachedBoard(boardId: id, snapshot: _snap(_objects), epoch: 'e', rev: 1, savedAt: DateTime(2026)),
        );
        await Future<void>.delayed(const Duration(milliseconds: 30)); // distinct file times
      }
      expect(await cache.load('eins'), isNull);
      expect(await cache.load('zwei'), isNotNull);
      expect(await cache.load('drei'), isNotNull);

      final tiny = FileBoardCache(dir, maxBoardBytes: 100);
      await tiny.save(CachedBoard(boardId: 'drei', snapshot: _snap(_objects), epoch: 'e', rev: 2, savedAt: DateTime(2026)));
      expect(await cache.load('drei'), isNull, reason: 'zu groß: alter Stand wird entfernt statt veraltet zu bleiben');

      final bytes = FileBoardCache(dir, maxBytes: 1);
      await bytes.save(CachedBoard(boardId: 'vier', snapshot: _snap(_objects), epoch: 'e', rev: 1, savedAt: DateTime(2026)));
      expect(await cache.load('vier'), isNotNull, reason: 'das gerade gespeicherte bleibt immer');
      expect(await cache.load('zwei'), isNull);
    });

    test('kaputte Datei = nichts im Cache; clear löscht alles', () async {
      final cache = FileBoardCache(dir);
      File('${dir.path}/board_kaputt.json').writeAsStringSync('{nicht json');
      expect(await cache.load('kaputt'), isNull);
      await cache.save(_cached());
      await cache.clear();
      expect(await cache.load('b1'), isNull);
    });
  });

  group('BoardController offline', () {
    test('zeigt den Cache sofort, verbindet mit resume, übernimmt nur die fehlenden Patches', () async {
      final source = _ResumingSource(epoch: 'e1', rev: 6, missing: [_patch(6, 'a', {'text': 'neu'})]);
      final c = BoardController(source);
      c.restore(_cached());
      expect(c.loaded, isTrue);
      expect(c.fromCache, isTrue);
      expect(c.title, 'Aus dem Cache');
      expect(c.staleSince, DateTime(2026, 11, 1, 14, 32));
      expect(c.toCache('b1'), isNull, reason: 'unbestätigter Stand wird nicht erneut gespeichert');

      await c.start();
      expect(source.sent.first['resume'], {'epoch': 'e1', 'rev': 5});
      expect(c.fromCache, isFalse);
      expect(c.staleSince, isNull);
      expect(c.state['a']!.text, 'neu');
      expect(c.state.rev, 6);
      expect(c.title, 'Server-Titel', reason: 'der Titel beim Verbinden ersetzt den aus dem Cache');
      expect(c.toCache('b1')!.rev, 6);

      source.drop();
      final stale = c.staleSince;
      expect(stale, isNotNull, reason: 'Verbindung weg: Stand von eben');
      expect(DateTime.now().difference(stale!).inSeconds, lessThan(5));
      c.dispose();
    });

    test('andere Epoche (Server neu gestartet) → frischer Schnappschuss ersetzt den Cache', () async {
      final source = _ResumingSource(epoch: 'e2', rev: 1, snapshot: _snap([_objects.first]));
      final c = BoardController(source);
      c.restore(_cached());
      await c.start();
      expect(c.state.length, 1);
      expect(c.state.epoch, 'e2');
      c.dispose();
    });

    test('offline ohne Server: Cache bleibt sichtbar mit Zeit', () async {
      final source = _ResumingSource(epoch: 'e1', rev: 5)..offlineOnOpen = true;
      final c = BoardController(source);
      c.restore(_cached());
      await c.start();
      expect(c.loaded, isTrue);
      expect(c.state.length, 3);
      expect(c.staleSince, DateTime(2026, 11, 1, 14, 32));
      source.goLive(resumeEpoch: 'e1');
      expect(c.staleSince, isNull);
      c.dispose();
    });
  });

  group('PresenceSender', () {
    test('nur live, gedrosselt, letzter Stand gewinnt, Gleiches nicht doppelt, nach Wiederverbinden alles neu', () async {
      final sent = <Map<String, Object?>>[];
      final p = PresenceSender(sent.add, interval: const Duration(milliseconds: 80));
      p.update(viewport: const Rect.fromLTWH(0, 0, 400, 800));
      expect(sent, isEmpty, reason: 'nicht live');
      p.live = true;
      p.update(selection: ['a']);
      expect(sent, hasLength(1));
      expect(sent.single, {
        't': 'presence',
        'cursor': {'x': 200.0, 'y': 400.0},
        'selection': ['a'],
        'editing': null,
        'viewport': {'x': 0.0, 'y': 0.0, 'w': 400.0, 'h': 800.0},
      });
      p.update(viewport: const Rect.fromLTWH(10, 0, 400, 800));
      p.update(viewport: const Rect.fromLTWH(20.4, 0, 400, 800));
      expect(sent, hasLength(1), reason: 'gedrosselt');
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(sent, hasLength(2));
      expect((sent.last['viewport'] as Map)['x'], 20.0);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      p.update(viewport: const Rect.fromLTWH(20.4, 0, 400, 800));
      expect(sent, hasLength(2), reason: 'unverändert');
      p.resend();
      expect(sent, hasLength(3));
      p.live = false;
      p.update(viewport: const Rect.fromLTWH(99, 0, 400, 800));
      await Future<void>.delayed(const Duration(milliseconds: 120));
      expect(sent, hasLength(3));
      p.dispose();
    });

    test('BoardController schickt die Anwesenheit nach welcome und nach jedem Wiederverbinden erneut', () async {
      final source = _ResumingSource(epoch: 'e1', rev: 5);
      final c = BoardController(source, presenceInterval: Duration.zero);
      c.presence.update(viewport: const Rect.fromLTWH(0, 0, 100, 100));
      await c.start();
      expect(source.sent.where((m) => m['t'] == 'presence'), hasLength(1));
      expect(c.color, '#2b8a3e');
      source.drop();
      source.goLive(resumeEpoch: 'e1');
      expect(source.sent.where((m) => m['t'] == 'presence'), hasLength(2));
      c.dispose();
    });
  });

  // two-finger taps (double = 100 %, single = Rückgängig, three = Wiederholen): test/ux_a2/multi_finger_taps_test.dart

  group('BoardView E1', () {
    Future<(BoardController, FixtureBoardSource, CameraController, ValueNotifier<Set<String>>)> pump(
      WidgetTester tester, {
      String? focus,
      VoidCallback? onMissing,
    }) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final source = FixtureBoardSource(_snap(_objects));
      final controller = BoardController(source, presenceInterval: Duration.zero);
      addTearDown(controller.dispose);
      final camera = CameraController();
      final selection = ValueNotifier<Set<String>>(const {});
      await tester.pumpWidget(
        MaterialApp(
          home: BoardView(
            controller: controller,
            camera: camera,
            selection: selection,
            initialFocus: focus,
            onFocusMissing: onMissing,
          ),
        ),
      );
      await controller.start();
      await tester.pump();
      await tester.pump();
      return (controller, source, camera, selection);
    }

    testWidgets('?o=<id>: Kamera auf das Objekt (höchstens 100 %), ausgewählt und hervorgehoben', (tester) async {
      final (_, _, camera, selection) = await pump(tester, focus: 'far');
      expect(selection.value, {'far'});
      expect(camera.value.z, 1);
      final center = camera.value.toScreen(const Offset(3050, 2020));
      expect(center.dx, closeTo(400, 1));
      expect(center.dy, closeTo(300, 1));
      await tester.pump(const Duration(seconds: 2)); // highlight runs out
    });

    testWidgets('?o= mit unbekanntem Objekt: alles zeigen + Hinweis', (tester) async {
      var missing = 0;
      final (_, _, camera, selection) = await pump(tester, focus: 'weg', onMissing: () => missing++);
      expect(missing, 1);
      expect(selection.value, isEmpty);
      expect(camera.value.z, lessThan(1), reason: 'eingepasst');
    });

    testWidgets('eigene Anwesenheit: Ausschnitt und Auswahl gehen raus', (tester) async {
      final (_, source, _, selection) = await pump(tester);
      final presence = source.sent.where((m) => m['t'] == 'presence').toList();
      expect(presence, isNotEmpty);
      final vp = presence.last['viewport'] as Map;
      expect(vp['w'], greaterThan(800), reason: 'eingepasst: sichtbarer Bereich in Board-Koordinaten');
      selection.value = {'a'};
      await tester.pump();
      expect(source.sent.where((m) => m['t'] == 'presence').last['selection'], ['a']);
    });

    testWidgets('fremde Cursor und Auswahl werden gezeichnet', (tester) async {
      final (controller, source, _, _) = await pump(tester);
      source.push(
        PresenceMessage([
          const Peer(id: 7, key: 'm:7', name: 'Jonas', color: '#ec4e92', cursorX: 100, cursorY: 100, selection: ['b']),
        ]),
      );
      await tester.pump();
      expect(controller.peers.single.name, 'Jonas');
      final painters = tester
          .widgetList<CustomPaint>(find.byType(CustomPaint))
          .map((p) => p.painter)
          .whereType<PresencePainter>();
      expect(painters, hasLength(1));
      // paint once into a recorder: draws without errors
      final recorder = ui.PictureRecorder();
      painters.single.paint(Canvas(recorder), const Size(800, 600));
      recorder.endRecording().dispose();
    });

    testWidgets('Doppeltippen mit zwei Fingern = 100 %', (tester) async {
      final (_, _, camera, _) = await pump(tester);
      expect(camera.value.z, lessThan(1));
      for (var i = 0; i < 2; i++) {
        final g1 = await tester.startGesture(const Offset(300, 300), pointer: 10 + i * 2);
        final g2 = await tester.startGesture(const Offset(400, 300), pointer: 11 + i * 2);
        await tester.pump(const Duration(milliseconds: 40));
        await g1.up();
        await g2.up();
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(camera.value.z, 1);
    });
  });
}
