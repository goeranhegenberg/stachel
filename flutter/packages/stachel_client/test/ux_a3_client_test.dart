// UX-A3 in den App-Bildschirmen (docs/ux_review_app_2026-11.md P7, P11, P15): Filter „Alle / Meine Boards / Mit mir
// geteilt / Favoriten“ der Board-Liste (Konten-Instanz, gemerkt je Gerät, web `boardsLocal.tsx`), „Blockierte
// Personen“ nur ohne eigene Konto-Seite in der Leiste, Schreibleiste in einer Zeile ohne totes Etikett, Board-Menü mit
// Kommentar-Kachel samt Zähler.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

class _AccountClient extends TestStachelClient {
  _AccountClient(super.httpClient);

  @override
  bool get blockedPeopleInAccount => true;
}

void main() {
  group('Filter der Board-Liste (P15, R10)', () {
    StachelBoardInfo info(String id, {String createdBy = 'u:me', String? role, bool favorite = false}) =>
        StachelBoardInfo.fromJson({
          'id': id,
          'title': id,
          'createdBy': createdBy,
          'role': ?role,
          'favorite': favorite,
        })!;

    test('Meine / Mit mir geteilt nach Rolle, sonst nach createdBy; Favoriten', () {
      final list = [
        info('own', role: 'owner'),
        info('edit', createdBy: 'u:me', role: 'edit'), // role decides: shared with me
        info('old', createdBy: 'u:me'),
        info('other', createdBy: 'u:jo', favorite: true),
      ];
      List<String> ids(StachelOwnerFilter f) => [for (final b in filterBoards(list, f, 'u:me')) b.id];
      expect(ids(StachelOwnerFilter.all), ['own', 'edit', 'old', 'other']);
      expect(ids(StachelOwnerFilter.mine), ['own', 'old']);
      expect(ids(StachelOwnerFilter.shared), ['edit', 'other']);
      expect(ids(StachelOwnerFilter.favorites), ['other']);
      expect(StachelOwnerFilter.parse('shared'), StachelOwnerFilter.shared);
      expect(StachelOwnerFilter.parse('quatsch'), StachelOwnerFilter.all);
    });

    Future<void> home(WidgetTester tester, StachelClient client, {Map<String, Object> prefs = const {}}) async {
      SharedPreferences.setMockInitialValues(prefs);
      await StachelSession.clear();
      tester.view.physicalSize = const Size(390, 1600);
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
    }

    testWidgets('„Mit mir geteilt“ zeigt nur fremde Boards und bleibt gemerkt', (tester) async {
      final server = FakeStachelServer();
      await home(tester, TestStachelClient(server.client));
      expect(find.byKey(const Key('stachelOwnerFilter')), findsOneWidget);
      expect(find.text('Festival'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('stachelFilter-shared')));
      await tester.tap(find.byKey(const Key('stachelFilter-shared')));
      await tester.pumpAndSettle();
      expect(find.text('Festival'), findsNothing, reason: 'eigenes Board');
      // titles with a role tag are rich text (title + tag)
      for (final t in ['Bühne', 'Deko', 'Kasse']) {
        expect(find.textContaining(t, findRichText: true), findsOneWidget, reason: t);
      }
      final p = await SharedPreferences.getInstance();
      expect(p.getString(stachelFilterKey), 'shared');
      await tester.ensureVisible(find.byKey(const Key('stachelFilter-mine')));
      await tester.tap(find.byKey(const Key('stachelFilter-mine')));
      await tester.pumpAndSettle();
      expect(find.text('Festival'), findsOneWidget);
      expect(find.textContaining('Bühne', findRichText: true), findsNothing);
    });

    testWidgets('ohne Konten (Modus org): kein Filter, alle Boards; gemerkter Filter wirkt nicht', (tester) async {
      final server = FakeStachelServer();
      await home(tester, TestStachelClient(server.client, showsRoles: false), prefs: {stachelFilterKey: 'shared'});
      expect(find.byKey(const Key('stachelOwnerFilter')), findsNothing);
      expect(find.text('Festival'), findsOneWidget);
    });

    testWidgets('„Blockierte Personen“ in der Leiste nur, wenn die Konto-Seite sie nicht führt', (tester) async {
      final server = FakeStachelServer();
      await home(tester, TestStachelClient(server.client));
      expect(find.byKey(const Key('stachelBlockedPeople')), findsOneWidget);
      await home(tester, _AccountClient(FakeStachelServer().client));
      expect(find.byKey(const Key('stachelBlockedPeople')), findsNothing);
    });
  });

  group('Schreibleiste (P11)', () {
    Future<BoardEditor> bar(WidgetTester tester, {String writer = ''}) async {
      final controller = BoardController(
        FixtureBoardSource(
          BoardSnapshot(
            objects: [
              BoardObject(const {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Hallo'}),
            ],
          ),
          rev: 1,
        ),
      );
      final editor = BoardEditor(
        controller: controller,
        scene: BoardScene(controller.state),
        camera: CameraController(),
      );
      addTearDown(() {
        editor.dispose();
        controller.dispose();
      });
      await controller.start();
      editor.startEditing('a');
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            bottomNavigationBar: StachelEditBar(writer: writer, onDone: () {}, editor: editor),
          ),
        ),
      );
      await tester.pump();
      return editor;
    }

    testWidgets('eine Zeile: Formate und FERTIG nebeneinander, kein „Text bearbeiten“', (tester) async {
      await bar(tester);
      expect(find.text('Text bearbeiten'), findsNothing);
      expect(find.byKey(const Key('stachelEditHint')), findsNothing);
      final fmt = tester.getCenter(find.byKey(const Key('stachelFormatBar')));
      final done = tester.getCenter(find.byKey(const Key('stachelEditDone')));
      expect((fmt.dy - done.dy).abs(), lessThan(4), reason: 'gleiche Zeile');
      expect(tester.getSize(find.byType(StachelEditBar)).height, lessThan(60));
      // text color: the letter in the bar's ink (readable in the dark look), the chosen color only as the bar
      final icon = tester.widget<Icon>(
        find.descendant(of: find.byKey(const Key('stachelFmt-color')), matching: find.byType(Icon)),
      );
      expect(icon.color, const BoardUiTheme().ink);
      final colorBar = tester.widget<DecoratedBox>(find.byKey(const Key('stachelFmtColorBar')));
      expect((colorBar.decoration as BoxDecoration).color, const Color(0xFF0A0A0A));
    });

    testWidgets('schreibt jemand mit: Hinweis darüber', (tester) async {
      await bar(tester, writer: 'Mara Muster');
      expect(find.text('Wird gerade auch von Mara Muster bearbeitet'), findsOneWidget);
    });
  });

  group('Board-Menü (P7)', () {
    test('Kommentare, Teilen, Rahmen und Suchen stehen in der Schnellzeile', () {
      final ids = {
        for (final m in stachelBoardRegistry.menuItems.list())
          if (m.on == MenuTarget.board && m.section == MenuSection.quick) m.id,
      };
      expect(ids, containsAll(['collab.comments', 'sharing.share', 'app.frames', 'tools.boardSearch']));
      expect(
        [
          for (final m in stachelBoardRegistry.menuItems.list())
            if (m.on == MenuTarget.board && m.section == null) m.id,
        ],
        isEmpty,
        reason: 'jeder Eintrag des Board-Menüs hat eine Gruppe',
      );
    });
  });
}
