// Shared test board for P5 (voting, timer, follow, laser, cursor chat): the board view with the registries' overlays,
// the presence bar in the title bar, the tool bar like the app's screen; collab actions available, me = Mara.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const p5Actions = {
  'collab.vote.start': 1,
  'collab.vote.cast': 1,
  'collab.vote.end': 1,
  'collab.vote.close': 1,
  'collab.timer.start': 1,
  'collab.timer.pause': 1,
  'collab.timer.resume': 1,
  'collab.timer.stop': 1,
  'collab.timer.add': 1,
  'collab.commentMove': 1,
};

/// Host of the tests: settings in memory, chimes counted, hints collected.
class P5Host extends BoardHost {
  final settings = <String, String>{};
  final messages = <String>[];
  int chimes = 0;
  List<Person> known = const [];

  @override
  Future<String?> readSetting(String key) async => settings[key];
  @override
  Future<void> writeSetting(String key, String value) async => settings[key] = value;
  @override
  void showMessage(String text) => messages.add(text);
  @override
  Future<List<Person>> people() async => known;
  @override
  Future<void> playChime() async => chimes++;

  /// Rows of „···“ at a person in „Auf dem Board“ (app moderation); default none.
  List<MenuEntry> Function(String key, String name)? persons;
  @override
  List<MenuEntry> personActions(String key, String name) => persons?.call(key, name) ?? const [];
}

class P5Board {
  P5Board(this.controller, this.source, this.editor, this.ui, this.host);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final P5Host host;
  final hints = <String>[];
  BoardViewState get view => ui.view!;
  Camera get cam => view.camera.value;

  /// Web actions sent so far (`name`, `args`).
  List<(String, Map<String, Object?>)> get acts => [
    for (final m in source.sent)
      if (m['t'] == 'ops')
        for (final o in (m['ops'] as List).cast<Map<String, Object?>>())
          if (o['op'] == 'act') (o['name']! as String, (o['args'] as Map).cast<String, Object?>()),
  ];

  /// Presence messages sent so far.
  List<Map<String, Object?>> get presence => [
    for (final m in source.sent)
      if (m['t'] == 'presence') m,
  ];

  /// Last value of the awareness field [key] that went out (`extra`); `#none` = never sent.
  Object? sentExtra(String key) {
    for (final m in presence.reversed) {
      final e = m['extra'];
      if (e is Map && e.containsKey(key)) return e[key];
    }
    return '#none';
  }

  /// The `req` of the last ops message.
  int get lastReq => source.sent.lastWhere((m) => m['t'] == 'ops')['req']! as int;

  int _rev = 40;

  /// Server: [ext] changes (e.g. `collab.vote`) as a patch (each with a new revision).
  void ext(Map<String, Object?> ext, {int? rev}) =>
      source.push(PatchMessage.fromJson({'t': 'patch', 'rev': rev ?? ++_rev, 'changes': const [], 'ext': ext}));

  /// Server confirms the last ops message (optionally after the [ext] patch) with an action result.
  void ack({Map<String, Object?> ext = const {}, Map<String, Object?>? result}) {
    final req = lastReq;
    final rev = ++_rev;
    if (ext.isNotEmpty) this.ext(ext, rev: rev);
    source.push(AckMessage(req, rev, const [], result == null ? const {} : ActResult.allFromJson({'0': result})));
  }

  /// Others on the board.
  void peers(List<Peer> peers) => source.push(PresenceMessage(peers));
}

Future<P5Board> pumpP5(
  WidgetTester tester, {
  Size size = const Size(390, 760),
  List<Map<String, Object?>> objects = const [],
  Map<String, Object?> ext = const {},
  Map<String, int> actions = p5Actions,
  String role = 'edit',
  ThemeData? theme,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  BoardPrefs.load(const {});
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
  final host = P5Host();
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
  final board = P5Board(controller, source, editor, ui, host);
  final sub = ui.hints.messages.listen(board.hints.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: theme,
      home: BoardUiScope(
        ui: ui,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Board'),
            actions: [
              CollabPresenceBar(ui: ui),
              Builder(
                builder: (context) => IconButton(
                  key: const Key('stachelBoardMenu'),
                  icon: const Icon(Icons.more_vert),
                  onPressed: () => showBoardMenu(context, ui, MenuTarget.board, const MenuAt(Offset.zero)),
                ),
              ),
            ],
          ),
          body: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
                    ),
                    Positioned.fill(child: BoardOverlays(ui: ui)),
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
  controller.user = const NativeUser(key: 'a:mara', name: 'Mara Kern');
  controller.color = '#1763b5';
  await tester.pump();
  await tester.pump();
  return board;
}

/// The web action [a] is [name] with [args] (maps compared deeply).
void expectAct((String, Map<String, Object?>) a, String name, [Map<String, Object?>? args]) {
  expect(a.$1, name);
  if (args != null) expect(a.$2, args);
}

/// Opens the board menu and taps the entry [key].
Future<void> boardMenu(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(const Key('stachelBoardMenu')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// A peer on the board.
Peer peer(
  String key,
  String name, {
  int id = 1,
  String color = '#ec4e92',
  double? x,
  double? y,
  Map<String, Object?> extra = const {},
  String client = 'web',
}) => Peer(id: id, key: key, name: name, color: color, cursorX: x, cursorY: y, extra: extra, client: client);

Map<String, Object?> sticky(String id, double x, double y, {String text = '', String? by}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 120,
  'h': 120,
  'color': '#fff27a',
  'text': text,
  'z': 'a$id',
  'createdBy': ?by,
};
