// E3 editing in the BoardView: connectors (tool, plus/anchor handles, dragging an end), pen/highlighter/eraser
// (stylus), frames carry their content, comment pins/reaction chips, comment tool, formatting selected text.
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
  {'id': 'b', 'type': 'shape', 'shape': 'rect', 'x': 400, 'y': 0, 'w': 200, 'h': 100, 'z': 'a1', 'text': 'B'},
  {'id': 'f', 'type': 'frame', 'x': -20, 'y': 280, 'w': 400, 'h': 260, 'title': 'Bühne', 'z': 'a2'},
  {'id': 'in', 'type': 'sticky', 'x': 0, 'y': 300, 'w': 100, 'h': 100, 'z': 'a3', 'text': 'drin'},
  {
    'id': 'p',
    'type': 'pen',
    'x': 500,
    'y': 400,
    'w': 104,
    'h': 4,
    'points': [2, 2, 102, 2],
    'strokeWidth': 4,
    'color': '#0a0a0a',
    'z': 'a4',
  },
];

Future<(BoardController, FixtureBoardSource, BoardEditor, GlobalKey<BoardViewState>)> _pump(
  WidgetTester tester, {
  Map<String, Object?> ext = const {},
  ValueChanged<String>? onComment,
  ValueChanged<CommentAnchor>? onCommentAt,
}) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: ext), rev: 20);
  final controller = BoardController(source, presenceInterval: Duration.zero, sendInterval: const Duration(milliseconds: 30));
  addTearDown(controller.dispose);
  final scene = BoardScene(controller.state);
  final editor = BoardEditor(controller: controller, scene: scene, camera: CameraController())
    ..textDebounce = const Duration(milliseconds: 50)
    ..onHaptic = () {};
  addTearDown(editor.dispose);
  final key = GlobalKey<BoardViewState>();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardView(key: key, controller: controller, editor: editor, fitOnLoad: false, onComment: onComment, onCommentAt: onCommentAt),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  // the user is known (own key for reactions/comments)
  source.push(
    WelcomeMessage(
      proto: 1,
      rev: 20,
      snapshot: BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: ext),
      info: const ConnectionInfo(epoch: 'fixture', user: NativeUser(key: 'm:1', name: 'Mara'), features: ['objects', 'ext', 'ops', 'text', 'comments', 'reactions']),
    ),
  );
  await tester.pump();
  return (controller, source, editor, key);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

