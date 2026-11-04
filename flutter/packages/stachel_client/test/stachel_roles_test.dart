// Roles of instances with own accounts in the shared screens (contract §6, web `features/sharing/*`,
// `pages/account/boardsLocal.tsx`): board screen with `view` (only look: no tool bar, context bar, undo, comments
// only read; hint „Nur ansehen“), `comment` (plus writing comments: „Kommentar hinzufügen“, „Hier kommentieren“,
// reply, done; hint „Kommentieren“), `edit` unchanged; „Teilen …“ in the board menu; the board list with the role per
// board and the menu by role (`ROUTE_ROLES`).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Zelte', 'z': 'a0', 'color': '#fff27a'},
  {'id': 's1', 'type': 'shape', 'shape': 'ellipse', 'x': 300, 'y': 0, 'w': 200, 'h': 120, 'text': '', 'z': 'a1'},
];

/// A thread of Mara's on the note, mentioning me (Flo).
Map<String, Object?> _ext() => {
  'collab.comments': {
    't1': {
      'x': 100,
      'y': 100,
      'objectId': 'n1',
      'dx': 100,
      'dy': 100,
      'resolved': false,
      'createdBy': 'u:mara',
      'createdAt': '2026-11-01T10:00:00Z',
      'messages': [
        {
          'id': 'x',
          'by': 'u:mara',
          'name': 'Mara',
          'text': '@Flo reicht das?',
          'at': '2026-11-01T10:00:00Z',
          'mentions': ['u:flo'],
        },
      ],
    },
  },
};

Future<(FixtureBoardSource, FakeStachelServer)> _board(WidgetTester tester, String role, {bool roles = true}) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  final server = FakeStachelServer(myRole: role);
  final client = TestStachelClient(server.client, showsRoles: roles);
  final snap = BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: _ext());
  final source = FixtureBoardSource(snap, rev: 9, title: 'Festival', role: role);
  tester.view.physicalSize = const Size(700, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: StachelBoardScreen(
        client: client,
        boardId: 'b1',
        boardsApi: TestBoardsApi(client),
        source: source,
        images: NoBoardImages(),
        cache: MemoryBoardCache(),
        uploads: MemoryStachelUploads(),
        pendingStore: MemoryPendingStore(),
        people: () async => const [Person('u:mara', 'Mara'), Person('u:flo', 'Flo')],
        template: false,
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
  source.push(
    WelcomeMessage(
      proto: 1,
      rev: 9,
      snapshot: snap,
      info: ConnectionInfo(
        epoch: 'fixture',
        boardTitle: 'Festival',
        role: role,
        user: const NativeUser(key: 'u:flo', name: 'Flo'),
        features: const ['objects', 'ext', 'ops', 'undo', 'text', 'comments', 'reactions', 'uploads'],
      ),
    ),
  );
  for (var i = 0; i < 3; i++) {
    await tester.pump();
  }
  return (source, server);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

BoardViewState _view(WidgetTester tester) => tester.state<BoardViewState>(find.byType(BoardView));

BoardUi _ui(WidgetTester tester) => tester.widget<BoardUiScope>(find.byType(BoardUiScope)).ui;

/// Keys of the entries of menu [on] (without opening it).
List<String?> _menu(WidgetTester tester, MenuTarget on, {String? objectId}) => [
  for (final e in menuEntries(_ui(tester), on, MenuAt(const Offset(600, 600), objectId: objectId))) e.key,
];

/// An empty spot of the board on the screen (bottom left of the view).
Offset _empty(WidgetTester tester) {
  final box = tester.renderObject<RenderBox>(find.byType(BoardView));
  return box.localToGlobal(Offset(30, box.size.height - 40));
}

/// Screen point of board point [world].
Offset _at(WidgetTester tester, Offset world) {
  final box = tester.renderObject<RenderBox>(find.byType(BoardView));
  return box.localToGlobal(_view(tester).camera.value.toScreen(world));
}

Future<void> _openThread(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('stachelBoardMenu')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('stachelBoardComments')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('stachelCommentItem-t1')));
  await tester.pumpAndSettle();
}

/// Board menu entries that write to the board or need `edit` on the server.
const _editOnly = [
  'stachelBoardRename',
  'stachelBoardVersions',
  'collabMenuTimer',
  'collabMenuTimerSet',
  'stachelBoardShowAll',
];

