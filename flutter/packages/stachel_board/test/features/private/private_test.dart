// Private mode (docs/features/private.md §1, §5): the native message `private` (own objects, board wins on the same
// id, ack after it), placeholders of the others' hidden objects (lock, name, not hittable), the lock chip at own
// objects, the hint band with „Aufdecken“ / „Meine aufdecken“, the countdown for everybody and the board menu with the
// sheet „Privater Modus“ – steering through the host (REST in the app).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

class _Host extends BoardHost implements BoardPrivateHost {
  final calls = <Map<String, Object?>>[];
  Object? fail;
  List<Person> known = const [];

  @override
  Future<Map<String, Object?>> privateMode(Map<String, Object?> body) async {
    calls.add(body);
    final f = fail;
    if (f != null) throw f;
    return const {'on': true};
  }

  @override
  String privateErrorText(Object error) => 'Fehler: $error';

  @override
  Future<List<Person>> people() async => known;
}

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui, this.host);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final _Host host;
  final hints = <String>[];
  BoardViewState get view => ui.view!;
  Camera get cam => view.camera.value;
  int _rev = 40;

  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
  ];

  int get lastReq => source.sent.lastWhere((m) => m['t'] == 'ops')['req']! as int;

  void ext(Map<String, Object?> ext) =>
      source.push(PatchMessage.fromJson({'t': 'patch', 'rev': ++_rev, 'changes': const [], 'ext': ext}));

  void private(List<Map<String, Object?>> objects) =>
      source.push(ServerMessage.parse({'t': 'private', 'objects': objects}));

  void peers(List<Peer> peers) => source.push(PresenceMessage(peers));

  /// Screen point of the world point [w].
  Offset screen(WidgetTester tester, Offset w) => cam.toScreen(w) + tester.getTopLeft(find.byType(BoardView));
}

const _me = 'a:mara';

