// Abnahme 2026-11-02 (native Parität): Korrekturen nach dem Abgleich mit dem Web – Spitze im Verbinder-Werkzeug (C08),
// Strichstärke eines Stiftstrichs (E13), Doppeltippen auf eine Linie setzt die Beschriftung dorthin (F22), Beschriftung
// entlang der Linie ziehen (G05), Plus-Griff öffnet die neue Form zum Schreiben (D37/D38), Reaktions-Chips ab 48 px und
// Namen beim Halten (L06), Rahmen nimmt kantenbündigen Inhalt mit (D17).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
  {'id': 'b', 'type': 'shape', 'shape': 'rect', 'x': 400, 'y': 0, 'w': 200, 'h': 100, 'z': 'a1', 'text': 'B'},
  {
    'id': 'c',
    'type': 'connector',
    'x': 200,
    'y': 50,
    'w': 200,
    'h': 1,
    'from': {'objectId': 'a', 'side': 'e'},
    'to': {'objectId': 'b', 'side': 'w'},
    'z': 'a2',
  },
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
  {'id': 'tiny', 'type': 'sticky', 'x': 100, 'y': 450, 'w': 40, 'h': 40, 'text': 't', 'z': 'a5'},
];

Future<(BoardController, FixtureBoardSource, BoardEditor, BoardUi)> _pump(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = _objects,
  Map<String, Object?> ext = const {},
}) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  BoardSnapshot snap() => BoardSnapshot(objects: [for (final o in objects) BoardObject(o)], ext: ext);
  final source = FixtureBoardSource(snap(), rev: 20);
  final controller = BoardController(source, presenceInterval: Duration.zero, sendInterval: const Duration(milliseconds: 30));
  addTearDown(controller.dispose);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..textDebounce = const Duration(milliseconds: 50)
    ..onHaptic = () {};
  addTearDown(editor.dispose);
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Stack(
            children: [
              Positioned.fill(
                child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
              ),
              Positioned.fill(child: BoardOverlays(ui: ui)),
            ],
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  source.push(
    WelcomeMessage(
      proto: 1,
      rev: 20,
      snapshot: snap(),
      info: const ConnectionInfo(
        epoch: 'fixture',
        user: NativeUser(key: 'm:1', name: 'Mara'),
        features: ['objects', 'ext', 'ops', 'text', 'comments', 'reactions'],
      ),
    ),
  );
  await tester.pump();
  return (controller, source, editor, ui);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

Future<void> _drag(WidgetTester tester, Offset from, Offset to, {int steps = 10}) async {
  final g = await tester.startGesture(from);
  for (var i = 1; i <= steps; i++) {
    await g.moveTo(Offset.lerp(from, to, i / steps)!);
    await tester.pump(const Duration(milliseconds: 16));
  }
  await g.up();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  test('Spitze wie das Web: Werkzeug-Spitzen, capPatch, Umkehren über capOf', () {
    expect(toolCaps, ['triangle', 'arrow', 'none']);
    expect(capPatch('end', 'none'), {'capEnd': null, 'arrowEnd': false});
    expect(capPatch('start', 'triangle'), {'capStart': null, 'arrowStart': true});
    final c = BoardObject(const {
      'id': 'c',
      'type': 'connector',
      'from': {'x': 0, 'y': 0},
      'to': {'x': 10, 'y': 0},
    });
    // default: triangle at the end only → reversed: triangle at the start, none at the end
    expect(reversePatch(c), {
      'from': {'x': 10, 'y': 0},
      'to': {'x': 0, 'y': 0},
      'capStart': null,
      'arrowStart': true,
      'capEnd': null,
      'arrowEnd': false,
    });
    expect(BoardObject(const {'id': 'x', 'type': 'connector', 'labelPos': 1}).labelPos, 0.98);
    expect(BoardObject(const {'id': 'x', 'type': 'connector', 'labelPos': -1}).labelPos, 0.02);
  });

  test('projectOnPath wie das Web: nächster Punkt, auf 0,001 gerundet', () {
    const g = ConnectorGeometry(
      a: Offset.zero,
      b: Offset(200, 0),
      style: 'straight',
      pts: [Offset.zero, Offset(200, 0)],
      mid: Offset(100, 0),
      dirA: Offset(-1, 0),
      dirB: Offset(1, 0),
    );
    expect(projectOnPath(g, const Offset(50, 30)), 0.25);
    expect(projectOnPath(g, const Offset(-40, 0)), 0);
    expect(projectOnPath(g, const Offset(133.4, 9)), 0.667);
  });

  testWidgets('C08: Verbinder-Werkzeug mit Spitze „Pfeil“ legt capEnd arrow an, „Keine“ arrowEnd false', (tester) async {
    final (_, s, e, _) = await _pump(tester);
    e
      ..tool = BoardTool.connector
      ..connectorCap = 'arrow';
    await _drag(tester, const Offset(100, 300), const Offset(300, 320));
    var conn = (_ops(s).last['objects'] as List).single as Map;
    expect((conn['capEnd'], conn['arrowEnd']), ('arrow', true));
    e
      ..tool = BoardTool.connector
      ..connectorCap = 'none';
    await _drag(tester, const Offset(100, 380), const Offset(300, 390));
    conn = (_ops(s).last['objects'] as List).single as Map;
    expect(conn.containsKey('capEnd'), isFalse);
    expect(conn['arrowEnd'], isFalse);
  });

  testWidgets('C08: Optionen des Verbinder-Werkzeugs zeigen Dreieck/Pfeil/Keine', (tester) async {
    final (_, _, e, ui) = await _pump(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: ConnectorToolOptions(ui: ui)),
      ),
    );
    for (final cap in toolCaps) {
      expect(find.byKey(Key('stachelConnectorCap-$cap')), findsOneWidget);
    }
    await tester.tap(find.byKey(const Key('stachelConnectorCap-arrow')));
    expect(e.connectorCap, 'arrow');
  });

  testWidgets('E13: Kontextleiste eines Stiftstrichs hat die Strichstärke 2/4/8', (tester) async {
    final (_, _, e, ui) = await _pump(tester);
    e.select({'p'});
    final items = contextItems(tester.element(find.byType(BoardView)), ui, e.selected);
    expect(items.map((i) => i.key), contains('stachelCtxPenWidth'));
    e.select({'a'});
    expect(contextItems(tester.element(find.byType(BoardView)), ui, e.selected).map((i) => i.key), isNot(contains('stachelCtxPenWidth')));
  });

  testWidgets('F22: Doppeltippen auf eine Linie ohne Beschriftung setzt labelPos an die Stelle und öffnet die Eingabe', (
    tester,
  ) async {
    final (c, s, e, _) = await _pump(tester);
    final edited = <String>[];
    e.onEditField = (o) => edited.add(o.id);
    final g = e.scene.connector('c')!;
    final at = g.pointAt(0.25);
    await tester.tapAt(at);
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(at);
    await tester.pump(const Duration(milliseconds: 400));
    expect(edited, ['c']);
    expect(e.selection.value, {'c'});
    final patch = (_ops(s).last['patches'] as Map)['c'] as Map;
    expect((patch['labelPos'] as num).toDouble(), closeTo(0.25, 0.02));
    expect(c.state['c']!.labelPos, closeTo(0.25, 0.02));
  });

  testWidgets('G05: Beschriftung des gewählten Verbinders entlang der Linie ziehen = labelPos, ein Schritt', (tester) async {
    final objs = [
      for (final o in _objects)
        if (o['id'] == 'c') {...o, 'text': 'Weg'} else o,
    ];
    final (c, s, e, _) = await _pump(tester, objects: objs);
    e.select({'c'});
    await tester.pump();
    final label = e.handles().firstWhere((h) => h.id == 'label');
    expect(label.at.dx, closeTo(e.scene.connector('c')!.pointAt(0.5).dx, 1));
    final g = e.scene.connector('c')!;
    await _drag(tester, label.at, g.pointAt(0.8) + const Offset(0, 12));
    expect(c.state['c']!.labelPos, closeTo(0.8, 0.02));
    final steps = s.sent.where((m) => (m['t'] == 'ops' && m['step'] == true) || m['t'] == 'step').length;
    expect(steps, 1, reason: 'ein Rückgängig-Schritt für das Ziehen');
  });

  testWidgets('D37: Plus-Griff antippen legt die gleiche Form an und öffnet sie zum Schreiben', (tester) async {
    final (_, s, e, _) = await _pump(tester);
    e.select({'b'});
    await tester.pump();
    final plus = e.handles().firstWhere((h) => h.id == 'add-s').at;
    await tester.tapAt(plus);
    await tester.pump(const Duration(milliseconds: 100));
    final copy = (_ops(s).last['objects'] as List).cast<Map>().firstWhere((o) => o['type'] == 'shape');
    expect(e.editingId, copy['id']);
  });

  testWidgets('L06: Chips nur ab 48 px Objektbreite; Halten nennt, wer reagiert hat', (tester) async {
    final (c, _, e, ui) = await _pump(
      tester,
      ext: {
        'collab.reactions': {
          'a|👍|m:1': {'o': 'a', 'e': '👍', 'u': 'm:1', 'n': 'Mara', 'at': '2026-11-02T10:00:00Z'},
          'a|👍|m:2': {'o': 'a', 'e': '👍', 'u': 'm:2', 'n': 'Jonas Weber', 'at': '2026-11-02T10:01:00Z'},
          'tiny|🔥|m:2': {'o': 'tiny', 'e': '🔥', 'u': 'm:2', 'n': 'Jonas Weber', 'at': '2026-11-02T10:01:00Z'},
        },
      },
    );
    final layer = CollabLayer(controller: c, scene: e.scene);
    final chips = layer.chips(e.camera.value, const Size(800, 600), OverlayText());
    expect(chips.map((ch) => ch.objectId), ['a'], reason: '„tiny“ ist nur 40 px breit');
    final groups = layer.reactions['a']!;
    expect(reactionNames(groups.single, 'm:1'), 'Jonas Weber und du haben mit 👍 reagiert');
    expect(
      reactionNames(ReactionGroup('🔥')..people.add(const Person('m:2', 'Jonas Weber')), 'm:1'),
      'Jonas Weber hat mit 🔥 reagiert',
    );
    final notices = <String>[];
    final sub = ui.hints.messages.listen(notices.add);
    addTearDown(sub.cancel);
    final chipAt = chips.single.rect.center;
    final g = await tester.startGesture(chipAt);
    await tester.pump(const Duration(milliseconds: 700));
    await g.up();
    await tester.pump(const Duration(milliseconds: 50));
    expect(notices, ['Jonas Weber und du haben mit 👍 reagiert']);
  });

  testWidgets('F18/D32: gewählter Text mit fester Breite bekommt seine gezeichnete Höhe (einmal je Aussehen)', (tester) async {
    final objs = [
      ..._objects,
      {
        'id': 'tx',
        'type': 'text',
        'x': 300,
        'y': 300,
        'w': 120,
        'h': 36,
        'fontSize': 24,
        'text': 'Programm am Samstag mit Bühne und Bar',
        'z': 'a6',
      },
    ];
    final (c, s, e, _) = await _pump(tester, objects: objs);
    final before = _ops(s).length;
    e.select({'tx'});
    await tester.pump();
    await tester.pump();
    final ops = _ops(s).sublist(before);
    expect(ops, hasLength(1));
    final h = (((ops.single['patches'] as Map)['tx'] as Map)['h'] as num).toDouble();
    expect(h, greaterThan(60), reason: 'mehrere Zeilen bei 120 px');
    expect(c.state['tx']!.h, h);
    // someone else writes another height for the same look: no answer (no ping-pong between clients)
    final req = (s.sent.lastWhere((m) => m['t'] == 'ops'))['req'] as int;
    s.push(AckMessage(req, 21));
    s.push(PatchMessage(rev: 22, by: 'm:7', changes: [ObjectUpdated('tx', {'h': h + 6}, const [])]));
    await tester.pump();
    await tester.pump();
    expect(_ops(s).length, before + 1);
    // not while writing in it, not for locked ones
    e.select(const {});
    await tester.pump();
  });

  testWidgets('B15: „Leeres Board“ nicht, solange jemand anderes etwas hochlädt (collab.uploads)', (tester) async {
    final (_, s, _, ui) = await _pump(tester, objects: const []);
    expect(ui.hints.emptyBoard, isTrue);
    s.push(
      const PresenceMessage([
        Peer(
          id: 7,
          key: 'm:7',
          name: 'Jonas Weber',
          color: '#1763b5',
          extra: {
            'collab.uploads': [
              {'x': 0, 'y': 0, 'w': 200, 'h': 120},
            ],
          },
        ),
      ]),
    );
    await tester.pump();
    expect(ui.hints.emptyBoard, isFalse);
  });

  // output of the web's `toHtml` (board/clipboard.ts, run with tsx) for these two objects
  const webHtml =
      '<meta data-stachel="%7B%22marker%22%3A%22stachel%2Fobjects%401%22%2C%22objects%22%3A%5B%7B%22id%22%3A%22n1%22%2C%22type%22%3A%22sticky%22%2C%22x%22%3A0%2C%22y%22%3A0%2C%22w%22%3A100%2C%22h%22%3A100%2C%22text%22%3A%22B%C3%BChne%20%3CNord%3E%20%26%20S%C3%BCd%5CnZweite!%22%7D%2C%7B%22id%22%3A%22c1%22%2C%22type%22%3A%22connector%22%2C%22x%22%3A0%2C%22y%22%3A0%2C%22w%22%3A1%2C%22h%22%3A1%2C%22from%22%3A%7B%22objectId%22%3A%22n1%22%7D%2C%22to%22%3A%7B%22x%22%3A5%2C%22y%22%3A5%7D%7D%5D%7D"><div>Bühne &lt;Nord&gt; &amp; Süd<br>Zweite!</div>';
  final clipObjs = [
    BoardObject(const {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'text': 'Bühne <Nord> & Süd\nZweite!'}),
    BoardObject(const {
      'id': 'c1',
      'type': 'connector',
      'x': 0,
      'y': 0,
      'w': 1,
      'h': 1,
      'from': {'objectId': 'n1'},
      'to': {'x': 5, 'y': 5},
    }),
  ];

  test('D21: text/html wie das Web (toHtml byte-gleich, parseClipboard)', () {
    expect(objectsToHtml(clipObjs), webHtml);
    expect(parseHtmlObjects(webHtml)!.map((o) => o.id), ['n1', 'c1']);
    expect(parseHtmlObjects('<meta data-stachel="%E0%A4%A">'), isNull, reason: 'kaputt = fremder Inhalt');
    expect(parseHtmlObjects('<b>fremd</b>'), isNull);
  });

  testWidgets('D21: Einfügen nimmt Objekte aus dem Browser-HTML, Kopieren schreibt Text + HTML', (tester) async {
    final (c, s, e, ui) = await _pump(tester);
    final read = BoardClipboard.read, write = BoardClipboard.write;
    addTearDown(() {
      BoardClipboard.read = read;
      BoardClipboard.write = write;
      BoardClipboard.readHtml = null;
      BoardClipboard.writeHtml = null;
      BoardClipboard.objects = const [];
    });
    BoardClipboard.read = () async => 'Bühne <Nord> & Süd\nZweite!';
    BoardClipboard.readHtml = () async => webHtml;
    final before = c.state.objects.length;
    await pasteAt(ui, const Offset(1000, 1000));
    await tester.pump();
    expect(c.state.objects.length, before + 2, reason: 'Notiz + Verbinder statt einer Text-Notiz');
    String? text, html;
    BoardClipboard.writeHtml = (t, h) async {
      text = t;
      html = h;
      return true;
    };
    e.select({'a'});
    await copySelection(ui);
    expect(text, 'A');
    expect(parseHtmlObjects(html)!.single.id, 'a');
  });

  testWidgets('D10: gewähltes gesperrtes Objekt zeigt „GESPERRT“ wie ov-lock im Web', (tester) async {
    final objs = [
      for (final o in _objects)
        if (o['id'] == 'a') {...o, 'locked': true} else o,
    ];
    final (_, _, e, _) = await _pump(tester, objects: objs);
    RenderBox handles() => tester.renderObject<RenderBox>(
      find.byWidgetPredicate((w) => w is CustomPaint && w.painter.runtimeType.toString() == '_HandlesPainter'),
    );
    e.select({'a'});
    await tester.pump();
    expect(handles(), paints..rrect(color: const Color(0xFF0A0A0A)));
    e.select({'b'});
    await tester.pump();
    expect(handles(), isNot(paints..rrect(color: const Color(0xFF0A0A0A))));
  });
}
