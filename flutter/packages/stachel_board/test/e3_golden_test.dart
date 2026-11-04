// Goldens of what E3 draws over the board (concept §6.3): comment pins (normal, unread mention of me = pink),
// reaction chips under objects (own one marked), image upload placeholders (own with progress, someone else's
// „… lädt hoch“), pen and highlighter strokes, and the connector draft with the target's anchor points.
// Windows only: `flutter test --update-goldens test/e3_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'test_fonts.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 40, 'y': 40, 'w': 200, 'h': 200, 'text': 'Bühne', 'z': 'a0'},
  {'id': 'b', 'type': 'shape', 'shape': 'roundrect', 'x': 420, 'y': 60, 'w': 220, 'h': 120, 'z': 'a1', 'text': 'Strom', 'color': '#9fd3ff', 'stroke': '#0a0a0a', 'strokeWidth': 2},
  {
    'id': 'p1',
    'type': 'pen',
    'x': 60,
    'y': 330,
    'w': 300,
    'h': 60,
    'points': [4, 30, 80, 4, 160, 56, 240, 4, 296, 30],
    'color': '#ec4e92',
    'strokeWidth': 6,
    'z': 'a2',
  },
  {
    'id': 'p2',
    'type': 'pen',
    'x': 60,
    'y': 420,
    'w': 300,
    'h': 24,
    'points': [10, 12, 290, 12],
    'color': '#ffe14d',
    'strokeWidth': 20,
    'marker': true,
    'z': 'a3',
  },
];

final _ext = {
  'collab.comments': {
    'mine': {
      'x': 240,
      'y': 60,
      'objectId': 'a',
      'dx': 200,
      'dy': 20,
      'resolved': false,
      'createdBy': 'm:2',
      'createdAt': '2026-11-01T10:00:00Z',
      'messages': [
        {'id': 'x', 'by': 'm:2', 'name': 'Jonas', 'text': '@Mara?', 'at': '2026-11-01T10:00:00Z', 'mentions': ['m:1']},
      ],
    },
    'other': {
      'x': 660,
      'y': 60,
      'resolved': false,
      'createdBy': 'm:2',
      'createdAt': '2026-11-01T10:00:00Z',
      'messages': [
        {'id': 'y', 'by': 'm:2', 'name': 'Jonas', 'text': 'eins', 'at': '2026-11-01T10:00:00Z'},
        {'id': 'z', 'by': 'm:1', 'name': 'Mara', 'text': 'zwei', 'at': '2026-11-01T10:01:00Z'},
      ],
    },
  },
  'collab.reactions': {
    'a|👍|m:2': {'o': 'a', 'e': '👍', 'u': 'm:2', 'n': 'Jonas', 'at': '2026-11-01T10:00:00Z'},
    'a|👍|m:1': {'o': 'a', 'e': '👍', 'u': 'm:1', 'n': 'Mara', 'at': '2026-11-01T10:00:01Z'},
    'a|🎉|m:2': {'o': 'a', 'e': '🎉', 'u': 'm:2', 'n': 'Jonas', 'at': '2026-11-01T10:00:02Z'},
  },
};

void main() {
  setUpAll(() async {
    await loadBoardFonts();
  });

  testWidgets('Kommentar-Pins, Reaktionen, Upload-Platzhalter, Stift/Textmarker, Verbinder-Entwurf', (tester) async {
    tester.view.physicalSize = const Size(900, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final source = FixtureBoardSource(BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: _ext));
    final controller = BoardController(source);
    addTearDown(controller.dispose);
    final scene = BoardScene(controller.state);
    final editor = BoardEditor(controller: controller, scene: scene, camera: CameraController());
    addTearDown(editor.dispose);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: RepaintBoundary(
          key: const Key('board'),
          child: BoardView(controller: controller, editor: editor, fitOnLoad: false),
        ),
      ),
    );
    await controller.start();
    source.push(
      WelcomeMessage(
        proto: 1,
        rev: 2,
        snapshot: BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: _ext),
        info: const ConnectionInfo(
          epoch: 'fixture',
          user: NativeUser(key: 'm:1', name: 'Mara'),
          peers: [
            Peer(
              id: 9,
              key: 'm:2',
              name: 'Jonas Keller',
              color: '#ec4e92',
              extra: {
                'collab.uploads': [
                  {'x': 680, 'y': 300, 'w': 180, 'h': 120, 'color': '#5c940d'},
                ],
              },
            ),
          ],
        ),
      ),
    );
    controller.uploads.value = [const BoardUpload(key: 'u', rect: Rect.fromLTWH(420, 260, 220, 150), color: '#4f87e0', progress: 0.4)];
    editor.draft.value = ConnectorDraft(const Offset(240, 140), const Offset(415, 118), anchorsOf: controller.state['b'], snapped: const Offset(420, 120));
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/e3_overlays.png'));
  }, skip: !Platform.isWindows);
}
