// E2 editing: gesture state machine (tap, double tap, pan vs. move, hold 300 ms to grab, long press menu/rectangle,
// second finger, handles), and the board widget with tools, moving, handles, text editing in place with rich text
// kept, „schreibt hier gerade“, locked objects, context actions – every change as ops (only changed fields).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

class _Log implements BoardGestureHandler {
  final events = <String>[];
  GestureHit Function(Offset p) hit = (_) => GestureHit.empty;
  @override
  bool editable = true;
  @override
  bool commentable = false;

  @override
  GestureHit hitAt(Offset p) => hit(p);
  @override
  void panStart(Offset p) => events.add('panStart');
  @override
  void panUpdate(Offset delta) => events.add('pan');
  @override
  void panEnd(Offset velocity) => events.add('panEnd');
  @override
  void pinchStart(Offset focal) => events.add('pinchStart');
  @override
  void pinchUpdate(Offset focal, double scale) => events.add('pinch');
  @override
  void pinchEnd() => events.add('pinchEnd');
  @override
  void tap(Offset p, GestureHit hit) => events.add('tap:${hit.objectId}');
  @override
  void doubleTap(Offset p, GestureHit hit) => events.add('doubleTap:${hit.objectId}');
  @override
  void dragStart(Offset p, GestureHit hit, {required bool grabbed}) => events.add('dragStart:${hit.objectId}:$grabbed');
  @override
  void dragUpdate(Offset p) => events.add('drag');
  @override
  void dragEnd() => events.add('dragEnd');
  @override
  void handleStart(String handle, Offset p) => events.add('handleStart:$handle');
  @override
  void handleUpdate(Offset p) => events.add('handle');
  @override
  void handleEnd() => events.add('handleEnd');
  @override
  void longPressEmpty(Offset p) => events.add('menu');
  @override
  void longPressObject(Offset p, GestureHit hit) => events.add('objectMenu:${hit.objectId}');
  @override
  void marqueeStart(Offset p) => events.add('marqueeStart');
  @override
  void marqueeUpdate(Offset start, Offset p) => events.add('marquee');
  @override
  void marqueeEnd() => events.add('marqueeEnd');
  @override
  void drawStart(Offset p) => events.add('drawStart');
  @override
  void drawUpdate(Offset p) => events.add('draw');
  @override
  void drawEnd(Offset p, {required bool moved}) => events.add('drawEnd:$moved');
  @override
  void drawCancel() => events.add('drawCancel');

  List<String> get distinct => [
    for (var i = 0; i < events.length; i++)
      if (i == 0 || events[i] != events[i - 1]) events[i],
  ];
}