void main() {
  group('Board mit Rolle', () {
    testWidgets('view: nur ansehen – keine Werkzeuge, keine Kontextleiste, Kommentare nur lesen, Hinweis', (
      tester,
    ) async {
      final (source, _) = await _board(tester, 'view');
      expect(find.byKey(const Key('stachelRoleBadge')), findsOneWidget);
      // UX-A1 (P1): in the app bar only the symbol, the text as tooltip and for TalkBack
      expect(find.byTooltip('Du kannst dieses Board nur ansehen.'), findsOneWidget);
      expect(find.bySemanticsLabel('Nur ansehen'), findsOneWidget);
      expect(find.byType(BoardToolbar), findsNothing);
      expect(find.byKey(const Key('stachelUndo')), findsNothing);
      expect(find.byKey(const Key('stachelCommentTool')), findsNothing);
      // view cannot mark mentions read: no notice that would stay forever
      expect(find.byKey(const Key('stachelMentioned')), findsNothing);

      // tapping an object: no context bar (web hides it); the object menu keeps link and browser, no „Kommentieren“
      await tester.tapAt(_at(tester, const Offset(50, 50)));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(BoardContextBar), findsNothing);
      final objectMenu = _menu(tester, MenuTarget.object, objectId: 'n1');
      expect(objectMenu, containsAll(['stachelMenuLink', 'stachelMenuBrowser']));
      expect(objectMenu, isNot(contains('stachelMenuComment')));
      expect(objectMenu, isNot(contains('stachelMenuDelete')));
      expect(_menu(tester, MenuTarget.canvas), isNot(contains('stachelCommentHere')));

      // board menu: look, search, frames, comments, export, share – nothing that writes
      final board = _menu(tester, MenuTarget.board);
      expect(
        board,
        containsAll(['stachelBoardComments', 'stachelBoardFrames', 'stachelBoardExport', 'stachelBoardShare']),
      );
      for (final k in _editOnly) {
        expect(board, isNot(contains(k)), reason: k);
      }

      // holding the empty board: no menu
      final g = await tester.startGesture(_empty(tester));
      await tester.pump(const Duration(milliseconds: 600));
      await g.up();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelCanvasMenu')), findsNothing);

      // the thread: read, no reply, no „erledigt“
      await _openThread(tester);
      expect(find.byKey(const Key('stachelThread')), findsOneWidget);
      expect(find.text('@Flo reicht das?', findRichText: true), findsOneWidget);
      expect(find.byKey(const Key('stachelCommentField')), findsNothing);
      expect(find.byKey(const Key('stachelThreadResolve')), findsNothing);
      expect(_ops(source), isEmpty, reason: 'view sendet nichts (der Server lehnte alles ab)');
    });

    testWidgets('comment: „Kommentar hinzufügen“ → auf die Notiz tippen → Kommentar; antworten, erledigen', (
      tester,
    ) async {
      final (source, _) = await _board(tester, 'comment');
      expect(find.bySemanticsLabel('Kommentieren'), findsOneWidget); // UX-A1: the badge is the symbol
      expect(find.byType(BoardToolbar), findsNothing);
      expect(find.byKey(const Key('stachelUndo')), findsNothing);
      expect(find.byKey(const Key('stachelMentioned')), findsOneWidget);
      expect(find.text('Kommentar hinzufügen'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelCommentTool')));
      await tester.pump();
      expect(_view(tester).editor.tool, BoardTool.comment);
      expect(find.text('Kommentieren: auf das Board tippen'), findsOneWidget);
      await tester.tapAt(_at(tester, const Offset(50, 50)));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('stachelCommentField')), 'Reicht nicht');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCommentSend')));
      await tester.pumpAndSettle();
      final op = _ops(source).last;
      expect((op['op'], op['text'], (op['at'] as Map)['objectId']), ('comment', 'Reicht nicht', 'n1'));
      expect(_view(tester).editor.tool, BoardTool.select);

      // the thread: reply and done (the ops the server takes from `comment`)
      await _openThread(tester);
      expect(_ops(source).last['op'], 'mentionsRead');
      await tester.enterText(find.byKey(const Key('stachelCommentField')), 'Ja');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCommentSend')));
      await tester.pumpAndSettle();
      expect((_ops(source).last['op'], _ops(source).last['thread']), ('reply', 't1'));
      await tester.tap(find.byKey(const Key('stachelThreadResolve')));
      await tester.pumpAndSettle();
      expect(_ops(source).last, {'op': 'resolve', 'thread': 't1', 'resolved': true});
      await tester.tapAt(const Offset(350, 40)); // close the sheet
      await tester.pumpAndSettle();

      // no context bar; „Kommentieren“ in the object menu, „Hier kommentieren“ in the board's
      _view(tester).editor.select({'n1'});
      await tester.pump();
      expect(find.byType(BoardContextBar), findsNothing);
      final objectMenu = _menu(tester, MenuTarget.object, objectId: 'n1');
      expect(objectMenu, contains('stachelMenuComment'));
      expect(objectMenu, isNot(contains('stachelMenuDelete')));
      final board = _menu(tester, MenuTarget.board);
      for (final k in _editOnly) {
        expect(board, isNot(contains(k)), reason: k);
      }
      _view(tester).editor.select(const {});
      await tester.pump();

      // holding the empty board: its menu with „Hier kommentieren“ → a free comment there
      final g = await tester.startGesture(_empty(tester));
      await tester.pump(const Duration(milliseconds: 400));
      await g.up();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelCanvasMenu')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelCommentHere')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('stachelCommentField')), 'Hier fehlt was');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCommentSend')));
      await tester.pumpAndSettle();
      final free = _ops(source).last;
      expect((free['op'], (free['at'] as Map)['objectId']), ('comment', null));
      // nothing but comment ops went out
      expect(
        _ops(source).map((o) => o['op']).toSet().difference({'comment', 'reply', 'resolve', 'mentionsRead'}),
        isEmpty,
      );
    });

    testWidgets('edit: alles wie bisher (Werkzeuge, Rückgängig, Kontextleiste), kein Hinweis; Teilen im Menü', (
      tester,
    ) async {
      await _board(tester, 'edit');
      expect(find.byKey(const Key('stachelRoleBadge')), findsNothing);
      expect(find.byType(BoardToolbar), findsOneWidget);
      expect(find.byKey(const Key('stachelUndo')), findsOneWidget);
      expect(find.byKey(const Key('stachelCommentTool')), findsNothing);
      _view(tester).editor.select({'n1'});
      await tester.pump();
      expect(find.byType(BoardContextBar), findsOneWidget);
      final board = _menu(tester, MenuTarget.board);
      expect(board, containsAll(['stachelBoardRename', 'stachelBoardVersions', 'stachelBoardShare']));
    });

    testWidgets('ohne Rollen (Host-App, Modus org): kein „Teilen …“ im Board-Menü', (tester) async {
      await _board(tester, 'edit', roles: false);
      expect(_menu(tester, MenuTarget.board), isNot(contains('stachelBoardShare')));
    });

    testWidgets('„Teilen …“ im Board-Menü öffnet den Teilen-Dialog des Boards', (tester) async {
      final (_, server) = await _board(tester, 'owner');
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelBoardShare')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelShareSheet')), findsOneWidget);
      expect(server.calls('GET', '/api/boards/b1/share'), hasLength(1));
      expect(find.text('Mara'), findsOneWidget);
    });

    testWidgets('Rolle beim Wiederverbinden geändert (access_changed): Werkzeuge kommen bzw. gehen', (tester) async {
      final (source, _) = await _board(tester, 'view');
      expect(find.byType(BoardToolbar), findsNothing);
      source.push(
        WelcomeMessage(
          proto: 1,
          rev: 10,
          snapshot: BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)], ext: _ext()),
          info: const ConnectionInfo(
            epoch: 'fixture',
            role: 'edit',
            user: NativeUser(key: 'u:flo', name: 'Flo'),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.byType(BoardToolbar), findsOneWidget);
      expect(find.byKey(const Key('stachelRoleBadge')), findsNothing);
    });
  });

  group('Board-Liste mit Rollen', () {
    Future<FakeStachelServer> home(WidgetTester tester, {bool roles = true}) async {
      SharedPreferences.setMockInitialValues({});
      await StachelSession.clear();
      final server = FakeStachelServer();
      final client = TestStachelClient(server.client, showsRoles: roles);
      tester.view.physicalSize = const Size(900, 2000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: StachelHomeScreen(
            client: client,
            boardsApi: TestBoardsApi(client),
            boardScreen: (id, title, object) => Scaffold(body: Text('Board $id')),
            showNativePreview: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      return server;
    }

    Future<void> openMenu(WidgetTester tester, String id) async {
      await tester.tap(find.byKey(Key('stachelMenu-$id')));
      await tester.pumpAndSettle();
    }

    Future<void> closeMenu(WidgetTester tester) async {
      await tester.tapAt(const Offset(5, 5));
      await tester.pumpAndSettle();
    }

    testWidgets('Rolle an der Karte (nicht beim eigenen Board), Menü nach Rolle', (tester) async {
      await home(tester);
      expect(find.byKey(const Key('stachelRole-b1')), findsNothing, reason: 'Besitzer:in: wie das Web ohne Hinweis');
      expect(
        find.descendant(of: find.byKey(const Key('stachelRole-b2')), matching: find.text('Kann bearbeiten')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('stachelRole-b3')), matching: find.text('Kann kommentieren')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('stachelRole-b4')), matching: find.text('Kann ansehen')),
        findsOneWidget,
      );

      // own board: rename, share, delete
      await openMenu(tester, 'b1');
      expect(find.byKey(const Key('stachelRename-b1')), findsOneWidget);
      expect(find.byKey(const Key('stachelShare-b1')), findsOneWidget);
      expect(tester.widget<PopupMenuItem<String>>(find.byKey(const Key('stachelDelete-b1'))).enabled, isTrue);
      await closeMenu(tester);

      // edit: rename yes, delete only the owner
      await openMenu(tester, 'b2');
      expect(find.byKey(const Key('stachelRename-b2')), findsOneWidget);
      expect(tester.widget<PopupMenuItem<String>>(find.byKey(const Key('stachelDelete-b2'))).enabled, isFalse);
      expect(find.text(stachelOwnerDeleteReason), findsOneWidget);
      await closeMenu(tester);

      // view: no rename; copies (duplicate, template) are allowed with `view` (ROUTE_ROLES), share to see/leave
      await openMenu(tester, 'b4');
      expect(find.byKey(const Key('stachelRename-b4')), findsNothing);
      expect(find.byKey(const Key('stachelDuplicate-b4')), findsOneWidget);
      expect(find.byKey(const Key('stachelSaveTemplate-b4')), findsOneWidget);
      expect(find.byKey(const Key('stachelShare-b4')), findsOneWidget);
      expect(tester.widget<PopupMenuItem<String>>(find.byKey(const Key('stachelDelete-b4'))).enabled, isFalse);
      await closeMenu(tester);

      await openMenu(tester, 'b3');
      expect(find.byKey(const Key('stachelRename-b3')), findsNothing);
    });

    testWidgets('„Teilen …“ aus dem Menü: Dialog; Board verlassen nimmt es aus der Liste', (tester) async {
      final server = await home(tester);
      server
        ..myRole = 'view'
        ..people = [
          {'key': 'u:mara', 'name': 'Mara', 'role': 'owner', 'via': 'owner'},
          {'key': 'u:flo', 'name': 'Flo', 'role': 'view', 'via': 'member'},
        ];
      await openMenu(tester, 'b4');
      await tester.tap(find.byKey(const Key('stachelShare-b4')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelShareSheet')), findsOneWidget);
      // (the fake answers b1's sharing state for every board – enough to leave)
      await tester.tap(find.byKey(const Key('stachelShareRole-u:flo')));
      await tester.pumpAndSettle();
      server.boards.removeWhere((b) => b['id'] == 'b4');
      await tester.tap(find.byKey(const Key('stachelShareChoice-remove')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelShareSheet')), findsNothing);
      expect(find.byKey(const Key('stachelBoard-b4')), findsNothing);
      expect(find.text('Du hast „Kasse“ verlassen.'), findsOneWidget);
    });

    testWidgets('ohne Rollen (Host-App, Modus org): keine Rolle, kein Teilen, Umbenennen überall', (tester) async {
      await home(tester, roles: false);
      expect(find.byKey(const Key('stachelRole-b4')), findsNothing);
      await openMenu(tester, 'b4');
      expect(find.byKey(const Key('stachelRename-b4')), findsOneWidget);
      expect(find.byKey(const Key('stachelShare-b4')), findsNothing);
    });
  });
}
