// P6 Versionsverlauf (parity audit N01–N06): texts like the web's `features/versions/format.ts` (cases mirror the web's
// versions.test.ts), the list sheet (save, current state, days, empty/error, rename), the read-only preview from the
// snapshot of contract §8.14 (own board, live board untouched), restore with confirmation and the web's toasts, copy,
// and the board menu entry only with an admin host.

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/versions/format.dart';
import 'package:stachel_board/src/features/versions/version_preview.dart';
import 'package:stachel_board/src/features/versions/versions_session.dart';
import 'package:stachel_board/src/features/versions/versions_sheet.dart';
import 'package:stachel_board/stachel_board.dart';

final _now = DateTime(2026, 10, 30, 15); // Freitag, 30. Oktober 2026, Ortszeit

BoardVersion _v(
  DateTime at, {
  String? id,
  String kind = 'auto',
  String? name,
  List<VersionPerson> people = const [],
  VersionPerson? by,
  DateTime? restoredFrom,
  int objects = 3,
}) => BoardVersion(
  id: id ?? 'v${at.millisecondsSinceEpoch}',
  createdAt: at,
  kind: kind,
  name: name,
  people: people,
  by: by,
  restoredFrom: restoredFrom,
  objects: objects,
);

class _Host extends BoardHost implements BoardAdminHost {
  _Host(this.versions);
  List<BoardVersion> versions;
  final calls = <String>[];
  Object? fail;
  bool restoreChanged = true;
  Completer<void>? snapshotGate;

  void _check() {
    final f = fail;
    if (f != null) throw f;
  }

  @override
  String errorText(Object error) => 'Fehler: $error';
  @override
  bool get isTemplate => false;
  @override
  String get boardTitle => 'Sommerfest 2027';
  @override
  Future<void> duplicateBoard() async {}
  @override
  Future<void> saveAsTemplate() async {}

  @override
  Future<List<BoardVersion>> listVersions() async {
    calls.add('list');
    _check();
    return versions;
  }

  @override
  Future<BoardVersion> saveVersion(String name) async {
    calls.add('save:$name');
    _check();
    final v = _v(
      DateTime(2026, 10, 30, 14, 50),
      id: 'new',
      kind: 'manual',
      name: name,
      by: const VersionPerson('m:1', 'Mara'),
    );
    versions = [v, ...versions];
    return v;
  }

  @override
  Future<BoardVersion> renameVersion(String id, String name) async {
    calls.add('rename:$id:$name');
    _check();
    final old = versions.firstWhere((v) => v.id == id);
    final next = BoardVersion(
      id: id,
      createdAt: old.createdAt,
      kind: old.kind,
      name: name.isEmpty ? null : name,
      objects: old.objects,
    );
    versions = [for (final v in versions) v.id == id ? next : v];
    return next;
  }

  @override
  Future<bool> restoreVersion(String id) async {
    calls.add('restore:$id');
    _check();
    return restoreChanged;
  }

  @override
  Future<void> openVersionCopy(String id, String title) async => calls.add('copy:$id:$title');

