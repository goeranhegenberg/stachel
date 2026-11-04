// Shared test board for P4 (view, frames, search): the board view with the registries' overlays, context bar and tool
// bar like the app's screen, the title bar hidden while presenting / UI hidden, web actions of P4 available.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

class P4Board {
  P4Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  BoardViewState get view => ui.view!;
  Camera get cam => view.camera.value;

  /// Ops sent so far.
  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
  ];

  /// The `req` of the last ops message.
  int get lastReq => source.sent.lastWhere((m) => m['t'] == 'ops')['req']! as int;

  /// Server confirms the last ops message with [ext] changes (e.g. `tools.settings`) and object [changes].
  void confirm({Map<String, Object?> ext = const {}, List<Map<String, Object?>> changes = const [], int rev = 30}) {
    final req = lastReq;
    source.push(PatchMessage.fromJson({'t': 'patch', 'rev': rev, 'changes': changes, 'ext': ext}));
    source.push(AckMessage(req, rev));
  }
}

Future<P4Board> pumpP4(
  WidgetTester tester, {
  Size size = const Size(390, 760),
  List<Map<String, Object?>> objects = const [],
  Map<String, Object?> ext = const {},
  Map<String, int> actions = const {'tools.settings': 1, 'frames.reorder': 1},
  bool fitOnLoad = false,
  String role = 'edit',
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  BoardPrefs.load(const {});
  BoardViewPrefs.setSystemImmersive = (_) async {};
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects, 'ext': ext}),
    rev: 20,
    role: role,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: actions,
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
      home: BoardUiScope(
        ui: ui,
        child: ValueListenableBuilder<bool>(
          valueListenable: BoardViewPrefs.of(ui).chromeHidden,
          builder: (context, hidden, _) => Scaffold(
            appBar: hidden
                ? null
                : AppBar(
                    title: const Text('Board'),
                    actions: [
                      Builder(
                        builder: (context) => IconButton(
                          key: const Key('stachelBoardMenu'),
                          icon: const Icon(Icons.more_vert),
                          onPressed: () => showBoardMenu(context, ui, MenuTarget.board, const MenuAt(Offset.zero)),
                        ),
                      ),
                    ],
                  ),
            body: Builder(
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
                            fitOnLoad: fitOnLoad,
                            onLongPress: (w) => showBoardMenu(context, ui, MenuTarget.canvas, MenuAt(w)),
                            onObjectMenu: (w, id) =>
                                showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id)),
                          ),
                        ),
                        Positioned.fill(child: BoardOverlays(ui: ui)),
                        if (!hidden)
                          Positioned(
                            left: 8,
                            right: 8,
                            bottom: 8,
                            child: ListenableBuilder(
                              listenable: Listenable.merge([editor, controller]),
                              builder: (context, _) =>
                                  editor.selection.value.isEmpty ? const SizedBox.shrink() : BoardContextBar(ui: ui),
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (!hidden)
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
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return P4Board(controller, source, editor, ui);
}

/// Opens the board menu and taps the entry [key].
Future<void> boardMenu(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(const Key('stachelBoardMenu')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Matcher closeCam(Camera c, [double eps = 1e-6]) => predicate<Camera>(
  (v) => (v.x - c.x).abs() < eps && (v.y - c.y).abs() < eps && (v.z - c.z).abs() < eps,
  'Kamera $c',
);
