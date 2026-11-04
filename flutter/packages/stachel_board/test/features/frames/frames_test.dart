// P4 frames (parity audit C12, E15, H02–H05, H08): frame tool with formats (tap = format at the finger, drawing keeps
// the aspect ratio), context bar „Format“ and „Raster“ (sizes, A1 B2), frame list (order like the web, reorder by the
// grip = web action `frames.reorder`), presentation (fitted above the bar, paging by swipe / thirds / buttons, no
// editing, fullscreen remembered, `structure.present` for the others, camera back) and following a presenter.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/frames/frame_tool.dart';
import 'package:stachel_board/src/features/view/view_camera.dart';

import '../view/p4_harness.dart';

Map<String, Object?> frame(
  String id,
  double x,
  double y, {
  double w = 640,
  double h = 420,
  String? title,
  String? slide,
}) => {'id': id, 'type': 'frame', 'x': x, 'y': y, 'w': w, 'h': h, 'title': ?title, 'slide': ?slide, 'color': '#ffffff'};

const _frames = [
  {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 0, 'w': 640, 'h': 420, 'title': 'Start', 'color': '#ffffff'},
  {'id': 'f2', 'type': 'frame', 'x': 800, 'y': 30, 'w': 640, 'h': 420, 'title': 'Mitte', 'color': '#ffffff'},
  {'id': 'f3', 'type': 'frame', 'x': 0, 'y': 700, 'w': 1280, 'h': 720, 'title': '', 'color': '#ffffff'},
  {'id': 'n1', 'type': 'sticky', 'x': 50, 'y': 50, 'w': 200, 'h': 200, 'text': 'Im Rahmen'},
];

