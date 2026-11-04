// Golden of the private mode on a phone: the band „Privater Modus …“ sits in the column on top, the minimap button
// below it (it covered the band before). Windows only:
// `flutter test --update-goldens test/features/private/private_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../test_fonts.dart';

class _Host extends BoardHost implements BoardPrivateHost {
  @override
  Future<Map<String, Object?>> privateMode(Map<String, Object?> body) async => const {'on': true};

  @override
  String privateErrorText(Object error) => '$error';
}

void main() {
  setUpAll(loadBoardFonts);

  testWidgets('Handy: Band oben, Übersichtskarten-Knopf darunter', (tester) async {
    tester.view.physicalSize = const Size(390, 520);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    BoardPrefs.load(const {});
    final source = FixtureBoardSource(
      BoardSnapshot.fromJson({
        'objects': [
          {'id': 'n1', 'type': 'sticky', 'x': 40, 'y': 160, 'w': 200, 'h': 200, 'text': 'Idee', 'z': 'a0'},
        ],
        'ext': {
          'private.mode': {
            'on': true,
            'by': 'a:mara',
            'byName': 'Mara Kern',
            'since': '2026-11-04T10:00:00.000Z',
            'anonymous': false,
            'ownReveal': false,
          },
          'private.hidden': {
            'h1': {'x': 300, 'y': 160, 'w': 200, 'h': 200, 'type': 'sticky', 'o': 'x1'},
          },
        },
      }),
      rev: 20,
      role: 'edit',
      features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra', 'private'],
    );
    final controller = BoardController(source, presenceInterval: Duration.zero);
    final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
    final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: _Host());
    addTearDown(() {
      ui.dispose();
      editor.dispose();
      controller.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData(fontFamily: 'Barlow'),
        home: BoardUiScope(
          ui: ui,
          child: Scaffold(
            body: Stack(
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
    controller.user = const NativeUser(key: 'a:mara', name: 'Mara Kern');
    await tester.pumpAndSettle();
    final band = tester.getRect(find.byKey(const Key('privateBanner')));
    expect(tester.getRect(find.byKey(const Key('stachelMinimapToggle'))).top, greaterThanOrEqualTo(band.bottom));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/private_banner_phone.png'));
  }, skip: !Platform.isWindows);
}
