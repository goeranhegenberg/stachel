// P9 in the board UI (parity audit C15, E19, I16–I23): the structure tool's fourth kind places a timeline like the web's
// `newTimeline`; the context bar (Zeitskala, Spur/Eintrag hinzufügen, with an active item Farbe/Meilenstein/Dialog/
// Löschen), dragging items and their ends (snapped to days, the lane follows), the dialog, the object menu on items and
// lanes, double taps, „‹ n“, the side handles (range) and notes dropped onto a lane – each as web action `timeline.*`
// with a local preview (`predicted`).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/timeline/timeline_model.dart';
import 'package:stachel_board/src/features/timeline/timeline_state.dart';

final _actions = <String, int>{
  for (final n in [
    'addItem',
    'patchItem',
    'setDay',
    'removeItem',
    'setTitle',
    'addLane',
    'setLaneName',
    'moveLane',
    'removeLane',
    'setRange',
    'setUnit',
    'adopt',
  ])
    'timeline.$n': 1,
};

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  TimelineState get st => TimelineState.of(editor);
}

Future<_Board> _pump(WidgetTester tester, {List<Map<String, Object?>> objects = const []}) async {
  tester.view.physicalSize = const Size(1400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: _actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
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
                          onObjectMenu: (w, id) =>
                              showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id)),
                        ),
                      ),
                      Positioned.fill(child: BoardOverlays(ui: ui)),
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
  return _Board(controller, source, editor, ui);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

List<Map<String, Object?>> _acts(FixtureBoardSource s, String name) => [
  for (final o in _ops(s))
    if (o['op'] == 'act' && o['name'] == name) o,
];

/// Timeline at (100, 60), 8 weeks from Monday 2.11.2026 (week: 18 per day, scale 1): lanes l1/l2/l3, item `a`
/// (4.–10.11. in l1), milestone `m` (5.11. in l2), one item before the range.
Map<String, Object?> _timeline({bool locked = false}) {
  final data = {
    'lanes': ['l1', 'l2', 'l3'],
    'names': {'l1': 'Aufbau', 'l2': 'Programm', 'l3': ''},
    'items': {
      'a': {'lane': 'l1', 'start': '2026-11-04', 'end': '2026-11-10', 'title': 'Bühne'},
      'm': {'lane': 'l2', 'start': '2026-11-05', 'end': '2026-11-05', 'title': 'Ein', 'ms': true},
      'old': {'lane': 'l3', 'start': '2026-10-01', 'end': '2026-10-02', 'title': 'Vorab'},
    },
  };
  final l = tlLayoutOf(safeTimeline(data), TlRange(tlParseDay('2026-11-02')!, tlParseDay('2026-12-27')!), 'week');
  return {
    'id': 't1',
    'type': 'timeline',
    'x': 100,
    'y': 60,
    'w': l.w0,
    'h': l.h0,
    'z': 'a1',
    'tlStart': '2026-11-02',
    'tlEnd': '2026-12-27',
    'timeline': data,
    if (locked) 'locked': true,
  };
}

TlLayout _layout(_Board b) => tlLayoutFor(b.controller.state['t1']!.raw, tlToday());

/// Screen point of the inner point ([lx], [ly]) of `t1` (camera at 0/0, zoom 1, scale 1).
Offset _at(_Board b, double lx, double ly) {
  final o = b.controller.state['t1']!;
  return Offset(o.x + lx, o.y + ly);
}

Map<String, Object?> _args(Map<String, Object?> op) => (op['args']! as Map).cast<String, Object?>();