void main() {
  setUp(() => framePresetOption.value = 'free');

  group('Rahmen-Werkzeug mit Formaten (C12)', () {
    testWidgets('Format wählen, Tippen = Rahmen im Format um den Finger, „Rahmen n“, gewählt; danach Auswahl', (
      tester,
    ) async {
      final b = await pumpP4(tester, objects: [frame('f1', 5000, 5000)]);
      await tester.tap(find.byKey(const Key('stachelToolFrame')));
      await tester.pump();
      expect(find.byKey(const Key('stachelFrameFormats')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelFrameFormat-16:9')));
      await tester.pump();
      final at = b.view.viewSize.center(Offset.zero);
      await tester.tapAt(tester.getTopLeft(find.byType(BoardView)) + at);
      await tester.pump();
      final create = b.ops.lastWhere((o) => o['op'] == 'create');
      final o = (create['objects'] as List).single as Map;
      final w = b.cam.toWorld(at);
      expect((o['type'], o['w'], o['h'], o['title'], o['color']), ('frame', 1280.0, 720.0, 'Rahmen 2', '#ffffff'));
      expect(o['x'], (w.dx - 640).roundToDouble());
      expect(o['y'], (w.dy - 360).roundToDouble());
      expect(b.editor.selection.value, {o['id']});
      expect(b.editor.activeToolId, 'select', reason: 'einmalig (C19)');
    });

    testWidgets('Aufziehen hält das Seitenverhältnis (A4), „Frei“ nimmt das gezogene Rechteck', (tester) async {
      final b = await pumpP4(tester);
      final origin = tester.getTopLeft(find.byType(BoardView));
      Future<Map> draw(String preset, Offset from, Offset by) async {
        framePresetOption.value = preset;
        b.editor.useTool('frame');
        await tester.pump();
        final g = await tester.startGesture(origin + from);
        await g.moveBy(by / 2);
        await tester.pump();
        expect(frameDraft.value, isNotNull, reason: 'Vorschau beim Ziehen');
        await g.moveBy(by / 2);
        await g.up();
        await tester.pump();
        return (b.ops.lastWhere((o) => o['op'] == 'create')['objects'] as List).single as Map;
      }

      final a4 = await draw('a4', const Offset(60, 100), const Offset(150, 60));
      final w = (a4['w'] as num).toDouble(), h = (a4['h'] as num).toDouble();
      expect(w / h, closeTo(794 / 1123, 0.02));
      final free = await draw('free', const Offset(60, 100), const Offset(150, 60));
      expect(((free['w'] as num) / b.cam.z).round(), closeTo(150 / b.cam.z, 2));
      expect(free['h'], closeTo(60 / b.cam.z, 2));
    });
  });

  group('Kontextleiste Rahmen (E15)', () {
    testWidgets('Format setzt Breite/Höhe (aktuelles markiert), Raster 50 … 200 + „A1 B2“, Ohne entfernt beides', (
      tester,
    ) async {
      final b = await pumpP4(tester, objects: _frames);
      b.editor.select({'f1'});
      await tester.pump();
      Future<void> ctx(String key) async {
        final f = find.byKey(Key(key));
        if (f.evaluate().isEmpty) {
          await tester.tap(find.byKey(const Key('stachelCtxMore')));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.byKey(Key(key)).last);
        await tester.pumpAndSettle();
      }

      await ctx('stachelCtxFrameFormat');
      expect(find.text('Handy'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelFrameFormatPick-phone')));
      await tester.pumpAndSettle();
      expect(b.ops.last, {
        'op': 'update',
        'patches': {
          'f1': {'w': 390.0, 'h': 844.0},
        },
      });
      await ctx('stachelCtxFrameGrid');
      expect(
        tester.widget<ChoiceChip>(find.byKey(const Key('stachelFrameGridLabels'))).onSelected,
        isNull,
        reason: 'erst mit Raster',
      );
      await tester.tap(find.byKey(const Key('stachelFrameGrid-100')));
      await tester.pump();
      expect((b.ops.last['patches'] as Map)['f1'], {'frameGrid': 100.0});
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelFrameGridLabels')));
      await tester.pump();
      expect((b.ops.last['patches'] as Map)['f1'], {'frameGridLabels': true});
      await tester.tap(find.byKey(const Key('stachelFrameGrid-0')));
      await tester.pump();
      expect((b.ops.last['patches'] as Map)['f1'], {'frameGrid': null, 'frameGridLabels': null});
    });
  });

  group('Rahmen-Liste (H01, H02)', () {
    testWidgets(
      'Reihenfolge wie im Web (slide zuerst), Antippen fährt hin (max 200 %), Ziehen am Griff → frames.reorder',
      (tester) async {
        final b = await pumpP4(
          tester,
          objects: [
            ..._frames,
            frame('f0', 3000, 3000, title: 'Zuerst', slide: 'a0'),
          ],
        );
        b.ui.openRegisteredSheet(tester.element(find.byType(BoardView)), framesListSheet);
        await tester.pumpAndSettle();
        final items = find.byWidgetPredicate(
          (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('stachelFrameItem-'),
        );
        expect(
          [for (final e in items.evaluate()) (e.widget.key! as ValueKey<String>).value.substring(17)],
          ['f0', 'f1', 'f2', 'f3'],
        );
        expect(find.text('Rahmen'), findsOneWidget, reason: 'ohne Titel: „Rahmen“');
        // drag f3 (last) to the top by its grip
        final grip = find.byKey(const Key('stachelFrameGrip-f3'));
        final g = await tester.startGesture(tester.getCenter(grip));
        await tester.pump(const Duration(milliseconds: 100));
        for (var i = 0; i < 10; i++) {
          await g.moveBy(const Offset(0, -30));
          await tester.pump(const Duration(milliseconds: 16));
        }
        await g.up();
        await tester.pumpAndSettle();
        final act = b.ops.lastWhere((o) => o['op'] == 'act');
        expect(act['name'], 'frames.reorder');
        expect(act['args'], {'id': 'f3', 'to': 0});
        // until the answer the list keeps the new order
        expect((tester.widget(items.first).key! as ValueKey<String>).value, 'stachelFrameItem-f3');
        await tester.tap(find.byKey(const Key('stachelFrameItem-f2')));
        await tester.pumpAndSettle();
        expect(b.cam, closeCam(fitCamera(const Rect.fromLTWH(800, 30, 640, 420), b.view.viewSize)));
      },
    );

    testWidgets('ohne Web-Aktion keine Griffe; leer: Hinweis', (tester) async {
      final b = await pumpP4(tester, objects: _frames, actions: const {});
      b.ui.openRegisteredSheet(tester.element(find.byType(BoardView)), framesListSheet);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelFrameGrip-f1')), findsNothing);
      expect(find.byKey(const Key('stachelPresent')), findsOneWidget);
    });
  });

  group('Präsentation (H03, H04, H08)', () {
    testWidgets(
      'Präsentieren: Leisten weg, Rahmen eingepasst (max 400 %), Wischen/Drittel blättern, Zurück beendet, Kamera zurück',
      (tester) async {
        final immersive = <bool>[];
        final b = await pumpP4(tester, objects: _frames);
        BoardViewPrefs.setSystemImmersive = (on) async => immersive.add(on);
        b.view.camera.value = const Camera(10, 20, 0.5);
        b.editor.select({'n1'});
        await tester.pump();
        b.ui.openRegisteredSheet(tester.element(find.byType(BoardView)), framesListSheet);
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('stachelPresent')));
        await tester.pumpAndSettle();
        expect(b.ui.presenting.value, isTrue);
        expect(b.editor.selection.value, isEmpty);
        expect(find.byType(AppBar), findsNothing);
        expect(find.byType(BoardToolbar), findsNothing);
        expect(find.byKey(const Key('stachelZoomBar')), findsNothing);
        expect(immersive, [true], reason: 'Vollbild (Standard an)');
        Camera fitted(String id) {
          final o = b.controller.state[id]!;
          return Camera.fit(
            Rect.fromLTWH(o.x, o.y, o.w, o.h),
            b.view.viewSize,
            padding: presentInsets,
            maxZoomFit: maxZoom,
          );
        }

        expect(b.cam, closeCam(fitted('f1')));
        expect(find.text('1 / 3'), findsOneWidget);
        expect(find.text('Start'), findsOneWidget);
        expect(b.controller.presence.extra['structure.present'], {
          'frameId': 'f1',
          'index': 0,
          'total': 3,
          'title': 'Start',
        });
        final board = tester.getRect(find.byType(BoardView));
        // swipe left → next
        await tester.dragFrom(board.center, const Offset(-120, 10));
        await tester.pumpAndSettle();
        expect(find.text('2 / 3'), findsOneWidget);
        expect(b.cam, closeCam(fitted('f2')));
        // tap in the right third → next; left third → back
        await tester.tapAt(Offset(board.left + board.width * 0.9, board.top + 100));
        await tester.pumpAndSettle();
        expect(find.text('3 / 3'), findsOneWidget);
        expect(find.text('Rahmen'), findsOneWidget, reason: 'ohne Titel');
        await tester.tapAt(Offset(board.left + board.width * 0.1, board.top + 100));
        await tester.pumpAndSettle();
        expect(find.text('2 / 3'), findsOneWidget);
        // the middle: nothing (no editing, nothing selected)
        await tester.tapAt(Offset(board.center.dx, board.top + 100));
        await tester.pumpAndSettle();
        expect(find.text('2 / 3'), findsOneWidget);
        expect(b.editor.selection.value, isEmpty);
        // „Andere folgen lassen“ off → nothing published
        await tester.tap(find.byKey(const Key('stachelPresentShare')));
        await tester.pump();
        expect(b.controller.presence.extra.containsKey('structure.present'), isFalse);
        await tester.tap(find.byKey(const Key('stachelPresentShare')));
        await tester.pump();
        expect((b.controller.presence.extra['structure.present']! as Map)['index'], 1);
        // fullscreen off is remembered
        await tester.tap(find.byKey(const Key('stachelPresentFullscreen')));
        await tester.pump();
        expect((immersive.last, BoardPrefs.get(BoardPrefs.presentFullscreen)), (false, '0'));
        // back ends the presentation, camera returns
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(b.ui.presenting.value, isFalse);
        expect(find.byType(AppBar), findsOneWidget);
        expect(b.cam, closeCam(const Camera(10, 20, 0.5)));
        expect(b.controller.presence.extra.containsKey('structure.present'), isFalse);
        // next time no fullscreen (remembered)
        Presentation.of(b.ui).start(2);
        await tester.pumpAndSettle();
        expect(immersive.last, isFalse);
        expect(find.text('3 / 3'), findsOneWidget);
        await tester.tap(find.byKey(const Key('stachelPresentExit')));
        await tester.pumpAndSettle();
        expect(b.ui.presenting.value, isFalse);
      },
    );
  });

  group('Folgen (H05)', () {
    testWidgets('„Mara präsentiert · 2/3 · Mitte“ + Folgen passt jeden Rahmen ein; endet mit der Präsentation', (
      tester,
    ) async {
      final b = await pumpP4(tester, objects: _frames);
      Peer mara(Map<String, Object?>? present) =>
          Peer(id: 7, key: 'k:mara', name: 'Mara', color: '#ec4e92', extra: {'structure.present': ?present});
      b.source.push(
        PresenceMessage([
          mara({'frameId': 'f2', 'index': 1, 'total': 3, 'title': 'Mitte'}),
        ]),
      );
      await tester.pump();
      expect(find.text('Mara präsentiert · 2/3 · Mitte'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelFollowPresenterButton')));
      await tester.pumpAndSettle();
      expect(find.text('Nicht mehr folgen'), findsOneWidget);
      expect(b.cam, closeCam(fitCamera(const Rect.fromLTWH(800, 30, 640, 420), b.view.viewSize, maxZoomFit: maxZoom)));
      b.source.push(
        PresenceMessage([
          mara({'frameId': 'f3', 'index': 2, 'total': 3, 'title': 'Rahmen'}),
        ]),
      );
      await tester.pumpAndSettle();
      expect(b.cam, closeCam(fitCamera(const Rect.fromLTWH(0, 700, 1280, 720), b.view.viewSize, maxZoomFit: maxZoom)));
      b.source.push(PresenceMessage([mara(null)]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelFollowPresenter')), findsNothing);
    });
  });
}
