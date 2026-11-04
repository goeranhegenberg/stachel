// Screenshots of the private mode and the presentation additions for the visual check (docs/features/private.md §1,
// §7): 390 × 844 at 2×, Barlow like the app, the app's theme and board colors. Writes `app-private-*.png`, only with
//   flutter test test/private_shots_test.dart --dart-define=STACHEL_PRIVATE_SHOTS=../../docs/screenshots
// (otherwise skipped, the normal suite stays as it is).
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel/theme.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _out = String.fromEnvironment('STACHEL_PRIVATE_SHOTS');
final _skip = _out.isEmpty ? 'STACHEL_PRIVATE_SHOTS fehlt' : null;
const _w = 390.0, _h = 844.0, _dpr = 2.0;
final _shotKey = GlobalKey();
const _me = 'a:mara';
const _now = 1762250000000;

Future<void> _fonts() async {
  Future<void> family(String name, String dir, List<String> files) async {
    final l = FontLoader(name);
    for (final f in files) {
      final file = File('$dir/$f');
      if (file.existsSync()) l.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await l.load();
  }

  await family('Barlow', 'assets/fonts', [
    'Barlow-Regular.ttf',
    'Barlow-Medium.ttf',
    'Barlow-SemiBold.ttf',
    'Barlow-Bold.ttf',
  ]);
  await family('BarlowCondensed', 'assets/fonts', [
    'BarlowCondensed-Medium.ttf',
    'BarlowCondensed-SemiBold.ttf',
    'BarlowCondensed-Bold.ttf',
    'BarlowCondensed-Black.ttf',
  ]);
  final root = Platform.environment['FLUTTER_ROOT'] ?? '';
  final icons = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  if (icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
  final roboto = Directory('$root/bin/cache/artifacts/material_fonts');
  if (roboto.existsSync()) {
    final l = FontLoader('Roboto');
    for (final f in roboto.listSync().whereType<File>().where((f) => f.path.contains('Roboto-'))) {
      l.addFont(Future.value(ByteData.sublistView(f.readAsBytesSync())));
    }
    await l.load();
  }
}

class _Host extends BoardHost implements BoardPrivateHost {
  @override
  Future<Map<String, Object?>> privateMode(Map<String, Object?> body) async => const {'on': true};
  @override
  String privateErrorText(Object error) => '$error';
  @override
  Future<List<Person>> people() async => const [Person('k:jonas', 'Jonas')];
}

class _Shot {
  _Shot(this.controller, this.source, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardUi ui;
}

Future<_Shot> _pump(
  WidgetTester tester, {
  required List<Map<String, Object?>> objects,
  Map<String, Object?> ext = const {},
}) async {
  tester.view.physicalSize = const Size(_w * _dpr, _h * _dpr);
  tester.view.devicePixelRatio = _dpr;
  addTearDown(tester.view.reset);
  BoardPrefs.load(const {});
  BoardViewPrefs.setSystemImmersive = (_) async {};
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects, 'ext': ext}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra', 'private'],
    actions: const {'frames.reorder': 1, 'tools.settings': 1},
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: _Host(), theme: stachelBoardTheme);
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    RepaintBoundary(
      key: _shotKey,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: StachelTheme.theme(),
        home: BoardUiScope(
          ui: ui,
          child: ValueListenableBuilder<bool>(
            valueListenable: ui.presenting,
            builder: (context, presenting, _) => Scaffold(
              appBar: presenting
                  ? null
                  : AppBar(
                      title: const Text('Workshop Festival'),
                      actions: [IconButton(onPressed: () {}, icon: const Icon(Icons.more_vert))],
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
                  if (!presenting)
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
  controller
    ..user = const NativeUser(key: _me, name: 'Mara')
    ..clientId = 99;
  await tester.pump();
  await tester.pump();
  return _Shot(controller, source, ui);
}

Future<void> _shot(WidgetTester tester, String name) async {
  await tester.pump(const Duration(milliseconds: 500));
  final ro = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final img = await ro.toImage(pixelRatio: _dpr);
    final png = await img.toByteData(format: ui.ImageByteFormat.png);
    File('$_out/app-private-$name.png').writeAsBytesSync(png!.buffer.asUint8List());
  });
  // ignore: avoid_print
  print('Bild $_out/app-private-$name.png');
}

Map<String, Object?> _sticky(String id, double x, double y, String text, {String color = '#fff27a', String z = 'a1'}) =>
    {'id': id, 'type': 'sticky', 'x': x, 'y': y, 'w': 160, 'h': 160, 'color': color, 'text': text, 'z': z};

Map<String, Object?> _frame(String id, double x, String title, {String? notes, String z = 'a0'}) => {
  'id': id,
  'type': 'frame',
  'x': x,
  'y': 0,
  'w': 640,
  'h': 420,
  'title': title,
  'color': '#ffffff',
  'z': z,
  'notes': ?notes,
};

Map<String, Object?> _mode({String by = _me, String byName = 'Mara', int? revealAt}) => {
  'on': true,
  'by': by,
  'byName': byName,
  'since': '2026-11-04T10:00:00.000Z',
  'anonymous': false,
  'ownReveal': true,
  'revealAt': ?revealAt,
};

Peer _peer(int id, String key, String name, {Map<String, Object?> extra = const {}}) =>
    Peer(id: id, key: key, name: name, color: '#ec4e92', extra: extra, client: 'web');

void main() {
  setUpAll(_fonts);
  setUp(() => collabDeviceNow = () => _now);
  tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

  final hidden = {
    'h1': {'x': 220, 'y': 40, 'w': 160, 'h': 160, 'type': 'sticky', 'by': 'k:jonas', 'o': 'o1'},
    'h2': {'x': 40, 'y': 260, 'w': 160, 'h': 160, 'type': 'sticky', 'rotation': -4, 'by': 'k:lea', 'o': 'o2'},
    'p1': {'x': 220, 'y': 260, 'w': 160, 'h': 160, 'type': 'sticky', 'by': _me, 'o': 'o3'},
  };
  final board = [_sticky('n1', 40, 40, 'Was lief gut?', color: '#9fd3ff')];
  final mine = _sticky('p1', 220, 260, 'Mehr Pausen zwischen den Blöcken', z: 'b0');

  testWidgets('1 Band, Platzhalter, eigene private Notiz', (tester) async {
    final s = await _pump(tester, objects: board, ext: {'private.mode': _mode(), 'private.hidden': hidden});
    s.source.push(
      ServerMessage.parse({
        't': 'private',
        'objects': [mine],
      }),
    );
    s.source.push(PresenceMessage([_peer(7, 'k:jonas', 'Jonas')]));
    s.ui.view!.camera.value = const Camera(-10, 110, 0.95);
    await _shot(tester, 'modus');
  }, skip: _skip != null);

  testWidgets('2 Countdown', (tester) async {
    final s = await _pump(
      tester,
      objects: board,
      ext: {
        'private.mode': _mode(revealAt: _now + 2500),
        'private.hidden': hidden,
      },
    );
    s.source.push(
      ServerMessage.parse({
        't': 'private',
        'objects': [mine],
      }),
    );
    s.ui.view!.camera.value = const Camera(-10, 110, 0.95);
    await _shot(tester, 'countdown');
    s.source.push(
      PatchMessage.fromJson({
        't': 'patch',
        'rev': 30,
        'changes': const [],
        'ext': {
          'private.mode': {'on': false},
          'private.hidden': null,
        },
      }),
    );
    await tester.pump(const Duration(milliseconds: 300));
  }, skip: _skip != null);

  final frames = [
    _frame('f1', 0, 'Begrüßung'),
    _frame(
      'f2',
      800,
      'Ergebnisse',
      z: 'a1',
      notes:
          'Zahlen nennen: 412 Gäste, 38 Helfer:innen.\nDank an das Technik-Team.\nÜberleitung zur Feedback-Runde – '
          'nach 5 Minuten an Jonas übergeben.',
    ),
    {..._sticky('k1', 860, 80, '412 Gäste', color: '#ffb3d1'), 'z': 'a2'},
    {..._sticky('k2', 1060, 80, '38 Helfer:innen', color: '#c9e14a'), 'z': 'a3'},
  ];

  testWidgets('3 Präsentation mit Sprechernotizen', (tester) async {
    final s = await _pump(tester, objects: frames);
    s.source.push(PresenceMessage([_peer(7, 'k:jonas', 'Jonas'), _peer(8, 'k:lea', 'Lea')]));
    await tester.pump();
    final p = Presentation.of(s.ui)..start(1);
    await tester.pumpAndSettle();
    p.toggleNotes();
    await tester.pumpAndSettle();
    await _shot(tester, 'notizen');
    p.stop();
    await tester.pumpAndSettle();
  }, skip: _skip != null);

  testWidgets('4 Übergabe-Hinweis beim Empfänger', (tester) async {
    final s = await _pump(tester, objects: frames);
    s.source.push(
      PresenceMessage([
        _peer(
          7,
          'k:jonas',
          'Jonas',
          extra: {
            'structure.present': {'frameId': 'f2', 'index': 1, 'total': 2, 'title': 'Ergebnisse'},
            'structure.handover': {'to': _me, 'id': 'o1', 'index': 1, 'frameId': 'f2'},
          },
        ),
      ]),
    );
    s.ui.view!.camera.value = const Camera(-350, 270, 0.45);
    await tester.pumpAndSettle();
    await _shot(tester, 'uebergabe');
  }, skip: _skip != null);
}
