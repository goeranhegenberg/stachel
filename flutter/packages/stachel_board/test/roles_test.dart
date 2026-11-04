// Roles of instances with own accounts (contract §6, web `features/sharing/ReadOnlyGuard.tsx`): `view` only looks,
// `comment` also writes comments (comment, reply, edit/delete own, done/open, mentions read – the only ops the server
// takes from it), `edit`/`owner` everything. `mayComment`/`canComment` of the controller, `commentable` of the editor,
// the comment tool and the long press on the empty board for `comment`.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a0', 'text': 'Zelte'},
];

Map<String, Object?> _thread(String by) => {
  'x': 10,
  'y': 20,
  'resolved': false,
  'createdBy': by,
  'createdAt': '2026-11-01T10:00:00.000Z',
  'messages': [
    {'id': 'm1', 'by': by, 'name': 'Flo', 'text': 'Hallo', 'at': '2026-11-01T10:00:00.000Z'},
  ],
};

BoardSnapshot _snap() => BoardSnapshot.fromJson({
  'objects': _objects,
  'ext': {
    commentsExt: {'t1': _thread('m:1')},
  },
});

Future<(BoardController, FixtureBoardSource)> _live(String role) async {
  final s = FixtureBoardSource(_snap(), role: role);
  final c = BoardController(s, presenceInterval: Duration.zero);
  await c.start();
  await pumpEventQueue();
  // the own user (author of t1)
  s.push(
    WelcomeMessage(
      proto: 1,
      rev: 2,
      snapshot: _snap(),
      info: ConnectionInfo(
        epoch: 'fixture',
        role: role,
        user: const NativeUser(key: 'm:1', name: 'Flo'),
      ),
    ),
  );
  return (c, s);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

class _Log implements BoardGestureHandler {
  final events = <String>[];
  GestureHit Function(Offset p) hit = (_) => GestureHit.empty;
  @override
  bool editable = false;
  @override
  bool commentable = true;

  @override
  GestureHit hitAt(Offset p) => hit(p);
  @override
  void panStart(Offset p) => events.add('panStart');
  @override
  void panUpdate(Offset delta) => events.add('pan');
  @override
  void panEnd(Offset velocity) => events.add('panEnd');
  @override
  void pinchStart(Offset focal) {}
  @override
  void pinchUpdate(Offset focal, double scale) {}
  @override
  void pinchEnd() {}
  @override
  void tap(Offset p, GestureHit hit) => events.add('tap:${hit.objectId}');
  @override
  void doubleTap(Offset p, GestureHit hit) => events.add('doubleTap');
  @override
  void dragStart(Offset p, GestureHit hit, {required bool grabbed}) => events.add('dragStart');
  @override
  void dragUpdate(Offset p) => events.add('drag');
  @override
  void dragEnd() => events.add('dragEnd');
  @override
  void handleStart(String handle, Offset p) => events.add('handleStart');
  @override
  void handleUpdate(Offset p) {}
  @override
  void handleEnd() {}
  @override
  void longPressEmpty(Offset p) => events.add('menu');
  @override
  void longPressObject(Offset p, GestureHit hit) => events.add('objectMenu:${hit.objectId}');
  @override
  void marqueeStart(Offset p) => events.add('marqueeStart');
  @override
  void marqueeUpdate(Offset start, Offset p) {}
  @override
  void marqueeEnd() => events.add('marqueeEnd');
  @override
  void drawStart(Offset p) => events.add('drawStart');
  @override
  void drawUpdate(Offset p) {}
  @override
  void drawEnd(Offset p, {required bool moved}) {}
  @override
  void drawCancel() {}
}

Duration ms(int v) => Duration(milliseconds: v);

void main() {
  group('BoardController: mayComment / canComment', () {
    test('Rollen: owner/edit dürfen alles, comment nur kommentieren, view nichts', () async {
      for (final (role, edit, comment) in [
        ('owner', true, true),
        ('edit', true, true),
        ('comment', false, true),
        ('view', false, false),
      ]) {
        final (c, _) = await _live(role);
        expect((c.role, c.mayEdit, c.mayComment), (role, edit, comment));
        expect((c.canEdit, c.canComment), (edit, comment), reason: role);
        c.dispose();
      }
    });

    test('canComment folgt der Verbindung wie canEdit (offline nur im Fenster, geschlossen nie)', () async {
      final s = FixtureBoardSource(_snap(), role: 'comment');
      final c = BoardController(s, offlineEditWindow: const Duration(minutes: 5));
      expect(c.canComment, isFalse, reason: 'noch kein Stand vom Server');
      await c.start();
      await pumpEventQueue();
      expect(c.canComment, isTrue);
      s.drop();
      expect(c.canComment, isTrue, reason: 'kurz offline: Kommentare warten in der Schlange');
      s.drop(reason: 'no_access');
      expect(c.canComment, isFalse);
      c.dispose();

      // edit: canComment ist immer gleich canEdit (für Bearbeitende ändert sich nichts)
      final s2 = FixtureBoardSource(_snap());
      final c2 = BoardController(s2);
      await c2.start();
      await pumpEventQueue();
      expect((c2.canEdit, c2.canComment), (true, true));
      s2.drop(reason: 'board_deleted');
      expect((c2.canEdit, c2.canComment), (false, false));
      c2.dispose();
    });
  });

  group('Rolle im Gerätespeicher', () {
    test('toCache merkt die Rolle, restore zeigt sie vor dem welcome (ohne Rolle bleibt edit)', () async {
      final (c, _) = await _live('view');
      final entry = c.toCache('b1')!;
      expect(entry.role, 'view');
      final back = CachedBoard.fromJson(entry.toJson())!;
      expect(back.role, 'view');
      c.dispose();

      final offline = BoardController(FixtureBoardSource(_snap(), role: 'view'))..restore(back);
      expect((offline.role, offline.mayEdit, offline.mayComment), ('view', false, false));
      offline.dispose();

      final old = BoardController(FixtureBoardSource(_snap()))
        ..restore(CachedBoard(boardId: 'b1', snapshot: _snap(), epoch: 'e', rev: 1, savedAt: DateTime(2026)));
      expect((old.role, old.mayEdit), ('edit', true), reason: 'ältere Einträge ohne Rolle: wie bisher');
      expect(CachedBoard.fromJson(old.toCache('b1')?.toJson() ?? const {}), isNull, reason: 'noch nichts bestätigt');
      old.dispose();
    });
  });

  group('BoardEditor.commentable', () {
    test(
      'comment: Kommentar, Antwort, eigene bearbeiten/löschen, erledigen, gelesen gehen raus – sonst nichts',
      () async {
        final (c, s) = await _live('comment');
        final e = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
        expect((e.editable, e.commentable), (false, true));
        final id = e.addComment(const CommentAnchor(5, 5, objectId: 'n1'), 'Neu', const []);
        expect(id, isNotNull);
        e.replyComment('t1', 'Antwort', const []);
        e.editComment('t1', 'm1', 'Hallo!', const []);
        e.resolveComment('t1', resolved: true);
        e.markMentionsRead();
        e.deleteComment('t1', 'm1');
        expect(_ops(s).map((o) => o['op']), [
          'comment',
          'reply',
          'commentEdit',
          'resolve',
          'mentionsRead',
          'commentDelete',
        ]);
        // Reaktionen, Objekte, Verlauf: der Server lehnt sie für `comment` ab – die App schickt sie gar nicht
        e.toggleReaction(['n1'], '👍');
        expect(e.create('sticky', const Offset(400, 400)), isNull);
        c.undo();
        expect(_ops(s), hasLength(6));
        expect(s.sent.where((m) => m['t'] == 'undo'), isEmpty);
        e.dispose();
        c.dispose();
      },
    );

    test('view: auch keine Kommentare und kein Gelesen-Stand', () async {
      final (c, s) = await _live('view');
      final e = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
      expect((e.editable, e.commentable), (false, false));
      expect(e.addComment(const CommentAnchor(5, 5), 'Neu', const []), isNull);
      e.replyComment('t1', 'Antwort', const []);
      e.resolveComment('t1', resolved: true);
      e.markMentionsRead();
      e.deleteComment('t1');
      expect(_ops(s), isEmpty);
      e.dispose();
      c.dispose();
    });
  });

  group('Gesten nur lesen', () {
    test('comment: Halten auf leerer Fläche → Menü beim Loslassen, Ziehen schiebt die Ansicht (kein Rechteck)', () {
      final log = _Log();
      final g = BoardGestures(log);
      g.down(1, Offset.zero, ms(0));
      g.timeout(ms(300));
      g.up(1, ms(400));
      expect(log.events, ['menu']);

      log.events.clear();
      g.down(1, Offset.zero, ms(1000));
      g.timeout(ms(1300));
      g.move(1, const Offset(60, 60), ms(1400));
      g.up(1, ms(1500));
      expect(log.events.toSet(), {'panStart', 'pan', 'panEnd'});

      // ein Objekt halten: sein Menü (nicht greifen)
      log.events.clear();
      log.hit = (_) => const GestureHit(objectId: 'n1');
      g.down(1, Offset.zero, ms(2000));
      g.timeout(ms(2300));
      g.timeout(ms(2500));
      g.up(1, ms(2600));
      expect(log.events, ['objectMenu:n1']);
    });

    test('view: Halten auf leerer Fläche tut nichts, Loslassen ist ein Tippen', () {
      final log = _Log()..commentable = false;
      final g = BoardGestures(log);
      g.down(1, Offset.zero, ms(0));
      g.timeout(ms(300));
      g.up(1, ms(400));
      expect(log.events, ['tap:null']);
    });
  });

  group('BoardView mit Rolle', () {
    Future<(BoardController, FixtureBoardSource, BoardEditor, List<CommentAnchor>)> pump(
      WidgetTester tester,
      String role,
    ) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final source = FixtureBoardSource(_snap(), role: role);
      final controller = BoardController(source, presenceInterval: Duration.zero);
      addTearDown(controller.dispose);
      final editor = BoardEditor(
        controller: controller,
        scene: BoardScene(controller.state),
        camera: CameraController(),
      )..onHaptic = () {};
      addTearDown(editor.dispose);
      final at = <CommentAnchor>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BoardView(controller: controller, editor: editor, fitOnLoad: false, onCommentAt: at.add),
          ),
        ),
      );
      await controller.start();
      await tester.pump();
      await tester.pump();
      return (controller, source, editor, at);
    }

    testWidgets('comment: Kommentar-Werkzeug + Tippen auf die Notiz → Kommentar am Objekt; keine Notiz angelegt', (
      tester,
    ) async {
      final (_, source, editor, at) = await pump(tester, 'comment');
      editor.tool = BoardTool.comment;
      await tester.tapAt(const Offset(50, 50));
      await tester.pump(const Duration(milliseconds: 400));
      expect(at.single.objectId, 'n1');
      editor.tool = BoardTool.sticky;
      await tester.tapAt(const Offset(600, 500));
      await tester.pump(const Duration(milliseconds: 400));
      expect(_ops(source), isEmpty, reason: 'kein Anlegen mit der Rolle comment');
    });

    testWidgets('view: das Kommentar-Werkzeug tut nichts', (tester) async {
      final (_, source, editor, at) = await pump(tester, 'view');
      editor.tool = BoardTool.comment;
      await tester.tapAt(const Offset(50, 50));
      await tester.pump(const Duration(milliseconds: 400));
      expect(at, isEmpty);
      expect(_ops(source), isEmpty);
    });
  });
}
