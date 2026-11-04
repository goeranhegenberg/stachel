// Example data from the real Stachel server (contract §8.9, copied from stachel/docs/native_fixtures/ into
// docs/native_fixtures/): the welcome of the board „Alle Typen“ parses completely, every type except the deliberately
// unknown one has a native renderer, and applying the 8 recorded patches yields exactly the server's fresh snapshot
// (objects and paint order). Re-copy the files whenever the server regenerates them (`tools/native-fixtures.mts`).
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'test_fonts.dart';

Object? _read(String name) => jsonDecode(File('../../../docs/native_fixtures/$name').readAsStringSync());

void main() {
  // due dates of cards relative to a fixed day (overdue, year), so the pictures do not change with the date
  setUpAll(() => cardNow = () => DateTime(2026, 11, 2));
  final welcomeJson = (_read('all_types.welcome.json') as Map).cast<String, Object?>();
  final patches = (_read('all_types.patches.json') as List).cast<Map<String, Object?>>();
  final after = (_read('all_types.after_patches.objects.json') as List).cast<Map<String, Object?>>();

  test('welcome: Verbindung, Schnappschuss in Zeichenreihenfolge, ext', () {
    final w = ServerMessage.parse(welcomeJson) as WelcomeMessage;
    expect(w.info.boardTitle, 'Alle Typen');
    expect(w.info.below, ['frame']);
    expect(w.info.user!.key, 'a:mara');
    expect(w.snapshot.skipped, 0);
    expect(w.snapshot.ext.keys, containsAll(['collab.comments', 'collab.reactions']));
    final state = BoardState()..applySnapshot(w.snapshot, rev: w.rev, epoch: w.epoch, below: w.info.below.toSet());
    expect(
      state.ordered.map((o) => o.id),
      w.snapshot.objects.map((o) => o.id),
      reason: 'gleiche Sortierregel wie der Server',
    );
  });

  test('jeder Typ außer dem absichtlich unbekannten hat einen nativen Renderer, alle Formen bekannt', () {
    final w = ServerMessage.parse(welcomeJson) as WelcomeMessage;
    final unknown = {
      for (final o in w.snapshot.objects)
        if (!o.isKnownType) o.type,
    };
    expect(unknown, {'future.widget'});
    final shapes = {
      for (final o in w.snapshot.objects)
        if (o.type == 'shape') o.shape,
    };
    expect(shapes.difference(shapeKinds.toSet()), isEmpty);
    expect(shapes.length, 41);
  });

  test('Rich-Text: Klartext jeder Notiz entspricht dem text-Spiegel des Servers', () {
    final w = ServerMessage.parse(welcomeJson) as WelcomeMessage;
    for (final o in w.snapshot.objects) {
      if (o.raw['content'] is! Map) continue;
      expect(o.richText, isNotNull, reason: '${o.id}: Rich-Text gilt (Klartext == text)');
    }
    final rich = w.snapshot.objects.firstWhere((o) => o.id == 'sticky_rich').richText!;
    expect(rich.blocks.map((b) => b.kind).toSet(), containsAll(RichBlockKind.values));
  });

  test('8 Patches ergeben genau den frischen Schnappschuss des Servers', () {
    final w = ServerMessage.parse(welcomeJson) as WelcomeMessage;
    final state = BoardState()..applySnapshot(w.snapshot, rev: w.rev, epoch: w.epoch, below: w.info.below.toSet());
    for (final p in patches) {
      final m = ServerMessage.parse(p);
      expect(m, isA<PatchMessage>(), reason: '${p['step']}');
      state.applyPatch(m as PatchMessage);
    }
    expect(state.rev, patches.length);
    expect(state.ordered.map((o) => o.id).toList(), after.map((o) => o['id']).toList());
    for (final o in after) {
      expect(state[o['id'] as String]!.raw, o, reason: '${o['id']}');
    }
  });

  testWidgets(
    'Golden: Server-Board „Alle Typen“ (Übersicht)',
    (tester) async {
      await loadBoardFonts();
      tester.view.physicalSize = const Size(1400, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final controller = BoardController(FixtureBoardSource.fromWelcome(welcomeJson));
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: RepaintBoundary(
            key: const Key('board'),
            child: BoardView(controller: controller),
          ),
        ),
      );
      await controller.start();
      for (var i = 0; i < 6; i++) {
        await tester.pump();
      }
      await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/server_all_types.png'));
    },
    skip: !Platform.isWindows,
    tags: ['golden'],
  );
}