  @override
  Future<Map<String, Object?>> versionSnapshot(String id) async {
    calls.add('snapshot:$id');
    await snapshotGate?.future;
    _check();
    return {
      'ok': true,
      'board': {'id': 'b1', 'title': 'Sommerfest 2027'},
      'version': {'id': id},
      'below': ['frame'],
      'snapshot': {
        'objects': [
          {'id': 'old', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a0', 'text': 'Alte Notiz'},
        ],
        'ext': <String, Object?>{},
      },
    };
  }

  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async {}
  @override
  Future<String?> uploadThumbnail(Uint8List bytes, String mimeType) async => null;
  @override
  Future<McpTokens> listTokens() async => const McpTokens([], '');
  @override
  Future<McpNewToken> createToken(String label) => throw UnimplementedError();
  @override
  Future<void> revokeToken(String id) async {}
  @override
  Future<void> shareText(String text, {String? subject}) async {}
  @override
  Future<void> copyText(String text) async {}
}

class _Board {
  _Board(this.controller, this.ui, this.toasts, this.context);
  final BoardController controller;
  final BoardUi ui;
  final List<String> toasts;
  final BuildContext Function() context;
}

Future<_Board> _pump(WidgetTester tester, {BoardHost host = const BoardHost()}) async {
  tester.view.physicalSize = const Size(400, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({
      'objects': [
        {'id': 'live', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a0', 'text': 'Live-Notiz'},
      ],
    }),
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
  final toasts = <String>[];
  final sub = ui.hints.messages.listen(toasts.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  late BuildContext ctx;
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Builder(
            builder: (context) {
              ctx = context;
              return BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false);
            },
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  return _Board(controller, ui, toasts, () => ctx);
}

Future<void> _openList(WidgetTester tester, _Board b) async {
  unawaited(showBoardMenu(b.context(), b.ui, MenuTarget.board, const MenuAt(Offset.zero)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('stachelBoardVersions')));
  await tester.pumpAndSettle();
}

void main() {
  group('Texte wie im Web (format.ts)', () {
    test('Tage: Heute, Gestern, Wochentag mit Datum, fremdes Jahr mit Jahreszahl', () {
      expect(dayLabel(DateTime(2026, 10, 30, 0, 5), now: _now), 'Heute');
      expect(dayLabel(DateTime(2026, 10, 29, 23, 59), now: _now), 'Gestern');
      expect(dayLabel(DateTime(2026, 10, 28, 9), now: _now), 'Mittwoch, 28. Oktober');
      expect(dayLabel(DateTime(2025, 12, 31, 9), now: _now), 'Mittwoch, 31. Dezember 2025');
      // Monatswechsel: 1. November → 31. Oktober ist „Gestern“
      expect(dayLabel(DateTime(2026, 10, 31, 12), now: DateTime(2026, 11, 1, 8)), 'Gestern');
      // UTC-Zeit vom Server wird in Ortszeit gezeigt
      expect(dayLabel(DateTime(2026, 10, 30, 12).toUtc(), now: _now), 'Heute');
    });

    test('Uhrzeit und Stempel', () {
      expect(timeLabel(DateTime(2026, 10, 30, 9, 5)), '09:05');
      expect(stamp(DateTime(2026, 10, 28, 14, 20), now: _now), '28.10., 14:20');
      expect(stamp(DateTime(2025, 3, 3, 8, 0), now: _now), '3.3.2025, 08:00');
      expect(whenLabel(DateTime(2026, 10, 30, 14, 20), now: _now), 'heute, 14:20');
      expect(whenLabel(DateTime(2026, 10, 29, 14, 20), now: _now), 'gestern, 14:20');
      expect(whenLabel(DateTime(2026, 10, 20, 14, 20), now: _now), '20.10., 14:20');
    });

    test('gruppiert nach Kalendertagen in der Reihenfolge der Liste (neueste zuerst)', () {
      final list = [
        _v(DateTime(2026, 10, 30, 14)),
        _v(DateTime(2026, 10, 30, 9)),
        _v(DateTime(2026, 10, 29, 22)),
        _v(DateTime(2026, 10, 27, 8)),
      ];
      final g = groupByDay(list, now: _now);
      expect(
        [for (final x in g) (x.label, x.items.length)],
        [('Heute', 2), ('Gestern', 1), ('Dienstag, 27. Oktober', 1)],
      );
      expect(groupByDay(const [], now: _now), isEmpty);
    });

    test('beschreibt die Art der Version', () {
      final at = DateTime(2026, 10, 30, 14);
      expect(describeVersion(_v(at), now: _now), 'Automatisch gesichert');
      expect(
        describeVersion(_v(at, people: const [VersionPerson('m:1', 'Mara Lindner')]), now: _now),
        'Bearbeitet von Mara',
      );
      expect(
        describeVersion(_v(at, people: const [VersionPerson('m:1', 'Mara'), VersionPerson('m:2', 'Jonas')]), now: _now),
        'Bearbeitet von Mara und Jonas',
      );
      expect(
        describeVersion(
          _v(
            at,
            people: [
              for (final (i, n) in ['Mara', 'Jonas', 'Lena', 'Ida'].indexed) VersionPerson('m:$i', n),
            ],
          ),
          now: _now,
        ),
        'Bearbeitet von Mara, Jonas und 2 weitere',
      );
      expect(
        describeVersion(
          _v(at, kind: 'manual', by: const VersionPerson('m:1', 'Mara')),
          now: _now,
        ),
        'Gespeichert von Mara',
      );
      expect(describeVersion(_v(at, kind: 'manual'), now: _now), 'Gespeichert');
      expect(describeVersion(_v(at, kind: 'backup'), now: _now), 'Sicherung vor dem Wiederherstellen');
      expect(
        describeVersion(
          _v(
            at,
            kind: 'restored',
            by: const VersionPerson('a:jonas', 'Jonas'),
            restoredFrom: DateTime(2026, 10, 29, 10),
          ),
          now: _now,
        ),
        'Jonas hat den Stand von gestern, 10:00 wiederhergestellt',
      );
      expect(describeVersion(_v(at, kind: 'restored'), now: _now), 'Jemand hat eine Version wiederhergestellt');
    });

    test('Avatare: Bearbeitende plus wer gespeichert hat, ohne Doppelte; Farben und Initialen wie im Web', () {
      final at = DateTime(2026, 10, 30, 14);
      const mara = VersionPerson('m:1', 'Mara');
      const jonas = VersionPerson('m:2', 'Jonas');
      expect(
        [
          for (final p in peopleOf(_v(at, people: [mara], by: jonas))) p.key,
        ],
        ['m:1', 'm:2'],
      );
      expect(
        [
          for (final p in peopleOf(_v(at, people: [mara], by: mara))) p.key,
        ],
        ['m:1'],
      );
      expect(objectsLabel(1), '1 Objekt');
      expect(objectsLabel(0), '0 Objekte');
      expect(initials('Mara Lindner'), 'ML');
      expect(initials('Mara'), 'MA');
      expect(initials('Anna-Lena Schmidt'), 'AS');
      expect(initials('🙂'), '?');
      // FNV-1a wie board/colors.ts: fester Wert je Schlüssel, aus USER_COLORS
      expect(userColors, contains(userColor('m:1')));
      expect(userColor('m:1'), userColor('m:1'));
    });

    test('BoardVersion aus dem Server-JSON', () {
      final v = BoardVersion.fromJson({
        'id': 'v1',
        'createdAt': '2026-10-30T13:20:00.000Z',
        'kind': 'restored',
        'name': '',
        'people': [
          {'key': 'm:1', 'name': 'Mara'},
          {'bad': 1},
        ],
        'by': {'key': 'm:2', 'name': 'Jonas'},
        'restoredFrom': '2026-10-29T09:00:00.000Z',
        'objects': 12,
        'bytes': 300,
      })!;
      expect(v.name, isNull);
      expect(v.people.single.name, 'Mara');
      expect(v.by!.name, 'Jonas');
      expect(v.restoredFrom, isNotNull);
      expect(v.objects, 12);
      expect(BoardVersion.fromJson({'id': 'x'}), isNull);
    });
  });

  group('Board-Menü und Liste', () {
    testWidgets('„Versionsverlauf“ nur mit Verwaltungs-Dienst der App; Reihenfolge 36 im Board-Menü', (tester) async {
      final r = standardBoardRegistry();
      expect(r.menuItems['versions.history']!.order, 36);
      expect(r.sheets['versions.list'], isNotNull);
      final plain = await _pump(tester);
      expect(r.menuItems['versions.history']!.entry(plain.ui, const MenuAt(Offset.zero)), isNull);
    });

    testWidgets('Liste nach Tagen, „Aktueller Stand“, Beschreibung, Objekte, Avatare, Hinweis zum Ausdünnen', (
      tester,
    ) async {
      final now = DateTime.now();
      final host = _Host([
        _v(now, id: 'a', name: 'Vor dem Treffen', kind: 'manual', by: const VersionPerson('m:1', 'Mara')),
        _v(
          now.subtract(const Duration(days: 3)),
          id: 'b',
          people: [
            for (final (i, n) in ['Mara', 'Jonas', 'Lena', 'Ida'].indexed) VersionPerson('m:$i', n),
          ],
          objects: 1,
        ),
      ]);
      final b = await _pump(tester, host: host);
      await _openList(tester, b);
      expect(find.text('Aktueller Stand'), findsOneWidget);
      expect(find.text('Live – so sehen alle das Board gerade'), findsOneWidget);
      expect(find.text('HEUTE'), findsOneWidget);
      expect(find.text('Vor dem Treffen'), findsOneWidget);
      expect(find.text('Gespeichert von Mara · 3 Objekte'), findsOneWidget);
      expect(find.text('Bearbeitet von Mara, Jonas und 2 weitere · 1 Objekt'), findsOneWidget);
      expect(find.text('+1'), findsOneWidget); // 4 Personen: 3 + „+1“
      expect(find.textContaining('Ältere Versionen werden ausgedünnt'), findsOneWidget);
      // nichts gewählt: keine Aktionen
      expect(find.byKey(const Key('stachelVersionRestore')), findsNothing);
    });

    testWidgets('leer und Fehler mit den Web-Texten; neu laden alle 30 s', (tester) async {
      final host = _Host([]);
      final b = await _pump(tester, host: host);
      await _openList(tester, b);
      expect(find.byKey(const Key('stachelVersionsEmpty')), findsOneWidget);
      expect(find.textContaining('Noch keine Versionen. Stachel sichert automatisch'), findsOneWidget);
      host.fail = 'kaputt';
      await tester.pump(versionsRefresh);
      await tester.pump();
      expect(find.text('Fehler: kaputt'), findsOneWidget);
      expect(host.calls.where((c) => c == 'list').length, 2);
    });

    testWidgets('„Version speichern“: Name nötig, Hinweis „Version „X“ gespeichert.“, Liste neu', (tester) async {
      final host = _Host([]);
      final b = await _pump(tester, host: host);
      await _openList(tester, b);
      await tester.tap(find.byKey(const Key('stachelVersionSave')));
      await tester.pumpAndSettle();
      expect(find.text('Name, z. B. Stand vor dem Orga-Treffen'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('stachelVersionSaveSubmit'))).onPressed, isNull);
      await tester.enterText(find.byKey(const Key('stachelVersionName')), '  Stand vor dem Treffen ');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelVersionSaveSubmit')));
      await tester.pumpAndSettle();
      expect(host.calls, contains('save:Stand vor dem Treffen'));
      expect(b.toasts, ['Version „Stand vor dem Treffen“ gespeichert.']);
      expect(find.byKey(const Key('stachelVersion-new')), findsOneWidget);
      expect(find.byKey(const Key('stachelVersionSave')), findsOneWidget, reason: 'Formular wieder zu');
    });
  });

  group('Vorschau, Wiederherstellen, Kopie, Benennen', () {
    Future<(_Board, _Host)> preview(WidgetTester tester, {String? name}) async {
      final at = DateTime.now().subtract(const Duration(minutes: 5));
      final host = _Host([
        _v(at, id: 'v1', name: name, people: const [VersionPerson('m:1', 'Mara')]),
      ]);
      final b = await _pump(tester, host: host);
      await _openList(tester, b);
      host.snapshotGate = Completer<void>();
      await tester.tap(find.byKey(const Key('stachelVersion-v1')));
      await tester.pump();
      expect(find.text('Bearbeitet von Mara · 3 Objekte · lädt …'), findsOneWidget);
      host.snapshotGate!.complete();
      await tester.pumpAndSettle();
      return (b, host);
    }

    testWidgets('Antippen zeigt die Version schreibgeschützt; das Live-Board bleibt; ✕ zurück zum aktuellen Stand', (
      tester,
    ) async {
      final (b, host) = await preview(tester);
      expect(host.calls, contains('snapshot:v1'));
      expect(find.byType(VersionPreviewScreen), findsOneWidget);
      expect(find.byKey(const Key('stachelVersionsSheet')), findsNothing, reason: 'Liste zu wie am Handy im Web');
      expect(find.textContaining('Vorschau: Stand von heute, '), findsOneWidget);
      expect(find.text('Bearbeitet von Mara · nur ansehen'), findsOneWidget);
      // zweite Quelle: die Vorschau hat den alten Stand, nur lesen
      final views = tester.widgetList<BoardView>(find.byType(BoardView, skipOffstage: false)).toList();
      final previewView = views.firstWhere((v) => !identical(v.controller, b.controller));
      expect(previewView.controller.state['old']?.text, 'Alte Notiz');
      expect(previewView.controller.state['live'], isNull);
      expect(previewView.controller.mayEdit, isFalse);
      expect(b.controller.state['live'], isNotNull);
      expect(b.controller.state['old'], isNull);
      await tester.tap(find.byKey(const Key('stachelVersionClose')));
      await tester.pumpAndSettle();
      expect(find.byType(VersionPreviewScreen), findsNothing);
      expect(VersionsSession.of(b.ui).preview.value, isNull);
    });

    testWidgets('Wiederherstellen: Rückfrage mit Web-Text (mit Name), Hinweis, Vorschau zu', (tester) async {
      final (b, host) = await preview(tester, name: 'Vor dem Treffen');
      await tester.tap(find.byKey(const Key('stachelVersionBarRestore')));
      await tester.pumpAndSettle();
      expect(find.textContaining('wiederherstellen?'), findsOneWidget);
      expect(
        find.textContaining(
          'Das Board springt für alle sofort auf diesen Stand („Vor dem Treffen“). Der aktuelle Stand wird vorher',
        ),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('stachelVersionRestoreConfirm')));
      await tester.pumpAndSettle();
      expect(host.calls, contains('restore:v1'));
      expect(
        b.toasts.single,
        matches(
          RegExp(
            r'^Stand von heute, \d\d:\d\d wiederhergestellt – alle sehen ihn jetzt\. Der vorige Stand ist als Version gesichert\.$',
          ),
        ),
      );
      expect(find.byType(VersionPreviewScreen), findsNothing);
    });

    testWidgets('Wiederherstellen ohne Änderung: „Das Board hat schon den Stand von …“; Abbrechen tut nichts', (
      tester,
    ) async {
      final (b, host) = await preview(tester);
      host.restoreChanged = false;
      await tester.tap(find.byKey(const Key('stachelVersionBarRestore')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Abbrechen'));
      await tester.pumpAndSettle();
      expect(host.calls.where((c) => c.startsWith('restore')), isEmpty);
      await tester.tap(find.byKey(const Key('stachelVersionBarRestore')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelVersionRestoreConfirm')));
      await tester.pumpAndSettle();
      expect(b.toasts.single, startsWith('Das Board hat schon den Stand von heute, '));
    });

    testWidgets(
      '„Versionen“ aus der Vorschau: gewählte Version mit Aktionen; Benennen/Name entfernen; Als Kopie öffnen',
      (tester) async {
        final (b, host) = await preview(tester);
        await tester.tap(find.byKey(const Key('stachelVersionList')));
        await tester.pumpAndSettle();
        expect(find.text('Diese Version wiederherstellen'), findsOneWidget);
        expect(find.text('Version benennen'), findsOneWidget);
        await tester.tap(find.byKey(const Key('stachelVersionRename')));
        await tester.pumpAndSettle();
        expect(find.text('Name entfernen'), findsOneWidget);
        await tester.enterText(find.byKey(const Key('stachelVersionName')), 'Orga');
        await tester.pump();
        expect(find.text('Benennen'), findsOneWidget);
        await tester.tap(find.byKey(const Key('stachelVersionRenameSubmit')));
        await tester.pumpAndSettle();
        expect(host.calls, contains('rename:v1:Orga'));
        expect(find.text('Umbenennen'), findsOneWidget);
        // Vorschau-Balken folgt dem Namen
        expect(VersionsSession.of(b.ui).preview.value!.version.name, 'Orga');
        await tester.tap(find.byKey(const Key('stachelVersionCopy')));
        await tester.pumpAndSettle();
        final copy = host.calls.lastWhere((c) => c.startsWith('copy:'));
        expect(copy, matches(RegExp(r'^copy:v1:Sommerfest 2027 \(Stand \d+\.\d+\., \d\d:\d\d\)$')));
        expect(find.byType(VersionPreviewScreen), findsNothing);
        expect(find.byKey(const Key('stachelVersionsSheet')), findsNothing);
      },
    );

    testWidgets('Fehler beim Laden der Version: Hinweis, keine Vorschau', (tester) async {
      final host = _Host([_v(DateTime.now(), id: 'v1')]);
      final b = await _pump(tester, host: host);
      await _openList(tester, b);
      host.fail = 'weg';
      await tester.tap(find.byKey(const Key('stachelVersion-v1')));
      await tester.pumpAndSettle();
      expect(b.toasts, ['Fehler: weg']);
      expect(find.byType(VersionPreviewScreen), findsNothing);
    });
  });
}