Duration ms(int v) => Duration(milliseconds: v);

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0', 'myorg.taskId': 7},
  {
    'id': 'b',
    'type': 'shape',
    'shape': 'rect',
    'x': 400,
    'y': 0,
    'w': 200,
    'h': 100,
    'z': 'a1',
    'text': 'fett und kommentiert',
    'content': {
      'type': 'doc',
      'content': [
        {
          'type': 'paragraph',
          'content': [
            {
              'type': 'text',
              'text': 'fett',
              'marks': [
                {'type': 'bold'},
              ],
            },
            {'type': 'text', 'text': ' und '},
            {
              'type': 'text',
              'text': 'kommentiert',
              'marks': [
                {
                  'type': 'comment',
                  'attrs': {'id': 'c1'},
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {'id': 'g1', 'type': 'sticky', 'x': 0, 'y': 300, 'w': 100, 'h': 100, 'z': 'a2', 'groupId': 'G'},
  {'id': 'g2', 'type': 'sticky', 'x': 150, 'y': 300, 'w': 100, 'h': 100, 'z': 'a3', 'groupId': 'G'},
  {'id': 'lock', 'type': 'sticky', 'x': 400, 'y': 300, 'w': 100, 'h': 100, 'z': 'a4', 'locked': true},
];

Future<(BoardController, FixtureBoardSource, BoardEditor, GlobalKey<BoardViewState>)> pumpEditor(
  WidgetTester tester,
) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(BoardSnapshot.fromJson({'objects': _objects}), rev: 20);
  final controller = BoardController(
    source,
    presenceInterval: Duration.zero,
    sendInterval: const Duration(milliseconds: 30),
  );
  addTearDown(controller.dispose);
  final scene = BoardScene(controller.state);
  final camera = CameraController();
  final editor = BoardEditor(controller: controller, scene: scene, camera: camera)
    ..textDebounce = const Duration(milliseconds: 50)
    ..onHaptic = () {};
  addTearDown(editor.dispose);
  final key = GlobalKey<BoardViewState>();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardView(key: key, controller: controller, editor: editor, fitOnLoad: false),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return (controller, source, editor, key);
}

List<Map<String, Object?>> opsOf(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

void main() {
  group('BoardGestures', () {
    late _Log log;
    late BoardGestures g;
    setUp(() {
      log = _Log();
      g = BoardGestures(log);
    });

    test('Tippen, Doppeltippen (≤ 300 ms, nah), zweites Tippen später ist wieder Tippen', () {
      g.down(1, const Offset(10, 10), ms(0));
      g.up(1, ms(80));
      g.down(1, const Offset(14, 12), ms(200));
      g.up(1, ms(260));
      g.down(1, const Offset(14, 12), ms(1000));
      g.up(1, ms(1060));
      expect(log.events, ['tap:null', 'doubleTap:null', 'tap:null']);
    });

    test('Ziehen auf leerer Fläche oder nicht ausgewähltem Objekt verschiebt die Ansicht', () {
      log.hit = (_) => const GestureHit(objectId: 'a', movable: true);
      g.down(1, Offset.zero, ms(0));
      g.move(1, const Offset(10, 0), ms(20));
      expect(log.events, isEmpty, reason: 'unter der Schwelle');
      g.move(1, const Offset(40, 0), ms(40));
      g.move(1, const Offset(80, 0), ms(60));
      g.up(1, ms(80));
      expect(log.distinct, ['panStart', 'pan', 'panEnd']);
    });

    test('ausgewähltes Objekt: Ziehen verschiebt es sofort; gesperrt (nicht beweglich) → Ansicht', () {
      log.hit = (_) => const GestureHit(objectId: 'a', selected: true, movable: true);
      g.down(1, Offset.zero, ms(0));
      g.move(1, const Offset(40, 0), ms(40));
      g.up(1, ms(80));
      expect(log.distinct, ['dragStart:a:false', 'drag', 'dragEnd']);
      log.events.clear();
      log.hit = (_) => const GestureHit(objectId: 'lock', selected: true);
      g.down(1, Offset.zero, ms(1000));
      g.move(1, const Offset(40, 0), ms(1040));
      g.up(1, ms(1080));
      expect(log.distinct, ['panStart', 'pan', 'panEnd']);
    });

    test('300 ms halten greift das Objekt (danach Ziehen); auf leerer Fläche: Menü bzw. Rechteck', () {
      log.hit = (_) => const GestureHit(objectId: 'a', movable: true);
      g.down(1, Offset.zero, ms(0));
      expect(g.deadline, ms(300));
      g.timeout(ms(299));
      expect(log.events, isEmpty);
      g.timeout(ms(300));
      g.move(1, const Offset(50, 0), ms(400));
      g.up(1, ms(450));
      expect(log.distinct, ['dragStart:a:true', 'drag', 'dragEnd']);

      log.events.clear();
      log.hit = (_) => GestureHit.empty;
      g.down(1, Offset.zero, ms(1000));
      g.timeout(ms(1300));
      g.up(1, ms(1400));
      expect(log.events, ['menu']);

      log.events.clear();
      g.down(1, Offset.zero, ms(2000));
      g.timeout(ms(2300));
      g.move(1, const Offset(60, 60), ms(2400));
      g.up(1, ms(2500));
      expect(log.distinct, ['marqueeStart', 'marquee', 'marqueeEnd']);
    });

    test('nur lesen: Halten tut nichts, Loslassen ist ein Tippen', () {
      log.editable = false;
      log.hit = (_) => const GestureHit(objectId: 'a', selected: true, movable: true);
      g.down(1, Offset.zero, ms(0));
      g.timeout(ms(400));
      g.up(1, ms(500));
      expect(log.events, ['tap:a']);
    });

    test('zweiter Finger beendet das Verschieben und zoomt; ein Finger bleibt → schiebt weiter', () {
      log.hit = (_) => const GestureHit(objectId: 'a', selected: true, movable: true);
      g.down(1, Offset.zero, ms(0));
      g.move(1, const Offset(40, 0), ms(40));
      g.down(2, const Offset(200, 0), ms(60));
      g.move(2, const Offset(260, 0), ms(80));
      g.up(2, ms(100));
      g.move(1, const Offset(60, 0), ms(120));
      g.up(1, ms(140));
      expect(log.distinct, [
        'dragStart:a:false',
        'drag',
        'dragEnd',
        'pinchStart',
        'pinch',
        'pinchEnd',
        'panStart',
        'pan',
        'panEnd',
      ]);
    });

    test('Griff: sofort, ohne Halten', () {
      log.hit = (_) => const GestureHit(handle: 'se');
      g.down(1, Offset.zero, ms(0));
      g.move(1, const Offset(5, 5), ms(10));
      g.up(1, ms(20));
      expect(log.distinct, ['handleStart:se', 'handle', 'handleEnd']);
    });
  });

  group('Geometrie', () {
    test('Größe ändern hält die gegenüberliegende Ecke fest (auch gedreht); Seitenverhältnis optional', () {
      final r = resizeBox(const Rect.fromLTWH(0, 0, 100, 50), 0, 'se', const Offset(200, 150));
      expect(r, const Rect.fromLTWH(0, 0, 200, 150));
      final k = resizeBox(const Rect.fromLTWH(0, 0, 100, 50), 0, 'se', const Offset(200, 60), keepAspect: true);
      expect(k, const Rect.fromLTWH(0, 0, 200, 100));
      final w = resizeBox(const Rect.fromLTWH(0, 0, 100, 50), 0, 'w', const Offset(-50, 999));
      expect(w, const Rect.fromLTWH(-50, 0, 150, 50));
      // 90° gedreht: „se“ liegt bei Bildschirm links unten; die Ecke „nw“ (rechts oben) bleibt
      final rot = resizeBox(const Rect.fromLTWH(0, 0, 100, 50), 90, 'se', const Offset(25 - 50, 25 + 100));
      final c = rot.center;
      final nwWorld = c + Offset(-rot.height / 2 * -1, -rot.width / 2) * 1; // rotated (−w/2, −h/2)
      expect(nwWorld.dx, closeTo(75, 1e-9));
      expect(nwWorld.dy, closeTo(-25, 1e-9));
      expect(resizeBox(const Rect.fromLTWH(0, 0, 100, 50), 0, 'se', const Offset(-500, -500)).size, const Size(20, 20));
    });

    test('Drehen rastet wie im Web bei Vielfachen von 90° (±5°) ein', () {
      expect(snapAngle(3), (deg: 0.0, snapped: true));
      expect(snapAngle(87), (deg: 90.0, snapped: true));
      expect(snapAngle(-93), (deg: -90.0, snapped: true));
      expect(snapAngle(178), (deg: 180.0, snapped: true));
      expect(snapAngle(30.04), (deg: 30.0, snapped: false));
      expect(snapAngle(370), (deg: 10.0, snapped: false));
    });
  });

  group('BoardView bearbeiten', () {
    testWidgets('Werkzeug Notiz + Tippen legt eine Notiz an und öffnet die Tastatur; Text geht als text-Op raus', (
      tester,
    ) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      editor.tool = BoardTool.sticky;
      await tester.tapAt(const Offset(700, 500));
      await tester.pump();
      final create = opsOf(source).single;
      expect(create['op'], 'create');
      final obj = (create['objects'] as List).single as Map;
      expect(obj, containsPair('type', 'sticky'));
      expect(obj['x'], 600);
      expect(obj['color'], '#fff27a');
      final id = obj['id'] as String;
      expect(controller.state[id], isNotNull, reason: 'sofort sichtbar');
      expect(editor.tool, BoardTool.select);
      expect(editor.editingId, id);
      expect(find.byKey(const Key('boardTextField')), findsOneWidget);
      expect(source.sent.lastWhere((m) => m['t'] == 'presence')['editing'], id);
      await tester.enterText(find.byKey(const Key('boardTextField')), 'Zelte');
      await tester.pump(const Duration(milliseconds: 80));
      final text = opsOf(source).last;
      expect(text['op'], 'text');
      expect(text['id'], id);
      expect(text['base'], 20);
      expect(text['baseDoc'], {'type': 'doc', 'content': <Object?>[]});
      expect(pmPlainText(text['doc']), 'Zelte');
      expect(controller.state[id]!.text, 'Zelte');
      // tippen woanders hin beendet das Bearbeiten (Schritt zu, „schreibt“ weg)
      await tester.tapAt(const Offset(780, 20));
      await tester.pump(const Duration(milliseconds: 400));
      expect(editor.editingId, isNull);
      expect(find.byKey(const Key('boardTextField')), findsNothing);
      expect(source.sent.lastWhere((m) => m['t'] == 'presence')['editing'], isNull);
      final lastOps = source.sent.lastIndexWhere((m) => m['t'] == 'ops');
      expect(source.sent.skip(lastOps).any((m) => m['t'] == 'step'), isTrue, reason: 'Bearbeiten = ein Undo-Schritt');
    });

    testWidgets('Formatierung und unbekannte Marks bleiben beim Tippen erhalten', (tester) async {
      final (_, source, editor, key) = await pumpEditor(tester);
      editor.select({'b'});
      await tester.pump();
      await tester.tapAt(const Offset(500, 50)); // ausgewählte Form antippen → bearbeiten
      await tester.pump();
      expect(editor.editingId, 'b');
      await tester.enterText(find.byKey(const Key('boardTextField')), 'fett und kommentiert!');
      await tester.pump(const Duration(milliseconds: 80));
      final op = opsOf(source).last;
      expect(op['op'], 'text');
      final para = ((op['doc'] as Map)['content'] as List).single as Map;
      expect(para['content'], [
        {
          'type': 'text',
          'text': 'fett',
          'marks': [
            {'type': 'bold'},
          ],
        },
        {'type': 'text', 'text': ' und '},
        {
          'type': 'text',
          'text': 'kommentiert!',
          'marks': [
            {
              'type': 'comment',
              'attrs': {'id': 'c1'},
            },
          ],
        },
      ]);
      expect(((op['baseDoc'] as Map)['content'] as List).single, isA<Map>());
      key.currentState!.finishEditing();
      await tester.pump();
    });

    testWidgets('Doppeltippen auf leere Fläche = neue Notiz; Gruppe wird ganz ausgewählt', (tester) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      await tester.tapAt(const Offset(50, 350));
      await tester.pump(const Duration(milliseconds: 400));
      expect(editor.selection.value, {'g1', 'g2'});
      await tester.tapAt(const Offset(700, 450));
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tapAt(const Offset(700, 450));
      await tester.pump();
      expect(opsOf(source).single['op'], 'create');
      expect(editor.editingId, isNotNull);
      expect(controller.state[editor.editingId!]!.type, 'sticky');
      await tester.pump(const Duration(milliseconds: 400));
    });

    testWidgets('ausgewählte Notiz verschieben: Zwischenstände gedrosselt, Ende schließt den Schritt, nur x/y', (
      tester,
    ) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      editor.select({'a'});
      await tester.pump();
      final g = await tester.startGesture(const Offset(100, 100));
      for (var i = 0; i < 10; i++) {
        await g.moveBy(const Offset(10, 5));
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(controller.state['a']!.x, closeTo(100 - 18 + 18, 20), reason: 'folgt dem Finger');
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
      final updates = opsOf(source).where((o) => o['op'] == 'update').toList();
      expect(updates.length, lessThan(10), reason: 'gedrosselt');
      final last = (updates.last['patches'] as Map)['a'] as Map;
      expect(last.keys, unorderedEquals(['x', 'y']), reason: 'nur geänderte Felder – Unbekanntes bleibt am Server');
      expect(last['x'], 100);
      expect(last['y'], 50);
      expect(source.sent.last, {'t': 'step'});
      expect(controller.state['a']!.raw['myorg.taskId'], 7);
    });

    testWidgets('nicht ausgewähltes Objekt: Ziehen schiebt die Ansicht, 300 ms halten greift es', (tester) async {
      final (controller, source, editor, key) = await pumpEditor(tester);
      final camera = key.currentState!.camera;
      await tester.dragFrom(const Offset(100, 100), const Offset(-60, 0));
      await tester.pump();
      expect(camera.value.x, lessThan(-30));
      expect(opsOf(source), isEmpty);
      final g = await tester.startGesture(Offset(400 + 100 + camera.value.x, 50));
      await tester.pump(const Duration(milliseconds: 350));
      await g.moveBy(const Offset(0, 40));
      await tester.pump(const Duration(milliseconds: 20));
      await g.moveBy(const Offset(0, 40));
      await tester.pump(const Duration(milliseconds: 20));
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
      expect(editor.selection.value, {'b'});
      expect(controller.state['b']!.y, closeTo(80, 0.5));
    });

    testWidgets('gesperrtes Objekt: keine Griffe, nicht verschiebbar, nicht löschbar', (tester) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      editor.select({'lock'});
      await tester.pump();
      expect(editor.handles(), isEmpty);
      await tester.dragFrom(const Offset(450, 350), const Offset(50, 0));
      await tester.pump();
      expect(controller.state['lock']!.x, 400);
      editor.deleteSelection();
      expect(opsOf(source), isEmpty);
    });

    testWidgets(
      'Griffe: Ecke ändert die Größe (Notiz quadratisch), Drehen rastet ein, Plus legt eine verbundene Kopie an',
      (tester) async {
        final (controller, source, editor, _) = await pumpEditor(tester);
        editor.camera.value = const Camera(100, 100, 1);
        editor.select({'a'});
        await tester.pump();
        final hs = {for (final h in editor.handles()) h.id: h.at};
        expect(hs.keys, containsAll(['nw', 'ne', 'se', 'sw', 'rotate', 'add-e', 'add-s', 'add-w']));
        await tester.dragFrom(hs['se']!, const Offset(100, 40));
        await tester.pump(const Duration(milliseconds: 100));
        expect(controller.state['a']!.w, 300);
        expect(controller.state['a']!.h, 300);
        final rot = editor.handles().firstWhere((h) => h.id == 'rotate').at;
        // nach rechts um die Mitte (Bildschirm 250, 250): fast 90° → rastet auf 90° ein
        final g = await tester.startGesture(rot);
        await g.moveTo(const Offset(250 + 200, 250 + 6));
        await tester.pump();
        await g.up();
        await tester.pump(const Duration(milliseconds: 100));
        expect(controller.state['a']!.rotation, 90);
        editor.select({'a'});
        await tester.pump();
        final plus = editor.handles().firstWhere((h) => h.id == 'add-s').at;
        await tester.tapAt(plus);
        await tester.pump(const Duration(milliseconds: 100));
        final create = opsOf(source).lastWhere((o) => o['op'] == 'create');
        final objs = (create['objects'] as List).cast<Map>();
        expect(objs.first['type'], 'sticky');
        expect(objs.first['text'], '');
        expect(objs.first.containsKey('myorg.taskId'), isTrue, reason: 'Kopie wie im Web: alles außer Identität/Text');
        expect(objs.last['type'], 'connector');
        expect(objs.last['from'], {'objectId': 'a', 'side': 's'});
        expect(editor.selection.value, {objs.first['id']});
      },
    );

    testWidgets('Kontextaktionen: löschen, duplizieren (neue Gruppe), vorne/hinten, Farbe – je eine Op', (
      tester,
    ) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      editor.select({'g1', 'g2'});
      editor.duplicateSelection();
      final dup = opsOf(source).last;
      final copies = (dup['objects'] as List).cast<Map>();
      expect(copies, hasLength(2));
      expect(copies.map((c) => c['groupId']).toSet(), hasLength(1));
      expect(copies.first['groupId'], isNot('G'));
      expect(editor.selection.value, {for (final c in copies) c['id']});
      editor.select({'a'});
      editor.order(toFront: true);
      expect(opsOf(source).last, {
        'op': 'order',
        'ids': ['a'],
        'to': 'front',
      });
      editor.setField('color', '#c9e14a');
      expect(opsOf(source).last['patches'], {
        'a': {'color': '#c9e14a'},
      });
      expect(editor.stickyColor, '#c9e14a');
      editor.deleteSelection();
      expect(opsOf(source).last, {
        'op': 'remove',
        'ids': ['a'],
      });
      expect(controller.state['a'], isNull);
      expect(editor.selection.value, isEmpty);
      await tester.pump();
    });

    testWidgets('jemand schreibt schon in der Notiz: trotzdem bearbeiten wie im Web; „schreibt hier“ bleibt', (
      tester,
    ) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      source.push(
        const PresenceMessage([Peer(id: 9, key: 'm:9', name: 'Mara Muster', color: '#ec4e92', editing: 'a')]),
      );
      await tester.pump();
      editor.select({'a'});
      await tester.pump();
      await tester.tapAt(const Offset(100, 100));
      await tester.pump(const Duration(milliseconds: 400));
      expect(editor.editingId, 'a');
      expect(editor.writerOf('a'), 'Mara');
    });

    testWidgets('lange drücken auf leere Fläche ruft das Menü; halten + ziehen wählt im Rechteck', (tester) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final source = FixtureBoardSource(BoardSnapshot.fromJson({'objects': _objects}), rev: 20);
      final controller = BoardController(source, presenceInterval: Duration.zero);
      addTearDown(controller.dispose);
      final menu = <Offset>[];
      final key = GlobalKey<BoardViewState>();
      await tester.pumpWidget(
        MaterialApp(
          home: BoardView(key: key, controller: controller, fitOnLoad: false, onLongPress: menu.add),
        ),
      );
      await controller.start();
      await tester.pump();
      final g = await tester.startGesture(const Offset(700, 550));
      await tester.pump(const Duration(milliseconds: 350));
      await g.up();
      await tester.pump();
      expect(menu, [const Offset(700, 550)]);
      final m = await tester.startGesture(const Offset(-10 + 10, 280));
      await tester.pump(const Duration(milliseconds: 350));
      await m.moveTo(const Offset(300, 420));
      await tester.pump();
      await m.up();
      await tester.pump();
      expect(key.currentState!.selection.value, {'g1', 'g2'});
    });

    testWidgets('Text-Objekt: leer beendet = gelöscht; nur lesen (Rolle) = keine Werkzeuge, Tippen wählt nur', (
      tester,
    ) async {
      final (controller, source, editor, _) = await pumpEditor(tester);
      editor.tool = BoardTool.text;
      await tester.tapAt(const Offset(700, 500));
      await tester.pump();
      final id = editor.editingId!;
      expect(controller.state[id]!.type, 'text');
      await tester.tapAt(const Offset(300, 550));
      await tester.pump(const Duration(milliseconds: 400));
      expect(opsOf(source).last, {
        'op': 'remove',
        'ids': [id],
      });

      controller.role = 'view';
      editor.tool = BoardTool.sticky;
      await tester.tapAt(const Offset(700, 500));
      await tester.pump(const Duration(milliseconds: 400));
      expect(opsOf(source).where((o) => o['op'] == 'create'), hasLength(1), reason: 'nur lesen: nichts angelegt');
    });
  });
}