Future<_Board> _pump(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = const [],
  Map<String, Object?> ext = const {},
  String role = 'edit',
  List<String> features = const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra', 'private'],
  bool host = true,
  List<Person> people = const [],
}) async {
  tester.view.physicalSize = const Size(390, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  BoardPrefs.load(const {});
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects, 'ext': ext}),
    rev: 20,
    role: role,
    features: features,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final h = _Host()..known = people;
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host ? h : const BoardHost());
  final board = _Board(controller, source, editor, ui, h);
  final sub = ui.hints.messages.listen(board.hints.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      home: BoardUiScope(
        ui: ui,
        child: Scaffold(
          appBar: AppBar(
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
  controller.user = const NativeUser(key: _me, name: 'Mara Kern');
  await tester.pump();
  await tester.pump();
  return board;
}

Map<String, Object?> _sticky(String id, double x, double y, {String text = '', String z = 'a0'}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 200,
  'h': 200,
  'color': '#fff27a',
  'text': text,
  'z': z,
};

Map<String, Object?> _mode({
  String by = _me,
  String byName = 'Mara Kern',
  bool anonymous = false,
  bool ownReveal = false,
  int? revealAt,
}) => {
  'on': true,
  'by': by,
  'byName': byName,
  'since': '2026-11-04T10:00:00.000Z',
  'anonymous': anonymous,
  'ownReveal': ownReveal,
  'revealAt': ?revealAt,
};

Peer _peer(String key, String name, {int id = 7, Map<String, Object?> extra = const {}}) =>
    Peer(id: id, key: key, name: name, color: '#ec4e92', extra: extra, client: 'web');

Future<void> _menu(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(const Key('stachelBoardMenu')));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  var now = 1762250000000;
  setUp(() {
    now = 1762250000000;
    collabDeviceNow = () => now;
  });
  tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

  group('Nachricht `private` (§5)', () {
    test('wird geparst: ganze Ablage, Objekte ohne id/type fallen weg', () {
      final m = ServerMessage.parse({
        't': 'private',
        'objects': [
          {'id': 'p1', 'type': 'sticky', 'x': 1, 'y': 2, 'text': 'Geheim'},
          {'type': 'sticky'},
          'kaputt',
        ],
      });
      expect(m, isA<PrivateMessage>());
      final objs = (m as PrivateMessage).objects;
      expect(objs.map((o) => (o.id, o.text)), [('p1', 'Geheim')]);
      expect((ServerMessage.parse({'t': 'private'}) as PrivateMessage).objects, isEmpty);
    });

    testWidgets('eigene private Objekte werden gezeigt und ersetzt; gleiche ID: das Board gewinnt', (tester) async {
      final b = await _pump(tester, objects: [_sticky('n1', 0, 0, text: 'Öffentlich')]);
      b.private([_sticky('p1', 300, 0, text: 'Geheim', z: 'b0'), _sticky('n1', 0, 0, text: 'Alt', z: 'b1')]);
      await tester.pump();
      expect(b.controller.state['p1']?.text, 'Geheim');
      expect(b.controller.state['n1']?.text, 'Öffentlich', reason: 'Board-Objekt gewinnt');
      expect(b.controller.isPrivate('p1'), isTrue);
      expect(b.controller.isPrivate('n1'), isFalse);
      b.private([_sticky('p2', 600, 0, text: 'Neu')]);
      await tester.pump();
      expect(b.controller.state['p1'], isNull, reason: 'ganze Liste ersetzt den Stand');
      expect(b.controller.state['p2']?.text, 'Neu');
      expect(b.controller.state['n1']?.text, 'Öffentlich');
    });

    testWidgets('ohne Feature `private` ignoriert', (tester) async {
      final b = await _pump(tester, features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text']);
      b.private([_sticky('p1', 0, 0, text: 'Geheim')]);
      await tester.pump();
      expect(b.controller.state['p1'], isNull);
    });

    testWidgets('eigene Op: optimistisch, `private` vor dem ack, danach aus der privaten Liste', (tester) async {
      final b = await _pump(tester, ext: {'private.mode': _mode()});
      b.controller.apply([
        CreateOp([_sticky('p1', 0, 0, text: 'Idee')]),
      ]);
      await tester.pump();
      expect(b.controller.state['p1']?.text, 'Idee');
      final req = b.lastReq;
      // the server: no patch, the store instead, then the ack
      b.private([_sticky('p1', 0, 0, text: 'Idee', z: 'a5')]);
      b.source.push(AckMessage(req, 41));
      await tester.pump();
      expect(b.controller.pendingCount, 0);
      expect(b.controller.state['p1']?.text, 'Idee', reason: 'bleibt nach dem ack sichtbar');
      expect(b.controller.state['p1']?.z, 'a5');
      // edit it: update goes out as always, the store comes back changed
      b.controller.apply([
        const UpdateOp({
          'p1': {'color': '#ff0000'},
        }),
      ]);
      await tester.pump();
      expect(b.controller.state['p1']?.raw['color'], '#ff0000');
      expect(b.ops.last, {
        'op': 'update',
        'patches': {
          'p1': {'color': '#ff0000'},
        },
      });
      b.private([
        {..._sticky('p1', 0, 0, text: 'Idee', z: 'a5'), 'color': '#ff0000'},
      ]);
      b.source.push(AckMessage(b.lastReq, 41));
      await tester.pump();
      expect(b.controller.state['p1']?.raw['color'], '#ff0000');
      // revealed: the board gets it, the store forgets it – no flicker
      b.source.push(
        PatchMessage.fromJson({
          't': 'patch',
          'rev': 42,
          'changes': [
            {
              'id': 'p1',
              'created': {..._sticky('p1', 0, 0, text: 'Idee', z: 'c0'), 'color': '#ff0000'},
            },
          ],
        }),
      );
      await tester.pump();
      expect(b.controller.isPrivate('p1'), isFalse);
      b.private(const []);
      await tester.pump();
      expect(b.controller.state['p1']?.z, 'c0');
    });
  });

  group('Platzhalter und Schloss (§1)', () {
    testWidgets('graue Platzhalter mit Schloss und Namen, nicht für eigene; nicht antippbar', (tester) async {
      final b = await _pump(
        tester,
        people: const [Person('k:lea', 'Lea')],
        objects: [_sticky('n1', 1000, 1000)],
        ext: {
          'private.mode': _mode(by: 'k:jonas', byName: 'Jonas'),
          'private.hidden': {
            'h1': {'x': 40, 'y': 40, 'w': 200, 'h': 200, 'type': 'sticky', 'by': 'k:jonas', 'o': 'x1'},
            'h2': {'x': 260, 'y': 40, 'w': 100, 'h': 100, 'type': 'shape', 'rotation': 15, 'by': 'k:lea', 'o': 'x2'},
            'p1': {'x': 40, 'y': 300, 'w': 200, 'h': 200, 'type': 'sticky', 'by': _me, 'o': 'x3'},
          },
        },
      );
      b.private([_sticky('p1', 40, 300, text: 'Meins')]);
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('privatePlaceholder-h1')), findsOneWidget);
      expect(find.byKey(const Key('privatePlaceholder-h2')), findsOneWidget);
      expect(find.byKey(const Key('privatePlaceholder-p1')), findsNothing, reason: 'eigenes Objekt');
      expect(find.text('Jonas'), findsOneWidget);
      expect(find.text('Lea'), findsOneWidget, reason: 'Name aus der Personenliste der App');
      expect(
        find.descendant(of: find.byKey(const Key('privatePlaceholder-h1')), matching: find.byIcon(Icons.lock_outline)),
        findsOneWidget,
      );
      // the placeholder covers the world rect
      final r = tester.getRect(find.byKey(const Key('privatePlaceholder-h1')));
      expect(r.topLeft, offsetMoreOrLessEquals(b.screen(tester, const Offset(40, 40)), epsilon: 0.5));
      // rotated like the object
      final rot = tester.widget<Transform>(
        find.ancestor(of: find.byKey(const Key('privatePlaceholder-h2')), matching: find.byType(Transform)).first,
      );
      expect(rot.transform.getRotation().entry(1, 0), closeTo(0.2588, 0.001));
      // a tap on it selects nothing (hit test ignores it)
      await tester.tapAt(b.screen(tester, const Offset(140, 140)));
      await tester.pump(const Duration(milliseconds: 400));
      expect(b.editor.selection.value, isEmpty);
      // own private object: lock chip „Nur für dich“
      expect(find.byKey(const Key('privateLock-p1')), findsOneWidget);
      expect(find.text('Nur für dich'), findsOneWidget);
      expect(find.byKey(const Key('privateLock-n1')), findsNothing);
      // and it can be selected like any object
      await tester.tapAt(b.screen(tester, const Offset(140, 400)));
      await tester.pump(const Duration(milliseconds: 400));
      expect(b.editor.selection.value, {'p1'});
    });

    testWidgets('anonym: Platzhalter ohne Namen', (tester) async {
      final b = await _pump(
        tester,
        ext: {
          'private.mode': _mode(anonymous: true),
          'private.hidden': {
            'h1': {'x': 40, 'y': 40, 'w': 200, 'h': 200, 'type': 'sticky', 'o': 'x1'},
          },
        },
      );
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      expect(find.byKey(const Key('privatePlaceholder-h1')), findsOneWidget);
      expect(find.byKey(const Key('privatePlaceholderName-h1')), findsNothing);
    });
  });

  group('Hinweisband (§1)', () {
    testWidgets('„N verdeckt“ ohne die eigenen; Aufdecken für die Moderation mit Countdown 3', (tester) async {
      final b = await _pump(
        tester,
        ext: {
          'private.mode': _mode(),
          'private.hidden': {
            'h1': {'x': 40, 'y': 40, 'w': 200, 'h': 200, 'type': 'sticky', 'o': 'x1'},
            'h2': {'x': 300, 'y': 40, 'w': 200, 'h': 200, 'type': 'text', 'o': 'x1'},
            'p1': {'x': 40, 'y': 300, 'w': 200, 'h': 200, 'type': 'sticky', 'o': 'x3'},
          },
        },
      );
      b.private([_sticky('p1', 40, 300, text: 'Meins')]);
      await tester.pump();
      expect(find.text('Privater Modus · Deine neuen Notizen sieht nur du · 2 verdeckt'), findsOneWidget);
      expect(find.byKey(const Key('privateRevealOwn')), findsNothing, reason: 'ohne ownReveal');
      await tester.tap(find.byKey(const Key('privateReveal')));
      await tester.pump();
      expect(b.host.calls, [
        {'action': 'reveal', 'countdown': 3},
      ]);
    });

    testWidgets('fremde Moderation anwesend: kein Aufdecken; weg: Aufdecken; Besitzer:in immer', (tester) async {
      final b = await _pump(
        tester,
        ext: {'private.mode': _mode(by: 'k:jonas', byName: 'Jonas', ownReveal: true)},
      );
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      expect(find.byKey(const Key('privateBanner')), findsOneWidget);
      expect(find.byKey(const Key('privateReveal')), findsNothing);
      expect(find.byKey(const Key('privateRevealOwn')), findsNothing, reason: 'nichts Eigenes');
      b.private([_sticky('p1', 40, 300, text: 'Meins')]);
      await tester.pump();
      await tester.tap(find.byKey(const Key('privateRevealOwn')));
      await tester.pump();
      expect(b.host.calls.last, {'action': 'revealOwn'});
      b.peers(const []);
      await tester.pump();
      expect(find.byKey(const Key('privateReveal')), findsOneWidget, reason: 'Moderation nicht mehr da');
      b.controller.role = 'owner';
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      expect(find.byKey(const Key('privateReveal')), findsOneWidget, reason: 'Besitzer:in');
      b.controller
        ..role = 'edit'
        ..user = const NativeUser(key: _me, name: 'Mara Kern', isOrga: true);
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      expect(find.byKey(const Key('privateReveal')), findsOneWidget, reason: 'Orga (Modus org)');
      b.controller.user = const NativeUser(key: _me, name: 'Mara Kern');
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      expect(find.byKey(const Key('privateReveal')), findsNothing);
    });

    testWidgets('Fehler vom Server als Hinweis', (tester) async {
      final b = await _pump(tester, ext: {'private.mode': _mode()});
      b.host.fail = 'not_running';
      await tester.tap(find.byKey(const Key('privateReveal')));
      await tester.pump();
      expect(b.hints, ['Fehler: not_running']);
    });

    testWidgets('Handy: Band in der Spalte oben, der Übersichtskarten-Knopf darunter statt darauf', (tester) async {
      final b = await _pump(tester, ext: {'private.mode': _mode()});
      await tester.pumpAndSettle();
      final band = tester.getRect(find.byKey(const Key('privateBanner')));
      final minimap = tester.getRect(find.byKey(const Key('stachelMinimapToggle')));
      expect(band.overlaps(minimap), isFalse, reason: 'Band $band, Knopf $minimap');
      expect(minimap.top, greaterThanOrEqualTo(band.bottom));
      expect(band.top - tester.getTopLeft(find.byType(BoardView)).dy, 8, reason: 'oben wie die anderen Leisten');
      // the search bar opens above it, the band moves down
      openSearch(b.ui);
      await tester.pumpAndSettle();
      final search = tester.getRect(find.byKey(const Key('stachelSearchField')));
      final band2 = tester.getRect(find.byKey(const Key('privateBanner')));
      expect(band2.top, greaterThan(search.bottom));
      expect(tester.getRect(find.byKey(const Key('stachelMinimapToggle'))).top, greaterThanOrEqualTo(band2.bottom));
    });

    testWidgets('aus: kein Band', (tester) async {
      await _pump(
        tester,
        ext: {
          'private.mode': {'on': false},
        },
      );
      expect(find.byKey(const Key('privateBanner')), findsNothing);
    });
  });

  group('Countdown (§1)', () {
    testWidgets('3 – 2 – 1 groß in der Mitte für alle, Abbrechen für die Moderation', (tester) async {
      final b = await _pump(
        tester,
        ext: {'private.mode': _mode(by: 'k:jonas', revealAt: now + 2500)},
      );
      await tester.pump();
      expect(find.byKey(const Key('privateCountdown')), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.byKey(const Key('privateCancel')), findsOneWidget, reason: 'Moderation nicht anwesend');
      now += 1000;
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('2'), findsOneWidget);
      now += 1000;
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('1'), findsOneWidget);
      await tester.tap(find.byKey(const Key('privateCancel')));
      await tester.pump();
      expect(b.host.calls.last, {'action': 'cancel'});
      now += 600;
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byKey(const Key('privateCountdown')), findsNothing);
      // the server ends the mode: the band goes too
      b.ext({
        'private.mode': {'on': false},
        'private.hidden': null,
      });
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byKey(const Key('privateBanner')), findsNothing);
    });
  });

  group('Board-Menü (§1)', () {
    testWidgets('„Privater Modus …“ → Blatt mit Schaltern → Starten', (tester) async {
      final b = await _pump(tester);
      await _menu(tester, 'privateMenuStart');
      expect(find.byKey(const Key('privateStartSheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('privateAnonymous')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('privateStart')));
      await tester.pumpAndSettle();
      expect(b.host.calls, [
        {'action': 'start', 'anonymous': true, 'ownReveal': false},
      ]);
      expect(find.byKey(const Key('privateStartSheet')), findsNothing, reason: 'schließt nach Erfolg');
    });

    testWidgets('an: „Privaten Modus aufdecken“ → Sofort; nicht Moderation: gesperrt', (tester) async {
      final b = await _pump(tester, ext: {'private.mode': _mode()});
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('privateMenuStart')), findsNothing);
      await tester.ensureVisible(find.byKey(const Key('privateMenuReveal')));
      await tester.tap(find.byKey(const Key('privateMenuReveal')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('privateMenuRevealNow')));
      await tester.pumpAndSettle();
      expect(b.host.calls, [
        {'action': 'reveal', 'countdown': 0},
      ]);
      b.ext({'private.mode': _mode(by: 'k:jonas', byName: 'Jonas')});
      b.peers([_peer('k:jonas', 'Jonas')]);
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      final tile = tester.widget<ListTile>(find.byKey(const Key('privateMenuReveal')));
      expect(tile.enabled, isFalse);
      expect(find.text('Aufdecken kann Jonas'), findsOneWidget);
    });

    testWidgets('ohne Rechte, ohne Host oder ohne Feature kein Eintrag', (tester) async {
      Future<void> none(_Board b) async {
        expect(
          menuEntries(b.ui, MenuTarget.board, const MenuAt(Offset.zero)).map((e) => e.key),
          isNot(contains('privateMenuStart')),
        );
      }

      await none(await _pump(tester, role: 'view'));
      await none(await _pump(tester, host: false));
      await none(await _pump(tester, features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act']));
      final b = await _pump(tester);
      final def = b.ui.registry.menuItems['private.mode']!;
      expect(def.section, MenuSection.collab);
    });
  });
}