Future<void> _drag(WidgetTester tester, Offset from, Offset to, {int steps = 10, PointerDeviceKind kind = PointerDeviceKind.touch}) async {
  final g = await tester.startGesture(from, kind: kind);
  for (var i = 1; i <= steps; i++) {
    await g.moveTo(Offset.lerp(from, to, i / steps)!);
    await tester.pump(const Duration(milliseconds: 16));
  }
  await g.up();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  group('Verbinder', () {
    testWidgets('Linie zum Andockpunkt rastet ein (side), freies Ende bleibt frei; Linienart aus dem Werkzeug', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      e
        ..tool = BoardTool.connector
        ..connectorStyle = 'elbow';
      await _drag(tester, const Offset(100, 100), const Offset(398, 52));
      var conn = ((_ops(s).last['objects'] as List).single as Map);
      expect(conn['to'], {'objectId': 'b', 'side': 'w'});
      expect(conn['lineStyle'], 'elbow');
      e.tool = BoardTool.connector;
      await _drag(tester, const Offset(100, 100), const Offset(700, 300));
      conn = ((_ops(s).last['objects'] as List).single as Map);
      expect(conn['to'], {'x': 700.0, 'y': 300.0});
      final n = _ops(s).length;
      e.tool = BoardTool.connector;
      await _drag(tester, const Offset(700, 200), const Offset(703, 201), steps: 2);
      expect(_ops(s).length, n, reason: 'kurz ins Leere: nichts');
    });

    testWidgets('Werkzeug Linie: von Objekt zu Objekt → angedockt, geschwungen, ausgewählt', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      e.tool = BoardTool.connector;
      await _drag(tester, const Offset(100, 100), const Offset(500, 50));
      final conn = ((_ops(s).single['objects'] as List).single as Map);
      expect(conn['type'], 'connector');
      expect(conn['from'], {'objectId': 'a'});
      expect(conn['to'], {'objectId': 'b'});
      expect(conn['lineStyle'], 'curved', reason: 'zwischen zwei Objekten geschwungen');
      expect(conn['arrowEnd'], isTrue);
      expect(e.selection.value, {conn['id']});
      expect(e.tool, BoardTool.select);
    });

    testWidgets('Plus-Griff ziehen: auf ein Objekt = Verbinder dorthin, ins Leere = gleiche Form dort, verbunden', (tester) async {
      final (c, s, e, _) = await _pump(tester);
      e.select({'b'});
      await tester.pump();
      final plus = e.handles().firstWhere((h) => h.id == 'add-s').at;
      await _drag(tester, plus, const Offset(700, 450));
      final create = (_ops(s).last['objects'] as List).cast<Map>();
      final copy = create.firstWhere((o) => o['type'] == 'shape');
      final conn = create.firstWhere((o) => o['type'] == 'connector');
      expect((copy['x'], copy['y'], copy['shape'], copy['text']), (600.0, 400.0, 'rect', ''));
      expect(conn['from'], {'objectId': 'b', 'side': 's'});
      expect((conn['to'] as Map)['objectId'], copy['id']);
      expect(c.state[copy['id'] as String], isNotNull);
      expect(e.editingId, copy['id'], reason: 'web: die neue Form ist gleich zum Schreiben offen');
      e.stopEditing();

      e.select({'b'});
      await tester.pump();
      final plusW = e.handles().firstWhere((h) => h.id == 'add-w').at;
      await _drag(tester, plusW, const Offset(100, 100));
      final c2 = ((_ops(s).last['objects'] as List).single as Map);
      expect(c2['from'], {'objectId': 'b', 'side': 'w'});
      expect(c2['to'], {'objectId': 'a'});
    });

    testWidgets('Ende eines Verbinders umhängen: Griff ziehen, ein Schritt, Feld from/to + Box', (tester) async {
      final (c, s, e, _) = await _pump(tester);
      e.tool = BoardTool.connector;
      await _drag(tester, const Offset(100, 100), const Offset(700, 300));
      final id = e.selection.value.single;
      await tester.pump(const Duration(milliseconds: 100));
      final end = e.handles().firstWhere((h) => h.id == 'end-to').at;
      await _drag(tester, end, const Offset(500, 50));
      expect(c.state[id]!.to, isA<AttachedEnd>().having((x) => x.objectId, 'objectId', 'b'));
      final last = (_ops(s).last['patches'] as Map)[id] as Map;
      expect(last['to'], {'objectId': 'b'});
      expect(last.keys, containsAll(['x', 'y', 'w', 'h']));
      expect(s.sent.last, {'t': 'step'});
      expect(e.draft.value, isNull);
    });
  });

  group('Stift, Textmarker, Radierer', () {
    testWidgets('Finger zeichnet im Stift-Werkzeug (Strich ausgedünnt, Farbe/Breite), zweiter Finger bricht ab', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      e
        ..tool = BoardTool.pen
        ..penColor = '#ec4e92'
        ..penWidth = 8;
      await _drag(tester, const Offset(300, 200), const Offset(400, 250));
      final pen = ((_ops(s).single['objects'] as List).single as Map);
      expect(pen['type'], 'pen');
      expect(pen['color'], '#ec4e92');
      expect(pen['strokeWidth'], 8);
      expect((pen['points'] as List).length, 4, reason: 'gerader Strich: zwei Punkte');
      expect(pen.containsKey('marker'), isFalse);
      // Textmarker
      e.penMarker = true;
      await _drag(tester, const Offset(300, 300), const Offset(350, 320));
      final marker = ((_ops(s).last['objects'] as List).single as Map);
      expect((marker['marker'], marker['color'], marker['strokeWidth']), (true, '#ffe14d', 20.0));
      // Pinch während des Zeichnens: nichts angelegt
      final n = _ops(s).length;
      final g1 = await tester.startGesture(const Offset(200, 200));
      await g1.moveBy(const Offset(20, 0));
      await tester.pump();
      final g2 = await tester.startGesture(const Offset(400, 400));
      await g1.moveBy(const Offset(-20, 0));
      await g2.moveBy(const Offset(30, 30));
      await g1.up();
      await g2.up();
      await tester.pump(const Duration(milliseconds: 100));
      expect(_ops(s).length, n);
      expect(e.draft.value, isNull);
    });

    testWidgets('nach einem Stylus zeichnet nur noch der Stylus, Finger verschieben die Ansicht', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      e.tool = BoardTool.pen;
      await _drag(tester, const Offset(300, 200), const Offset(400, 250), kind: PointerDeviceKind.stylus);
      expect(_ops(s), hasLength(1));
      expect(e.stylusSeen, isTrue);
      final cam = e.camera.value;
      await _drag(tester, const Offset(300, 200), const Offset(400, 250));
      expect(_ops(s), hasLength(1), reason: 'Finger zeichnet nicht mehr');
      expect(e.camera.value.x, isNot(cam.x));
    });

    testWidgets('Radierer löscht ganze Striche, über die er fährt (ein Schritt)', (tester) async {
      final (c, s, e, _) = await _pump(tester);
      e.tool = BoardTool.eraser;
      await _drag(tester, const Offset(550, 380), const Offset(560, 420));
      expect(_ops(s).single, {
        'op': 'remove',
        'ids': ['p'],
      });
      expect(c.state['p'], isNull);
    });
  });

  group('Rahmen', () {
    testWidgets('Rahmen-Werkzeug legt „Rahmen n“ an; ausgewählten Rahmen ziehen nimmt den Inhalt mit', (tester) async {
      final (c, s, e, _) = await _pump(tester);
      e.tool = BoardTool.frame;
      await tester.tapAt(const Offset(700, 100));
      await tester.pump(const Duration(milliseconds: 400));
      final frame = ((_ops(s).single['objects'] as List).single as Map);
      expect((frame['type'], frame['title'], frame['w'], frame['h']), ('frame', 'Rahmen 2', 640.0, 420.0));
      expect(e.tool, BoardTool.select);
      e.select({'f'});
      await tester.pump();
      await _drag(tester, const Offset(300, 450), const Offset(350, 470));
      final patches = _ops(s).last['patches'] as Map;
      expect(patches.keys, unorderedEquals(['f', 'in']));
      expect(c.state['in']!.x, 50);
      expect(c.state['a']!.x, 0, reason: 'nicht im Rahmen');
      e.renameFrame('f', '  Neue   Bühne ');
      expect(((_ops(s).last['patches'] as Map)['f'] as Map)['title'], 'Neue Bühne');
      expect(e.frames.map((f) => f.id).last, 'f', reason: 'Lesereihenfolge: der neue liegt weiter oben');
    });
  });

  group('Kommentare und Reaktionen auf dem Board', () {
    final ext = {
      'collab.comments': {
        't1': {
          'x': 50,
          'y': 50,
          'objectId': 'a',
          'dx': 200,
          'dy': 60,
          'resolved': false,
          'createdBy': 'm:2',
          'createdAt': '2026-11-01T10:00:00Z',
          'messages': [
            {'id': 'x', 'by': 'm:2', 'name': 'Jonas', 'text': '@Mara?', 'at': '2026-11-01T10:00:00Z', 'mentions': ['m:1']},
          ],
        },
        'done': {
          'x': 700,
          'y': 500,
          'resolved': true,
          'createdBy': 'm:2',
          'createdAt': '2026-11-01T10:00:00Z',
          'messages': [
            {'id': 'y', 'by': 'm:2', 'name': 'Jonas', 'text': 'erledigt', 'at': '2026-11-01T10:00:00Z'},
          ],
        },
      },
      'collab.reactions': {
        'b|👍|m:2': {'o': 'b', 'e': '👍', 'u': 'm:2', 'n': 'Jonas', 'at': '2026-11-01T10:00:00Z'},
      },
    };

    testWidgets('Pin antippen öffnet den Thread (erledigte ohne Pin); Reaktions-Chip antippen schaltet die eigene um', (tester) async {
      final opened = <String>[];
      final (c, s, e, key) = await _pump(tester, ext: ext, onComment: opened.add);
      final layer = key.currentState!.collab;
      expect(c.state.ext.keys, containsAll(['collab.comments', 'collab.reactions']));
      expect(layer.threads.map((t) => t.id), unorderedEquals(['t1', 'done']));
      expect(layer.showPins, isTrue);
      expect(layer.threads.map((t) => (t.id, t.resolved)), unorderedEquals([('t1', false), ('done', true)]));
      expect(layer.shownThreads.map((t) => t.id), ['t1']);
      expect(layer.unread, {'t1'}, reason: 'ungelesene Erwähnung von mir: pink');
      await tester.tapAt(layer.pinCenter(layer.threads.first, e.camera.value));
      await tester.pump(const Duration(milliseconds: 400));
      expect(opened, ['t1']);
      final chips = layer.chips(e.camera.value, const Size(800, 600), OverlayText());
      expect(chips.single.group.emoji, '👍');
      await tester.tapAt(chips.single.rect.center);
      await tester.pump(const Duration(milliseconds: 400));
      expect(_ops(s).single, {
        'op': 'react',
        'ids': ['b'],
        'emoji': '👍',
        'on': true,
      });
      expect(reactionsByObject(c.state.ext['collab.reactions'], 'm:1')['b']!.single.people, hasLength(2));
    });

    testWidgets('Kommentar-Werkzeug: Tippen auf ein Objekt gibt den Anker (angeheftet), ins Leere frei', (tester) async {
      final anchors = <CommentAnchor>[];
      final (_, _, e, _) = await _pump(tester, onCommentAt: anchors.add);
      e.tool = BoardTool.comment;
      await tester.tapAt(const Offset(500, 50));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tapAt(const Offset(750, 150));
      await tester.pump(const Duration(milliseconds: 400));
      expect(anchors.map((a) => (a.objectId, a.dx, a.dy)), [('b', 100.0, 50.0), (null, 0.0, 0.0)]);
    });

    testWidgets('Kommentar schreiben mit @Erwähnung, antworten, erledigen → Ops mit festen IDs', (tester) async {
      final (c, s, e, _) = await _pump(tester);
      final people = e.mentionPeople(const [Person('m:2', 'Jonas'), Person('m:1', 'Mara')]);
      expect(people.map((p) => p.key), ['m:2'], reason: 'ohne mich selbst');
      final id = e.addComment(const CommentAnchor(10, 10, objectId: 'a', dx: 10, dy: 10), '  Strom klären @Jonas ', people)!;
      final op = _ops(s).single;
      expect((op['op'], op['thread'], op['text']), ('comment', id, 'Strom klären @Jonas'));
      expect(op['mentions'], ['m:2']);
      e.replyComment(id, 'mach ich', people);
      e.resolveComment(id, resolved: true);
      expect(_ops(s).map((o) => o['op']), ['comment', 'reply', 'resolve']);
      expect(e.threads.single.resolved, isTrue);
      e.markMentionsRead();
      expect(_ops(s).last['op'], 'mentionsRead');
      expect(c.state.ext['collab.reads'], isA<Map>());
    });
  });

  group('Format-Leiste beim Schreiben', () {
    testWidgets('Auswahl fett machen geht als text-Op mit bold-Mark raus', (tester) async {
      final (_, s, e, key) = await _pump(tester);
      expect(key.currentState!.editText('b'), isTrue);
      await tester.pump();
      e.textRange = (start: 0, end: 1);
      await tester.pump();
      expect(e.formatText((d, a, b) => d.toggleMark(a, b, 'bold')), isTrue);
      await tester.pump(const Duration(milliseconds: 80));
      final op = _ops(s).last;
      expect(op['op'], 'text');
      final para = ((op['doc'] as Map)['content'] as List).single as Map;
      expect(para['content'], [
        {
          'type': 'text',
          'text': 'B',
          'marks': [
            {'type': 'bold'},
          ],
        },
      ]);
      key.currentState!.finishEditing();
      await tester.pump();
    });
  });
}
