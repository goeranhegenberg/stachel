// Test board of P2 (shapes, stickers, text object): view, overlays, context bar and tool bar like the app's screen,
// a host that keeps settings in memory.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Duration ms(int v) => Duration(milliseconds: v);

/// Host with settings in memory (recent emoji).
class MemoryHost extends BoardHost {
  final settings = <String, String>{};
  @override
  Future<String?> readSetting(String key) async => settings[key];
  @override
  Future<void> writeSetting(String key, String value) async => settings[key] = value;
}

class P2Board {
  P2Board(this.tester, this.controller, this.source, this.editor, this.ui, this.host);
  final WidgetTester tester;
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final MemoryHost host;
  BoardViewState get view => ui.view!;

  /// All ops sent so far.
  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
  ];

  /// The objects of the last create op.
  List<Map<String, Object?>> get created =>
      (ops.lastWhere((o) => o['op'] == 'create')['objects'] as List).cast<Map<String, Object?>>();

  /// Patches of the last update op.
  Map<String, Object?> get patches =>
      (ops.lastWhere((o) => o['op'] == 'update')['patches'] as Map).cast<String, Object?>();

  Offset screen(Offset world) {
    final box = tester.renderObject<RenderBox>(find.byType(BoardView));
    return box.localToGlobal(view.camera.value.toScreen(world));
  }

  Future<void> tapWorld(Offset w) async {
    await tester.tapAt(screen(w));
    await tester.pump(ms(350));
  }

  /// Taps a context bar entry, inline or behind „···“.
  Future<void> ctx(String key) async {
    if (find.byKey(Key(key)).evaluate().isEmpty) {
      await tester.tap(find.byKey(const Key('stachelCtxMore')));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.byKey(Key(key)).last);
    await tester.pumpAndSettle();
  }

  /// Closes the open sheet.
  Future<void> closeSheet() async {
    Navigator.of(tester.element(find.byType(BoardView))).pop();
    await tester.pumpAndSettle();
  }
}

Future<P2Board> pumpP2Board(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = const [],
  Size size = const Size(800, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(BoardSnapshot.fromJson({'objects': objects}), rev: 20);
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {}
    ..textDebounce = Duration.zero;
  final host = MemoryHost();
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
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
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
                    ),
                    Positioned.fill(child: BoardOverlays(ui: ui)),
                    Positioned(
                      left: 8,
                      right: 8,
                      bottom: 8,
                      child: ListenableBuilder(
                        listenable: Listenable.merge([editor, controller]),
                        builder: (context, _) =>
                            editor.editingId != null ? NextNoteButton(ui: ui) : BoardContextBar(ui: ui),
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
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return P2Board(tester, controller, source, editor, ui, host);
}
