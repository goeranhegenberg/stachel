// F2 (parity audit §4 Welle 0): registries like the web (order, replace, all packages registered), the phone tool bar
// (≤ 9 buttons, „···“ with the active tool's icon), the context bar with overflow „Weitere Aktionen“ and popovers that
// a new selection closes, menus (object / empty board / board, submenus), gestures (300 ms grab, 500 ms object menu),
// multi-selection (switch, reduce to a group, drill into a group, units), tools once vs. staying, feature tools and
// type behavior from the registry, the hint service (connection lost after 1.5 s, „Wieder verbunden“, „Von … gelöscht“,
// empty board).

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
  void handleStart(String handle, Offset p) => events.add('handleStart');
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
  void drawEnd(Offset p, {required bool moved}) => events.add('drawEnd');
  @override
  void drawCancel() => events.add('drawCancel');
}

Duration ms(int v) => Duration(milliseconds: v);

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'},
  {'id': 'g1', 'type': 'sticky', 'x': 0, 'y': 300, 'w': 100, 'h': 100, 'z': 'a2', 'groupId': 'G'},
  {'id': 'g2', 'type': 'sticky', 'x': 150, 'y': 300, 'w': 100, 'h': 100, 'z': 'a3', 'groupId': 'G'},
  {'id': 'lock', 'type': 'sticky', 'x': 400, 'y': 300, 'w': 100, 'h': 100, 'z': 'a4', 'locked': true},
  {
    'id': 'c',
    'type': 'connector',
    'from': {'objectId': 'a', 'side': 'e'},
    'to': {'x': 600, 'y': 100},
    'z': 'a5',
  },
];

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui, this.menus);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final List<(String, MenuAt)> menus;
  BoardViewState get view => ui.view!;
}

