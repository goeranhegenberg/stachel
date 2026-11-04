// UX-A1 (docs/ux_review_app_2026-11.md P1, P2, P9): bars on top stack instead of covering each other, one remaining
// time for vote and timer, undo/redo in the tool bar, phone without zoom bar (percentage while zooming, minimap top
// right), one mind map entry, mind map templates only from the host app ([mindmapTemplateTool]), „Verbinder“ everywhere.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'features/follow/p5_harness.dart';
import 'sample_mindmap.dart';

void main() {
  var now = 1000000;
  setUp(() {
    now = 1000000;
    collabDeviceNow = () => now;
  });
  tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

  Map<String, Object?> vote({required int endsAt}) => {
    'session': {
      'id': 'v1',
      'title': 'Welche Bühne?',
      'perPerson': 3,
      'multi': false,
      'endsAt': endsAt,
      'startedBy': 'a:mara',
      'startedByName': 'Mara',
      'startedAt': 1,
      'ended': false,
      'anonymous': false,
    },
  };
  Map<String, Object?> timer({required int endsAt}) => {
    'timer': {'state': 'running', 'endsAt': endsAt, 'remaining': 0, 'duration': 300000, 'by': 'Jonas', 'run': 1},
  };

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  testWidgets('P2: Suche, Abstimmung und Status-Hinweise stapeln sich oben, nichts überdeckt sich', (tester) async {
    final b = await pumpP5(tester, ext: {'collab.vote': vote(endsAt: now + 300000)});
    await settle(tester);
    final voteBar = find.byKey(const Key('collabVoteBar'));
    expect(voteBar, findsOneWidget);
    final voteAlone = tester.getRect(voteBar);
    final boardTop = tester.getTopLeft(find.byType(BoardView)).dy;
    expect(voteAlone.top - boardTop, lessThan(20)); // alone: at the top edge

    openSearch(b.ui);
    await settle(tester);
    final search = tester.getRect(find.byKey(const Key('stachelSearchBar')));
    final voteBelow = tester.getRect(voteBar);
    expect(search.top, lessThan(voteBelow.top));
    expect(search.bottom, lessThanOrEqualTo(voteBelow.top), reason: 'die Suche liegt über, nicht auf der Abstimmung');
    expect(b.ui.topBars.bottom, greaterThanOrEqualTo(voteBelow.bottom - boardTop - 1));

    closeSearch(b.ui);
    await settle(tester);
    expect(tester.getRect(voteBar).top, voteAlone.top, reason: 'die Abstimmung rückt wieder nach oben');
  });

  testWidgets('P2: Timer und Abstimmung mit (fast) gleichem Ende zeigen eine Restzeit, sonst „Timer 9:59“', (
    tester,
  ) async {
    final b = await pumpP5(
      tester,
      ext: {
        'collab.vote': vote(endsAt: now + 300000),
        'collab.timer': timer(endsAt: now + 298000),
      },
    );
    await settle(tester);
    expect(find.byKey(const Key('collabVoteTime')), findsOneWidget);
    expect(find.byKey(const Key('collabTimerChip')), findsNothing, reason: 'die Abstimmungsleiste trägt die Zeit');
    // the timer runs longer than the vote: both, the chip named
    b.ext({'collab.timer': timer(endsAt: now + 599000)});
    await settle(tester);
    expect(find.byKey(const Key('collabTimerChip')), findsOneWidget);
    expect(find.text('Timer 9:59'), findsOneWidget);
    // without a vote the chip shows only the time again
    b.ext({'collab.vote': null});
    await settle(tester);
    expect(find.text('9:59'), findsOneWidget);
  });

  testWidgets('P1: Rückgängig/Wiederholen links in der Werkzeugleiste, so viele Werkzeuge wie passen', (tester) async {
    final b = await pumpP5(tester);
    var ended = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: BoardUiScope(
              ui: b.ui,
              child: BoardToolbar(ui: b.ui, history: true, beforeHistory: () => ended++),
            ),
          ),
        ),
      ),
    );
    final undo = find.byKey(const Key('stachelUndo'));
    expect(undo, findsOneWidget);
    expect(tester.getRect(undo).left, lessThan(10), reason: 'unter dem Daumen links');
    expect(tester.widget<IconButton>(undo).onPressed, isNull, reason: 'noch nichts rückgängig zu machen');
    // 390 dp: 2 × 40 for the history, 7 buttons of ≥ 44 dp (6 tools + „···“)
    final buttons = find.byWidgetPredicate(
      (w) => w is InkWell && w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('stachelTool'),
    );
    expect(buttons, findsNWidgets(7));
    for (final e in buttons.evaluate()) {
      expect(tester.getSize(find.byWidget(e.widget)).width, greaterThanOrEqualTo(BoardToolbar.minButton));
    }
    expect(find.byKey(const Key('stachelToolMore')), findsOneWidget);
    // „Verbinder“ instead of „LINIE“ (P9)
    expect(find.text('VERBINDER'), findsOneWidget);
    expect(find.text('LINIE'), findsNothing);

    b.editor.select({});
    b.controller.canUndo = true;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: BoardUiScope(
              ui: b.ui,
              child: BoardToolbar(ui: b.ui, history: true, beforeHistory: () => ended++),
            ),
          ),
        ),
      ),
    );
    await tester.tap(undo);
    await tester.pump();
    expect(ended, 1, reason: 'erst das Schreiben beenden, dann rückgängig');
    expect(b.source.sent.where((m) => m['t'] == 'undo'), isNotEmpty);
  });

  testWidgets('P9: am Handy keine Zoom-Leiste; beim Zoomen kurz „%“ mit Einpassen, Minikarte oben rechts', (
    tester,
  ) async {
    final b = await pumpP5(
      tester,
      objects: [
        {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A'},
      ],
    );
    await settle(tester);
    expect(find.byKey(const Key('stachelZoomBar')), findsNothing);
    final map = tester.getRect(find.byKey(const Key('stachelMinimapToggle')));
    final view = tester.getRect(find.byType(BoardView));
    expect(map.top - view.top, lessThan(80), reason: 'oben, außerhalb des Daumenbereichs');
    expect(view.right - map.right, lessThan(20));
    expect(find.byKey(const Key('stachelZoomFlash')), findsNothing);

    await tester.pump(const Duration(seconds: 1)); // after the start camera
    b.view.camera.zoomAt(const Offset(100, 100), b.cam.z * 1.5);
    await tester.pump();
    expect(find.byKey(const Key('stachelZoomFlash')), findsOneWidget);
    expect(find.text('${(b.cam.z * 100).round()} %'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelZoomFit')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(find.byKey(const Key('stachelZoomFlash')), findsNothing);
  });

  testWidgets('P9: eine Mindmap unter den Werkzeugen, Mindmap-Vorlagen nur über die Host-App', (tester) async {
    final b = await pumpP5(tester);
    List<String> phoneTools(BoardUi ui) => [
      for (final t in ui.registry.tools.list())
        if (t.phone != ToolPlace.hide && (t.available?.call(ui) ?? true)) t.label,
    ];
    final plain = phoneTools(b.ui);
    expect(plain.where((t) => t.contains('Mindmap')), ['Mindmap']);
    expect(plain, contains('Karte, Tabelle, Zeitleiste'));
    expect(plain.any((t) => t.contains('Vorlage')), isFalse, reason: 'das Paket bringt keine Mindmap-Vorlage mit');
    // the options of „Karte, Tabelle, Zeitleiste“ have no second mind map
    b.editor.useTool('structure.blocks');
    await tester.pump();
    expect(find.byKey(const Key('stachelBlocks-card')), findsOneWidget);
    expect(find.byKey(const Key('stachelBlocks-mindmap')), findsNothing);

    // a host app adds its own template through the extension point
    final registry = standardBoardRegistry()
      ..defineTool(mindmapTemplateTool(id: 'host.mindmapPlan', template: sampleMindmap, subtitle: 'Planung'));
    final ui = BoardUi(editor: b.editor, registry: registry, host: P5Host());
    addTearDown(ui.dispose);
    final tool = ui.registry.tools.list().firstWhere((t) => t.id == 'host.mindmapPlan');
    expect(phoneTools(ui), contains('Mindmap-Vorlage „Sommerfest“'));
    expect(tool.phone, ToolPlace.more);
    await tool.onPick!(tester.element(find.byType(Scaffold).first), ui);
    expect(b.editor.mindTemplate, same(sampleMindmap));
    expect(b.editor.tool, BoardTool.mindmap);
    expect(tool.active!(ui), isTrue);
  });
}