void main() {
  testWidgets('Werkzeug: vierte Art „Zeitleiste“ legt sie wie newTimeline an (Spur 1–3, 8 Wochen ab Montag), gewählt', (
    tester,
  ) async {
    final b = await _pump(tester);
    await tester.tap(find.byKey(const Key('stachelToolMore')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelMoreBlocks')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelBlocks-timeline')));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(700, 300));
    await tester.pump();
    final create = _ops(b.source).firstWhere((o) => o['op'] == 'create');
    final o = ((create['objects']! as List).single as Map).cast<String, Object?>();
    final want = tlNewTimeline(700, 300, tlToday());
    expect({...o}..remove('id'), want);
    expect(o['tlStart'], tlFmtDay(tlMondayOf(tlToday())));
    expect(b.editor.selection.value, {o['id']});
  });

  testWidgets('Kontextleiste: Zeitskala, Spur hinzufügen (Name an Ort und Stelle), Eintrag hinzufügen (heute)', (
    tester,
  ) async {
    final today = tlToday();
    final t = {'id': 't1', 'z': 'a1', ...tlNewTimeline(600, 300, today)};
    final b = await _pump(tester, objects: [t]);
    b.editor.select({'t1'});
    await tester.pump();
    // Zeitskala → Monat (Vorschau: Größe neu bei gleichem Maßstab)
    await tester.tap(find.byKey(const Key('stachelTlUnit')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelTlUnit-month')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.setUnit').single), {'id': 't1', 'unit': 'month'});
    final shown = b.controller.state['t1']!;
    expect(shown.raw['tlUnit'], 'month');
    expect(shown.w, tlLayoutFor({...t, 'tlUnit': 'month'}, today).w0);
    // Spur hinzufügen: am Ende, gleich benennen (live mit Basis)
    await tester.tap(find.byKey(const Key('stachelTlLaneAdd')));
    await tester.pump();
    final add = _acts(b.source, 'timeline.addLane').single;
    expect(_args(add), {'id': 't1'});
    final lane = '${add['key']}-1';
    expect((b.controller.state['t1']!.raw['timeline']! as Map)['lanes'], ['l1', 'l2', 'l3', lane]);
    expect(find.byKey(const Key('stachelTlLaneName')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTlLaneName')), 'Technik');
    await tester.pump(const Duration(milliseconds: 400));
    expect(_args(_acts(b.source, 'timeline.setLaneName').single), {
      'id': 't1',
      'lane': lane,
      'base': '',
      'text': 'Technik',
    });
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(find.byKey(const Key('stachelTlLaneName')), findsNothing);
    // Eintrag hinzufügen (heute): Standardlänge der Skala (Monat: 14 Tage), in der aktiven (neuen) Spur wie im Web,
    // Titel gleich schreiben
    await tester.tap(find.byKey(const Key('stachelTlItemAdd')));
    await tester.pump();
    final item = _acts(b.source, 'timeline.addItem').single;
    final l = tlLayoutFor(b.controller.state['t1']!.raw, today);
    final (a, e) = tlNewItemSpan(l, null, today);
    expect(_args(item), {'id': 't1', 'lane': lane, 'start': tlFmtDay(a), 'end': tlFmtDay(e)});
    expect(b.st.activeItem('t1'), '${item['key']}-1');
    expect(find.byKey(const Key('stachelTlTitleInline')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTlTitleInline')), 'Aufbau Bühne');
    await tester.pump(const Duration(milliseconds: 400));
    expect(_args(_acts(b.source, 'timeline.setTitle').single), {
      'id': 't1',
      'key': '${item['key']}-1',
      'base': '',
      'text': 'Aufbau Bühne',
    });
  });

  testWidgets('Eintrag: antippen = aktiv (Leiste: Farbe, Meilenstein, Dialog, Löschen), ziehen auf Tage, Spur folgt', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_timeline()]);
    b.editor.select({'t1'});
    await tester.pump();
    expect(find.byKey(const Key('stachelTlColor')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelTlItem-a')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.st.activeItem('t1'), 'a');
    expect(find.byKey(const Key('stachelTlActive')), findsOneWidget);
    expect(find.byKey(const Key('stachelTlColor')), findsOneWidget);
    // Meilenstein umschalten (wie im Web: Ende = Anfang)
    await tester.tap(find.byKey(const Key('stachelTlMs')));
    await tester.pump();
    expect(_args(_acts(b.source, 'timeline.patchItem').last), {'id': 't1', 'key': 'a', 'ms': true});
    final shown = (b.controller.state['t1']!.raw['timeline']! as Map)['items'] as Map;
    expect(shown['a'], containsPair('ms', true));
    expect(shown['a'], containsPair('end', '2026-11-04'));
  });

  testWidgets('Ziehen: Eintrag um 2 Tage und eine Spur tiefer, Ende am Griff (44 px), Meilenstein nur verschieben', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_timeline()]);
    b.editor.select({'t1'});
    await tester.pump();
    final l = _layout(b);
    final lane1 = l.lanes[0];
    // 2 Tage = 36 px, eine Spur tiefer
    await tester.drag(find.byKey(const Key('stachelTlItem-a')), Offset(2 * 18 + 3, lane1.h), touchSlopY: 0);
    await tester.pump();
    var p = _args(_acts(b.source, 'timeline.patchItem').last);
    expect(p, {'id': 't1', 'key': 'a', 'start': '2026-11-06', 'end': '2026-11-12', 'lane': 'l2'});
    // das Ende am Griff des aktiven Balkens: 3 Tage länger
    expect(b.st.activeItem('t1'), 'a');
    await tester.pump();
    await tester.drag(find.byKey(const Key('stachelTlGrip-end')), const Offset(3 * 18, 0), touchSlopY: 0);
    await tester.pump();
    p = _args(_acts(b.source, 'timeline.patchItem').last);
    expect(p, {'id': 't1', 'key': 'a', 'start': '2026-11-06', 'end': '2026-11-15'});
    // Meilenstein: ziehen verschiebt nur
    await tester.drag(find.byKey(const Key('stachelTlItem-m')), const Offset(-36, 0), touchSlopY: 0);
    await tester.pump();
    p = _args(_acts(b.source, 'timeline.patchItem').last);
    expect(p, {'id': 't1', 'key': 'm', 'start': '2026-11-03', 'end': '2026-11-03'});
    await tester.pump(const Duration(milliseconds: 500));
  });

  testWidgets('Langes Drücken auf einen Eintrag: Dialog mit Titel live, Spur, Meilenstein, Farbe, Löschen', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_timeline()]);
    b.editor.select({'t1'});
    await tester.pump();
    await tester.longPress(find.byKey(const Key('stachelTlItem-a')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTlDialog')), findsOneWidget);
    expect(find.text('EINTRAG'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTlTitle')), 'Bühne bauen');
    await tester.pump(const Duration(milliseconds: 400));
    expect(_args(_acts(b.source, 'timeline.setTitle').single), {
      'id': 't1',
      'key': 'a',
      'base': 'Bühne',
      'text': 'Bühne bauen',
    });
    await tester.tap(find.byKey(const Key('stachelTlLane')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Programm').last);
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.patchItem').last), {'id': 't1', 'key': 'a', 'lane': 'l2'});
    await tester.tap(find.byKey(const Key('stachelTlColor-#ec4e92')));
    await tester.pump();
    expect(_args(_acts(b.source, 'timeline.patchItem').last), {'id': 't1', 'key': 'a', 'color': '#ec4e92'});
    await tester.tap(find.byKey(const Key('stachelTlMsCheck')));
    await tester.pump();
    expect(_args(_acts(b.source, 'timeline.patchItem').last), {'id': 't1', 'key': 'a', 'ms': true});
    expect(find.text('MEILENSTEIN'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTlDelete')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.removeItem').single), {'id': 't1', 'key': 'a'});
    expect(find.byKey(const Key('stachelTlDialog')), findsNothing);
  });

  testWidgets('Objekt-Menü: auf Spur „Eintrag hier anlegen“/„Spur nach unten“/„Spur löschen“, auf Eintrag Farbe', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_timeline()]);
    b.editor.select({'t1'});
    await tester.pump();
    final l = _layout(b);
    final ctx = tester.element(find.byType(BoardView));
    // Spur 3, Tag 10 (12.11.)
    final lane3 = l.lanes[2];
    final p = _at(b, tlLabelW + 10.5 * 18, lane3.y + lane3.h / 2);
    showBoardMenu(ctx, b.ui, MenuTarget.object, MenuAt(p, objectId: 't1'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTlMenuLaneUp')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTlMenuItemHere')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.addItem').single), {
      'id': 't1',
      'lane': 'l3',
      'start': '2026-11-12',
      'end': '2026-11-18',
    });
    b.st.stopEdit();
    await tester.pump();
    // Namensspalte von Spur 1: kein „Eintrag hier anlegen“, aber verschieben
    final lane1 = l.lanes[0];
    showBoardMenu(ctx, b.ui, MenuTarget.object, MenuAt(_at(b, 40, lane1.y + 10), objectId: 't1'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTlMenuItemHere')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelTlMenuLaneDown')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.moveLane').single), {'id': 't1', 'lane': 'l1', 'to': 1});
    showBoardMenu(ctx, b.ui, MenuTarget.object, MenuAt(_at(b, 40, lane3.y + 10), objectId: 't1'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelTlMenuLaneDelete')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.removeLane').single), {'id': 't1', 'lane': 'l3'});
    // auf einem Eintrag: Farbe (Untermenü), Standardfarbe = null
    final a = _layout(b).items.firstWhere((x) => x.id == 'a');
    showBoardMenu(ctx, b.ui, MenuTarget.object, MenuAt(_at(b, a.x + 5, a.y + 5), objectId: 't1'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTlMenuMs')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTlMenuColor')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelTlMenuColor-#1763b5')));
    await tester.pumpAndSettle();
    expect(_args(_acts(b.source, 'timeline.patchItem').single), {'id': 't1', 'key': 'a', 'color': null});
  });

  testWidgets('Doppeltippen in eine Spur legt einen Eintrag ab dem Tag an; „‹ 1“ erweitert den Zeitraum', (tester) async {
    final b = await _pump(tester, objects: [_timeline()]);
    final l = _layout(b);
    final lane2 = l.lanes[1];
    final p = _at(b, tlLabelW + 20.5 * 18, lane2.y + lane2.h - 6);
    await tester.tapAt(p);
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(p);
    await tester.pump(const Duration(milliseconds: 400));
    expect(_args(_acts(b.source, 'timeline.addItem').single), {
      'id': 't1',
      'lane': 'l2',
      'start': '2026-11-22',
      'end': '2026-11-28',
    });
    expect(find.byKey(const Key('stachelTlTitleInline')), findsOneWidget);
    b.st.stopEdit();
    b.editor.select(const {});
    await tester.pump();
    // ein Eintrag liegt vor dem Zeitraum: „‹ 1“ im Kopf
    expect(l.before, 1);
    await tester.tapAt(_at(b, tlLabelW + 12, tlHeadTop + 14));
    await tester.pump(const Duration(milliseconds: 400));
    expect(_args(_acts(b.source, 'timeline.setRange').single), {'id': 't1', 'extend': 'before'});
    expect(b.controller.state['t1']!.raw['tlStart'], '2026-10-01');
  });

  testWidgets('Seitengriff = Zeitraum (Tagesbreite bleibt), Ecke skaliert', (tester) async {
    final b = await _pump(tester, objects: [_timeline()]);
    final o = b.controller.state['t1']!;
    final rz = b.ui.registry.typeOf('timeline')!.resize!;
    final east = rz(o, {'x': o.x, 'y': o.y, 'w': o.w + 18 * 7, 'h': o.h}, 'e');
    expect(east['tlStart'], '2026-11-02');
    expect(east['tlEnd'], '2027-01-03');
    expect(east['w'], o.w + 18 * 7);
    final west = rz(o, {'x': o.x + 18 * 7, 'y': o.y, 'w': o.w - 18 * 7, 'h': o.h}, 'w');
    expect(west['tlStart'], '2026-11-09');
    expect(west['x'], o.x + 18 * 7);
    final corner = {'x': o.x, 'y': o.y, 'w': o.w * 2, 'h': o.h * 2};
    expect(rz(o, corner, 'se'), corner);
    // am Bildschirm: rechter Griff ziehen schreibt Zeitraum und Größe
    b.editor.select({'t1'});
    await tester.pump();
    final e = b.editor.handles().firstWhere((h) => h.id == 'e');
    await tester.dragFrom(e.at, const Offset(18.0 * 14, 0));
    await tester.pump();
    final upd = _ops(b.source).lastWhere((x) => x['op'] == 'update');
    expect((upd['patches']! as Map)['t1'], containsPair('tlEnd', '2027-01-10'));
  });

  testWidgets('Haftnotiz auf eine Spur ziehen: Spur markiert, danach timeline.adopt', (tester) async {
    final t = _timeline();
    final l = tlLayoutOf(
      safeTimeline(t['timeline']),
      TlRange(tlParseDay('2026-11-02')!, tlParseDay('2026-12-27')!),
      'week',
    );
    final b = await _pump(
      tester,
      objects: [
        t,
        {'id': 'n1', 'type': 'sticky', 'x': 700, 'y': 500, 'w': 120, 'h': 120, 'text': 'Soundcheck', 'z': 'a2'},
      ],
    );
    b.editor.select({'n1'});
    await tester.pump();
    final lane3 = l.lanes[2];
    final target = Offset(100 + tlLabelW + 20.5 * 18, 60 + lane3.y + lane3.h / 2);
    final gesture = await tester.startGesture(const Offset(760, 560));
    await gesture.moveBy(const Offset(0, -20));
    await tester.pump();
    await gesture.moveTo(target);
    await tester.pump();
    expect(find.byKey(const Key('stachelTlDropZone')), findsOneWidget);
    await gesture.up();
    await tester.pump();
    expect(find.byKey(const Key('stachelTlDropZone')), findsNothing);
    expect(_args(_acts(b.source, 'timeline.adopt').single), {
      'ids': ['n1'],
    });
  });

  testWidgets('Gesperrte Zeitleiste: keine Leiste, keine Griffe, kein Ziehen', (tester) async {
    final b = await _pump(tester, objects: [_timeline(locked: true)]);
    b.editor.select({'t1'});
    await tester.pump();
    expect(find.byKey(const Key('stachelTlUnit')), findsNothing);
    expect(find.byKey(const Key('stachelTlItem-a')), findsNothing);
    expect(find.byKey(const Key('stachelTlAddLane')), findsNothing);
  });
}