/// The board with the registries: view, context bar and tool bar like the app's screen (menus are recorded).
Future<_Board> _pump(
  WidgetTester tester, {
  Size size = const Size(800, 600),
  BoardRegistry? registry,
  List<Map<String, Object?>> objects = _objects,
  bool showMenus = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(BoardSnapshot.fromJson({'objects': objects}), rev: 20);
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: registry ?? standardBoardRegistry());
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  final menus = <(String, MenuAt)>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Builder(
            builder: (context) => Column(
              children: [
                Expanded(
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: BoardView(
                          key: ui.viewKey,
                          controller: controller,
                          editor: editor,
                          fitOnLoad: false,
                          onLongPress: (w) => showMenus
                              ? showBoardMenu(context, ui, MenuTarget.canvas, MenuAt(w))
                              : menus.add(('canvas', MenuAt(w))),
                          onObjectMenu: (w, id) => showMenus
                              ? showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id))
                              : menus.add(('object', MenuAt(w, objectId: id))),
                        ),
                      ),
                      Positioned(
                        left: 8,
                        right: 8,
                        bottom: 8,
                        child: ListenableBuilder(
                          listenable: Listenable.merge([editor, controller]),
                          builder: (context, _) => BoardContextBar(ui: ui),
                        ),
                      ),
                    ],
                  ),
                ),
                ListenableBuilder(
                  listenable: Listenable.merge([editor, controller]),
                  builder: (context, _) => BoardToolbar(ui: ui, enabled: editor.editable),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _Board(controller, source, editor, ui, menus);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

class _Entry implements RegistryEntry {
  const _Entry(this.id, this.order, [this.tag = '']);
  @override
  final String id;
  @override
  final double order;
  final String tag;
}

ToolDef _tool(String id, double order, {ToolPlace phone = ToolPlace.bar}) =>
    ToolDef(id: id, label: id, icon: Icons.circle, order: order, phone: phone, tool: BoardTool.select);

void main() {
  group('Register', () {
    test('Reihenfolge nach order, bei Gleichstand wie definiert; gleiche id ersetzt an ihrem Platz; entfernen', () {
      final r = Registry<_Entry>()
        ..define(const _Entry('b', 20))
        ..define(const _Entry('a', 10))
        ..define(const _Entry('c', 20))
        ..define(const _Entry('b', 20, 'neu'));
      expect([for (final e in r.list()) e.id], ['a', 'b', 'c']);
      expect(r['b']!.tag, 'neu');
      r.remove('a');
      expect([for (final e in r.list()) e.id], ['b', 'c']);
    });

    test(
      'alle Pakete sind eingetragen: Kern-Werkzeuge in Web-Reihenfolge, Typen, Menüs aller drei Ziele, Gesten-Blatt',
      () {
        final r = standardBoardRegistry();
        // the core's and mind map's tools in web order (packages add theirs in between, P3: structure.blocks, templates)
        const core = [
          'select',
          'sticky',
          'text',
          'shape',
          'connector',
          'pen',
          'eraser',
          'frame',
          'structure.mindmap',
          'shapes.sticker', // P2
        ];
        expect([
          for (final t in r.tools.list())
            if (core.contains(t.id)) t.id,
        ], core);
        expect(r.types.length, 14);
        expect(r.typeOf('sticky')!.label, 'Haftnotiz');
        for (final on in MenuTarget.values) {
          expect(r.menuItems.list().where((m) => m.on == on), isNotEmpty, reason: '$on');
        }
        expect(r.sheets[gesturesSheet], isNotNull);
        expect(r.deleteGuards, hasLength(1), reason: 'Mindmap fragt beim Löschen mit Unterthemen');
        // the order of the context bar like the web (core 10–90, packages in between)
        final ids = [for (final a in r.contextActions.list()) a.id];
        expect(ids.indexOf('core.color'), lessThan(ids.indexOf('core.font')));
        expect(ids.indexOf('structure.mind'), lessThan(ids.indexOf('core.common')));
        expect(ids.last, 'tools.copyLink');
      },
    );

    test('Handy-Leiste: höchstens 9, sonst 8 + „···“; „more“-Werkzeuge ans Ende, „hide“ nie', () {
      final nine = [for (var i = 0; i < 9; i++) _tool('t$i', i * 10.0)];
      expect(phoneToolBar(nine).more, isEmpty);
      final tools = [_tool('rare', 1, phone: ToolPlace.more), for (var i = 0; i < 9; i++) _tool('t$i', 10.0 + i)];
      final bar = phoneToolBar(tools);
      expect(bar.shown.map((t) => t.id), ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']);
      expect(bar.more.map((t) => t.id), ['t8', 'rare']);
      expect(phoneToolBar([_tool('x', 1, phone: ToolPlace.hide)]).shown, isEmpty);
    });

    test('fitCount wie im Web: alles passt → alle, sonst so viele, wie neben „···“ passen', () {
      expect(fitCount([48, 48, 48], 200), 3);
      expect(fitCount([48, 48, 48, 48, 48], 200), 3);
      expect(fitCount([48, 48, 48, 48, 48], 100), 1);
      expect(fitCount([], 10), 0);
    });
  });

  group('Gesten (D41)', () {
    late _Log log;
    late BoardGestures g;
    setUp(() {
      log = _Log();
      g = BoardGestures(log);
    });

    test('Objekt 500 ms still halten: bei 300 ms gegriffen, bei 500 ms Menü (Griff ohne Änderung beendet)', () {
      log.hit = (_) => const GestureHit(objectId: 'a', movable: true);
      g.down(1, Offset.zero, ms(0));
      expect(g.deadline, ms(300));
      g.timeout(ms(300));
      expect(g.deadline, ms(500), reason: 'zweite Frist: Menü');
      g.move(1, const Offset(5, 0), ms(400)); // zittern unter 8 px zählt nicht
      g.timeout(ms(500));
      g.up(1, ms(700));
      expect(log.events, ['dragStart:a:true', 'dragEnd', 'objectMenu:a']);
    });

    test('nach dem Greifen bewegt → verschieben, kein Menü', () {
      log.hit = (_) => const GestureHit(objectId: 'a', movable: true);
      g.down(1, Offset.zero, ms(0));
      g.timeout(ms(300));
      g.move(1, const Offset(30, 0), ms(350));
      expect(g.deadline, isNull);
      g.timeout(ms(500));
      g.up(1, ms(600));
      expect(log.events, ['dragStart:a:true', 'drag', 'dragEnd']);
    });

    test('gesperrt bzw. nur lesen: kein Greifen, aber das Menü nach 500 ms; leere Fläche wie bisher', () {
      log.hit = (_) => const GestureHit(objectId: 'lock');
      g.down(1, Offset.zero, ms(0));
      expect(g.deadline, ms(500));
      g.timeout(ms(500));
      g.up(1, ms(600));
      expect(log.events, ['objectMenu:lock']);

      log.events.clear();
      log.editable = false;
      log.hit = (_) => const GestureHit(objectId: 'a', movable: true);
      g.down(1, Offset.zero, ms(1000));
      g.timeout(ms(1500));
      g.up(1, ms(1600));
      expect(log.events, ['objectMenu:a']);

      log.events.clear();
      log.editable = true;
      log.hit = (_) => GestureHit.empty;
      g.down(1, Offset.zero, ms(2000));
      g.timeout(ms(2300));
      expect(g.deadline, isNull, reason: 'leere Fläche: Menü erst beim Loslassen (Rechteck beim Ziehen)');
      g.up(1, ms(2700));
      expect(log.events, ['menu']);
    });

    testWidgets('im Board: 600 ms halten auf einem nicht gewählten Objekt → wählt es samt Gruppe, Objekt-Menü', (
      tester,
    ) async {
      final b = await _pump(tester);
      b.editor.select({'a'});
      await tester.pump();
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      final g = await tester.startGesture(box.localToGlobal(b.view.camera.value.toScreen(const Offset(50, 350))));
      await tester.pump(ms(350));
      await tester.pump(ms(250));
      await g.up();
      await tester.pump();
      expect(b.menus.single.$1, 'object');
      expect(b.menus.single.$2.objectId, 'g1');
      expect(b.editor.selection.value, {'g1', 'g2'});
      expect(b.view.selectionBeforeMenu, {'a'});
      expect(_ops(b.source), isEmpty, reason: 'Halten ohne Bewegung ändert nichts');
    });
  });

  group('Auswahl (D02–D04)', () {
    testWidgets('Mehrfachauswahl-Schalter: Tippen nimmt Gruppen hinzu/heraus; Tippen ins Leere beendet', (
      tester,
    ) async {
      final b = await _pump(tester);
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      Future<void> tapWorld(Offset w) async {
        await tester.tapAt(box.localToGlobal(b.view.camera.value.toScreen(w)));
        await tester.pump(ms(350));
      }

      await tapWorld(const Offset(50, 50));
      expect(b.editor.selection.value, {'a'});
      await tester.tap(find.byKey(const Key('stachelMultiSelect')));
      await tester.pump();
      expect(b.editor.multiSelect, isTrue);
      await tapWorld(const Offset(50, 350));
      expect(b.editor.selection.value, {'a', 'g1', 'g2'});
      expect(find.text('3 Objekte'), findsOneWidget);
      await tapWorld(const Offset(200, 350));
      expect(b.editor.selection.value, {'a'}, reason: 'Gruppe wieder heraus');
      await tapWorld(const Offset(700, 250));
      expect(b.editor.selection.value, isEmpty);
      expect(b.editor.multiSelect, isFalse);
    });

    testWidgets(
      'Tippen in eine Mehrfachauswahl reduziert auf die Gruppe; Doppeltippen in die Gruppe wählt ein Mitglied',
      (tester) async {
        final b = await _pump(tester);
        final box = tester.renderObject<RenderBox>(find.byType(BoardView));
        b.editor.select({'a', 'g1', 'g2'});
        await tester.pump();
        await tester.tapAt(box.localToGlobal(b.view.camera.value.toScreen(const Offset(50, 350))));
        await tester.pump(ms(350));
        expect(b.editor.selection.value, {'g1', 'g2'});
        expect(b.editor.isWholeGroup, isTrue);
        final p = box.localToGlobal(b.view.camera.value.toScreen(const Offset(200, 350)));
        await tester.tapAt(p);
        await tester.pump(ms(50));
        await tester.tapAt(p);
        await tester.pump(ms(350));
        expect(b.editor.selection.value, {'g2'});
      },
    );

    testWidgets('Einheiten fürs Ausrichten: Gruppe = eine, ohne Verbinder und Gesperrte', (tester) async {
      final b = await _pump(tester);
      b.editor.select({'a', 'g1', 'g2', 'lock', 'c'});
      expect(b.editor.units().keys.toSet(), {'a', 'g:G'});
      expect(b.editor.units()['g:G']!.map((o) => o.id).toSet(), {'g1', 'g2'});
    });

    testWidgets('Werkzeugwechsel hebt die Auswahl auf (außer Auswahl); Notiz ist einmalig, Stift bleibt (C19)', (
      tester,
    ) async {
      final b = await _pump(tester);
      b.editor.select({'a'});
      b.editor.useTool('select');
      expect(b.editor.selection.value, {'a'});
      b.editor.useTool('sticky');
      expect(b.editor.selection.value, isEmpty);
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      await tester.tapAt(box.localToGlobal(const Offset(600, 100)));
      await tester.pump(ms(350));
      expect(b.editor.tool, BoardTool.select, reason: 'einmalig');
      b.editor.finishEditingForTest();
      expect(b.ui.registry.tools['pen']!.once, isFalse);
    });
  });

  group('Werkzeuge und Typen aus dem Register', () {
    testWidgets(
      'Feature-Werkzeug: Tippen geht an sein Verhalten, danach Auswahl (einmalig); zeichnende Werkzeuge zeichnen',
      (tester) async {
        final taps = <Offset>[];
        final drawn = <String>[];
        final r = standardBoardRegistry()
          ..defineTool(
            ToolDef(
              id: 'test.stamp',
              label: 'Stempel',
              icon: Icons.star,
              order: 85,
              phone: ToolPlace.more,
              behavior: BoardToolBehavior(onTap: (e) => taps.add(e.world)),
              hint: (_) => 'Tippe für einen Stempel.',
            ),
          )
          ..defineTool(
            ToolDef(
              id: 'test.laser',
              label: 'Laser',
              icon: Icons.highlight,
              order: 112,
              once: false,
              behavior: BoardToolBehavior(
                draws: true,
                onDrawStart: (e) => drawn.add('start'),
                onDrawUpdate: (e) => drawn.add('move'),
                onDrawEnd: (e) => drawn.add('end:${e.moved}'),
              ),
            ),
          );
        final b = await _pump(tester, registry: r);
        b.editor.useTool('test.stamp');
        expect(
          (b.editor.tool, b.editor.featureTool, b.editor.activeToolId),
          (BoardTool.feature, 'test.stamp', 'test.stamp'),
        );
        expect(activeToolHint(b.ui), 'Tippe für einen Stempel.');
        final box = tester.renderObject<RenderBox>(find.byType(BoardView));
        await tester.tapAt(box.localToGlobal(const Offset(600, 100)));
        await tester.pump(ms(350));
        expect(taps, hasLength(1));
        expect(b.editor.tool, BoardTool.select);

        b.editor.useTool('test.laser');
        await tester.dragFrom(box.localToGlobal(const Offset(600, 100)), const Offset(80, 40));
        await tester.pump();
        expect(drawn.first, 'start');
        expect(drawn.last, 'end:true');
        expect(b.editor.featureTool, 'test.laser', reason: 'bleibend');
      },
    );

    testWidgets('Typ-Verhalten: eigenes Tippen ersetzt das Auswählen; eigene Griffe', (tester) async {
      final tapped = <String>[];
      final r = standardBoardRegistry()
        ..defineType(
          TypeBehavior(
            type: 'sticky',
            label: 'Haftnotiz',
            onTap: (e) {
              tapped.add(e.object.id);
              return e.object.id == 'a';
            },
            handles: (o) => const ['se', 'add-e'],
          ),
        );
      final b = await _pump(tester, registry: r);
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      await tester.tapAt(box.localToGlobal(b.view.camera.value.toScreen(const Offset(50, 50))));
      await tester.pump(ms(350));
      expect(tapped, ['a']);
      expect(b.editor.selection.value, isEmpty, reason: 'vom Typ behandelt');
      b.editor.select({'a'});
      expect(b.editor.handles().map((h) => h.id), ['se', 'add-e']);
    });
  });

  group('Werkzeugleiste und Kontextleiste', () {
    testWidgets('Leiste: mehr als 9 Werkzeuge → „···“ mit Namen-Blatt; aktives Werkzeug dort ersetzt das Symbol', (
      tester,
    ) async {
      final r = standardBoardRegistry();
      for (final (i, id) in ['x.one', 'x.two'].indexed) {
        r.defineTool(
          ToolDef(
            id: id,
            label: 'Extra $i',
            icon: Icons.extension,
            order: 90.0 + i,
            behavior: const BoardToolBehavior(),
            keyName: 'tool-$id',
          ),
        );
      }
      final b = await _pump(tester, size: const Size(390, 760), registry: r);
      expect(find.byKey(const Key('stachelToolMore')), findsOneWidget);
      expect(find.text('MEHR'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelToolMore')));
      await tester.pumpAndSettle();
      expect(find.text('WEITERE WERKZEUGE'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelMindEmpty')));
      await tester.pumpAndSettle();
      expect(b.editor.tool, BoardTool.mindmap);
      expect(find.text('MINDMAP'), findsOneWidget, reason: 'aktives Werkzeug hinter „···“ zeigt sich dort');
      expect(find.text('MEHR'), findsNothing);
    });

    testWidgets('schmal: Überlauf „Weitere Aktionen“ mit denselben Einträgen; breit: alles in der Leiste', (
      tester,
    ) async {
      final b = await _pump(tester, size: const Size(360, 700));
      b.editor.select({'a'});
      await tester.pump();
      expect(find.byKey(const Key('stachelCtxMore')), findsOneWidget);
      // UX P4: Löschen is a labeled core action in the row; the rest (Ebene, Schrift …) lies behind „Mehr“
      expect(find.byKey(const Key('stachelCtxDelete')), findsOneWidget);
      expect(find.byKey(const Key('stachelCtxFront')), findsNothing, reason: 'liegt hinter „Mehr“');
      await tester.tap(find.byKey(const Key('stachelCtxMore')));
      await tester.pumpAndSettle();
      expect(find.text('WEITERE AKTIONEN'), findsOneWidget);
      // the packages (P1, P2 …) fill the sheet – „Nach vorne“ may lie below the fold
      await tester.ensureVisible(find.byKey(const Key('stachelCtxFront')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelCtxFront')));
      await tester.pumpAndSettle();
      expect(_ops(b.source).last['op'], isNot('remove'));
      await tester.tap(find.byKey(const Key('stachelCtxDelete')));
      await tester.pumpAndSettle();
      expect(_ops(b.source).last['op'], 'remove');

      final wide = await _pump(tester, size: const Size(1200, 700));
      wide.editor.select({'a'});
      await tester.pump();
      expect(find.byKey(const Key('stachelCtxMore')), findsNothing);
      expect(find.byKey(const Key('stachelCtxDelete')), findsOneWidget);
    });

    testWidgets('Auswahlwechsel schließt ein offenes Popover-Blatt (D44)', (tester) async {
      final b = await _pump(tester);
      b.editor.select({'a'});
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCtxColor')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelColor-#9fd3ff')), findsOneWidget);
      b.editor.select({'g1', 'g2'});
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelColor-#9fd3ff')), findsNothing);
      expect(_ops(b.source), isEmpty);
    });

    testWidgets('gesperrt: nur was ohne Ändern geht (Link), Hinweis „gesperrt“', (tester) async {
      final b = await _pump(tester);
      b.editor.select({'lock'});
      await tester.pump();
      expect(find.textContaining('gesperrt'), findsOneWidget);
      expect(find.byKey(const Key('stachelCtxColor')), findsNothing);
      expect(find.byKey(const Key('stachelObjectLink')), findsOneWidget);
    });
  });

  group('Menüs (D42, D43, B09)', () {
    testWidgets('leere Fläche: „Haftnotiz hier“ … Alles auswählen, Alles einpassen, Rückgängig/Wiederholen', (
      tester,
    ) async {
      final b = await _pump(tester, showMenus: true);
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      final g = await tester.startGesture(box.localToGlobal(const Offset(700, 500)));
      await tester.pump(ms(700));
      await g.up();
      await tester.pumpAndSettle();
      for (final k in [
        'stachelHereSticky',
        'stachelHereText',
        'stachelHereMindmap',
        'stachelSelectAll',
        'stachelFitAll',
        'stachelMenuUndo',
        'stachelMenuRedo',
      ]) {
        expect(find.byKey(Key(k)), findsOneWidget, reason: k);
      }
      await tester.tap(find.byKey(const Key('stachelSelectAll')));
      await tester.pumpAndSettle();
      expect(b.editor.selection.value, containsAll(['a', 'g1', 'g2', 'lock', 'c']));
    });

    testWidgets('Objekt: Untermenü „Ebene“ klappt auf; „Zur Auswahl hinzufügen“ ergänzt die vorige Auswahl', (
      tester,
    ) async {
      final b = await _pump(tester, showMenus: true);
      b.editor.select({'a'});
      await tester.pump();
      final box = tester.renderObject<RenderBox>(find.byType(BoardView));
      final g = await tester.startGesture(box.localToGlobal(b.view.camera.value.toScreen(const Offset(50, 350))));
      await tester.pump(ms(350));
      await tester.pump(ms(250));
      await g.up();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelObjectMenu')), findsOneWidget);
      expect(find.byKey(const Key('stachelMenuFront')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelMenuLayer')));
      await tester.pump();
      expect(find.byKey(const Key('stachelMenuFront')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelMenuAddToSelection')));
      await tester.pumpAndSettle();
      expect(b.editor.selection.value, {'a', 'g1', 'g2'});
      expect(b.editor.multiSelect, isTrue);
    });

    test('Board-Menü in Web-Reihenfolge (Link, Browser, 100 %, Gesten)', () {
      final r = standardBoardRegistry();
      // the packages add their entries in between (P4: search, grid, hide UI, fullscreen, settings …): the core ones
      // keep their web order
      const core = ['tools.boardLink', 'app.browser', 'view.zoom100', 'core.gestures'];
      expect([
        for (final m in r.menuItems.list())
          if (m.on == MenuTarget.board && core.contains(m.id)) m.id,
      ], core);
    });
  });

  group('Hinweise (B06, B15, F21)', () {
    testWidgets('Verbindung weg: erst nach 1,5 s; zurück: „Wieder verbunden“ 3,2 s; kurze Lücke bleibt still', (
      tester,
    ) async {
      final b = await _pump(tester);
      final h = b.ui.hints;
      b.source.drop();
      await tester.pump(ms(1000));
      expect(h.connectionLost, isFalse);
      await b.source.open();
      await tester.pump();
      expect(h.reconnected, isFalse, reason: 'kurze Lücke: nichts');
      b.source.drop();
      await tester.pump(ms(1600));
      expect(h.connectionLost, isTrue);
      await b.source.open();
      await tester.pump();
      expect((h.connectionLost, h.reconnected), (false, true));
      expect(find.text(BoardHintTexts.reconnected), findsNothing, reason: 'die Pille zeigt die App (BoardStatusHints)');
      await tester.pump(ms(3300));
      expect(h.reconnected, isFalse);
    });

    testWidgets('bearbeitete Notiz von anderen gelöscht → „Von Jonas gelöscht“', (tester) async {
      final b = await _pump(tester);
      final said = <String>[];
      b.ui.hints.messages.listen(said.add);
      b.source.push(
        const PresenceMessage([
          Peer(id: 2, key: 'm:7', name: 'Jonas', color: '#ec4e92', selection: ['a']),
        ]),
      );
      await tester.pump();
      expect(b.view.editText('a'), isTrue);
      await tester.pump();
      b.source.push(PatchMessage(rev: 21, by: 'm:7', changes: [const ObjectRemoved('a')]));
      await tester.pump();
      await tester.pump();
      expect(said, ['Von Jonas gelöscht']);
      expect(b.editor.editingId, isNull);
    });

    testWidgets('leeres Board: „Leeres Board. Doppeltippen …“', (tester) async {
      final b = await _pump(tester, objects: const []);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: BoardStatusHints(ui: b.ui)),
        ),
      );
      expect(find.text(BoardHintTexts.emptyBoard), findsOneWidget);
    });
  });
}

extension on BoardEditor {
  /// Ends writing in a note the sticky tool started (test helper).
  void finishEditingForTest() => stopEditing();
}
