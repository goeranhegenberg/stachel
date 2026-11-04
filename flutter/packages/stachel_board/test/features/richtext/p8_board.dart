// Test board of P8 (rich text, accessibility): view, overlays, context bar, the format bar while writing (like the
// app's edit bar), a server that knows the rich text actions, a host that records opened links.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Duration ms(int v) => Duration(milliseconds: v);

class LinkHost extends BoardHost {
  final opened = <String>[];
  @override
  Future<void> openUrl(String url) async => opened.add(url);
}

class P8Board {
  P8Board(this.tester, this.controller, this.source, this.editor, this.ui, this.host);
  final WidgetTester tester;
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final LinkHost host;
  BoardViewState get view => ui.view!;

  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
  ];

  List<Map<String, Object?>> get acts => [
    for (final o in ops)
      if (o['op'] == 'act') o,
  ];

  /// The last text op's document.
  Map<String, Object?> get lastDoc => (ops.lastWhere((o) => o['op'] == 'text')['doc'] as Map).cast<String, Object?>();

  Offset screen(Offset world) {
    final box = tester.renderObject<RenderBox>(find.byType(BoardView));
    return box.localToGlobal(view.camera.value.toScreen(world));
  }

  Future<void> tapWorld(Offset w) async {
    await tester.tapAt(screen(w));
    await tester.pump(ms(350));
  }

  Future<void> ctx(String key) async {
    if (find.byKey(Key(key)).evaluate().isEmpty) {
      await tester.tap(find.byKey(const Key('stachelCtxMore')));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.byKey(Key(key)).last);
    await tester.pumpAndSettle();
  }

  Future<void> tap(String key) async {
    await tester.ensureVisible(find.byKey(Key(key)).last);
    await tester.tap(find.byKey(Key(key)).last);
    await tester.pumpAndSettle();
  }

  RichTextEditingController get field =>
      tester.widget<TextField>(find.byKey(const Key('boardTextField'))).controller! as RichTextEditingController;

  /// Selects document offsets [a]–[b] in the text field.
  Future<void> selectText(int a, int b) async {
    final f = field;
    f.selection = TextSelection(baseOffset: f.toDisplay(a), extentOffset: f.toDisplay(b));
    await tester.pump();
    await tester.pump();
  }
}

Future<P8Board> pumpP8Board(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = const [],
  Size size = const Size(800, 900),
  bool actions = true,
  bool screenReader = false,
  bool reduceMotion = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act'],
    actions: actions ? const {'richtext.whole': 1, 'richtext.toggleTask': 1} : const {},
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {}
    ..textDebounce = Duration.zero;
  final host = LinkHost();
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  if (screenReader || reduceMotion) {
    tester.platformDispatcher.accessibilityFeaturesTestValue = FakeAccessibilityFeatures(
      accessibleNavigation: screenReader,
      disableAnimations: reduceMotion,
    );
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
  }
  final app = MaterialApp(
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
                          editor.editingId != null ? const SizedBox.shrink() : BoardContextBar(ui: ui),
                    ),
                  ),
                ],
              ),
            ),
            ListenableBuilder(
              listenable: editor,
              builder: (context, _) => editor.editingId != null
                  ? Material(child: RichFormatBar(editor: editor))
                  : BoardToolbar(ui: ui, enabled: editor.editable),
            ),
          ],
        ),
      ),
    ),
  );
  await tester.pumpWidget(app);
  await controller.start();
  await tester.pump();
  await tester.pump();
  return P8Board(tester, controller, source, editor, ui, host);
}
