// Q2: templates in the app – the gallery's new templates and keyword search (web `matchesSearch`), own templates
// („Meine Vorlagen“ from the host's `/api/templates`, insert with `structure.insert`, delete) and the object menu
// „Auswahl als Vorlage speichern …“ (selection with frame contents and connectors in between, web `templateFromSelection`),
// templates of the instance (`/api/templates/instance`, category before „Meine Vorlagen“, web `packApi.ts`).

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/templates/own_templates.dart';
import 'package:stachel_board/src/features/templates/template_model.dart';

const _actions = {'structure.template': 1, 'structure.insert': 1, 'structure.paste': 1};

class _Host extends BoardHost implements OwnTemplatesHost {
  final saved = <(String, List<Map<String, Object?>>)>[];
  final deleted = <String>[];
  final messages = <String>[];
  List<Object?> list = [];

  @override
  void showMessage(String text) => messages.add(text);

  @override
  Future<List<Object?>> listOwnTemplates() async => list;

  @override
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects) async {
    saved.add((name, objects));
    return {'id': 'neu', 'name': name, 'createdAt': '2026-11-04T10:00:00Z', 'objects': objects};
  }

  @override
  Future<void> deleteOwnTemplate(String id) async => deleted.add(id);

  @override
  String errorText(Object error) => 'Fehler';
}

class _PackHost extends _Host implements InstanceTemplatesHost {
  Object? pack;

  @override
  Future<Object?> instanceTemplates() async => pack;
}

Map<String, Object?> _note(String id, double x, double y, {String text = ''}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 100,
  'h': 100,
  'z': 'a$id',
  'createdBy': 'm:1',
  'updatedAt': '',
  'color': '#fff27a',
  'text': text,
};

Future<(BoardUi, FixtureBoardSource)> _pump(
  WidgetTester tester,
  _Host? host, {
  List<Map<String, Object?>> objects = const [],
}) async {
  tester.view.physicalSize = const Size(900, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: _actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host ?? const BoardHost());
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Stack(
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
  await tester.pump();
  await tester.pump();
  return (ui, source);
}

List<Map<String, Object?>> _acts(FixtureBoardSource s, String name) => [
  for (final m in s.sent)
    if (m['t'] == 'ops')
      for (final o in (m['ops'] as List).cast<Map<String, Object?>>())
        if (o['op'] == 'act' && o['name'] == name) o,
];

Future<void> _openGallery(WidgetTester tester, BoardUi ui) async {
  showBoardMenu(tester.element(find.byType(BoardView)), ui, MenuTarget.board, const MenuAt(Offset.zero));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('stachelBoardTemplates')));
  await tester.pumpAndSettle();
}

/// The chip „Meine Vorlagen“ is the last one (like the web): scroll the row of categories there.
Future<void> _scrollToOwn(WidgetTester tester) async {
  final chip = find.byKey(const Key('stachelTemplateCat-Meine Vorlagen'));
  final row = find.byWidgetPredicate((w) => w is ListView && w.scrollDirection == Axis.horizontal).first;
  await tester.dragUntilVisible(chip, row, const Offset(-150, 0));
  await tester.pumpAndSettle();
}

Future<void> _ownCategory(WidgetTester tester) async {
  await _scrollToOwn(tester);
  await tester.tap(find.byKey(const Key('stachelTemplateCat-Meine Vorlagen')));
  await tester.pumpAndSettle();
}

void main() {
  test('neue Vorlagen und Suche mit Stichwörtern wie im Web (Konstanten)', () {
    final ids = boardTemplates.map((t) => t.id).toList();
    for (final id in ['dayplan', 'buildshifts', 'awareness', 'stageplot', 'briefing', 'festretro', 'budget']) {
      expect(boardTemplates.firstWhere((t) => t.id == id).category, 'Events');
    }
    for (final id in [
      'startstop',
      'cluster',
      'backlog',
      'eisenhower',
      'tows',
      'personas',
      'journey',
      'okr',
      'decision',
    ]) {
      expect(ids, contains(id));
    }
    expect(ids.length, 27);
    expect(filterTemplates(null, 'Stage Plot').map((t) => t.id), ['stageplot']);
    expect(filterTemplates(null, 'nutzwertanalyse').map((t) => t.id), ['decision']);
    expect(filterTemplates('Planung', 'retro'), isEmpty);
    for (final id in ids) {
      expect(templateObjects(id), isNotEmpty, reason: id);
    }
  });

  test('templateFromSelection: Rahmen-Inhalt und Verbinder zwischen Mitgenommenen, Zeichenreihenfolge', () {
    final state = BoardState()
      ..applySnapshot(
        BoardSnapshot.fromJson({
          'objects': [
            {'id': 'f', 'type': 'frame', 'x': 0, 'y': 0, 'w': 500, 'h': 400, 'z': 'a0', 'title': 'Retro'},
            _note('a', 20, 20, text: 'A'),
            _note('b', 900, 20, text: 'B'),
            _note('o', 2000, 20),
            {
              'id': 'c1',
              'type': 'connector',
              'x': 0,
              'y': 0,
              'w': 1,
              'h': 1,
              'z': 'b1',
              'from': {'objectId': 'a'},
              'to': {'objectId': 'b'},
            },
            {
              'id': 'c2',
              'type': 'connector',
              'x': 0,
              'y': 0,
              'w': 1,
              'h': 1,
              'z': 'b2',
              'from': {'objectId': 'a'},
              'to': {'objectId': 'o'},
            },
          ],
        }),
        rev: 1,
        epoch: 't',
      );
    final got = templateFromSelection(state, {'f', 'b'});
    expect(got.map((o) => o['id']).toSet(), {'f', 'a', 'b', 'c1'});
    expect(suggestTemplateName(got), 'Retro');
    expect(saveProblem(got), isNull);
    expect(saveProblem(const []), contains('Wähle'));
    expect(cleanTemplateName('  Meine   Retro '), 'Meine Retro');
    expect(cleanTemplateName(' '), isNull);
  });

  testWidgets('Meine Vorlagen: Liste vom Host, Vorschau, Einfügen mit structure.insert (JSON), Löschen', (
    tester,
  ) async {
    final host = _Host()
      ..list = [
        {
          'id': 't1',
          'name': 'Sommerfest Retro',
          'createdAt': '2026-11-01T10:00:00Z',
          'objects': [_note('x', 0, 0, text: 'Hallo'), _note('y', 200, 0)],
        },
      ];
    final (ui, source) = await _pump(tester, host);
    await _openGallery(tester, ui);
    await _ownCategory(tester);
    expect(find.byKey(const Key('stachelTemplate-kanban')), findsNothing);
    expect(find.byKey(const Key('stachelTemplate-own:t1')), findsOneWidget);
    expect(find.byKey(const Key('stachelTemplatePreview-own:t1')), findsOneWidget);
    expect(find.textContaining('Enthält 2 Haftnotizen'), findsOneWidget);
    // Suche findet eigene Vorlagen über den Namen
    await tester.enterText(find.byKey(const Key('stachelTemplateSearch')), 'sommer');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplate-own:t1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTemplateUse')));
    await tester.pumpAndSettle();
    final act = _acts(source, 'structure.insert').single['args']! as Map;
    expect(jsonDecode(act['json'] as String), host.list.first is Map ? (host.list.first as Map)['objects'] : null);
    expect(act.keys.toSet(), {'json', 'x', 'y'});

    // Löschen
    await _openGallery(tester, ui);
    await _ownCategory(tester);
    await tester.tap(find.byKey(const Key('stachelTemplateDelete')));
    await tester.pumpAndSettle();
    expect(host.deleted, ['t1']);
    expect(find.byKey(const Key('stachelTemplate-own:t1')), findsNothing);
    expect(find.byKey(const Key('stachelTemplatesNone')), findsOneWidget);
  });

  testWidgets('Vorlagen der Instanz: Kategorie vor „Meine Vorlagen“, Suche mit Stichwörtern, Einfügen wie eigene', (
    tester,
  ) async {
    final host = _PackHost()
      ..pack = {
        'ok': true,
        'category': 'Beispielverein',
        'templates': [
          {
            'id': 'plan.wochenplan',
            'name': 'Wochenplan',
            'desc': 'Montag bis Freitag',
            'keywords': ['woche', 'termine'],
            'objects': [_note('p1', 0, 0, text: 'Montag'), _note('p2', 120, 0)],
          },
          {'id': 'leer', 'name': 'Ohne Objekte', 'objects': []},
        ],
      };
    final (ui, source) = await _pump(tester, host);
    await _openGallery(tester, ui);
    await _scrollToOwn(tester);
    final pack = find.byKey(const Key('stachelTemplateCat-Beispielverein'));
    final own = find.byKey(const Key('stachelTemplateCat-Meine Vorlagen'));
    expect(tester.getCenter(pack).dx, lessThan(tester.getCenter(own).dx), reason: 'vor „Meine Vorlagen“');
    expect(
      tester.getCenter(find.byKey(const Key('stachelTemplateCat-Events'))).dx,
      lessThan(tester.getCenter(pack).dx),
    );
    await tester.tap(find.byKey(const Key('stachelTemplateCat-Beispielverein')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplate-kanban')), findsNothing);
    expect(find.byKey(const Key('stachelTemplate-pack:plan.wochenplan')), findsOneWidget);
    expect(find.byKey(const Key('stachelTemplate-pack:leer')), findsNothing, reason: 'ohne Objekte fällt sie weg');
    expect(find.byKey(const Key('stachelTemplatePreview-pack:plan.wochenplan')), findsOneWidget);
    expect(find.textContaining('Enthält 2 Haftnotizen'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTemplateSearch')), 'termine');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplate-pack:plan.wochenplan')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTemplateUse')));
    await tester.pumpAndSettle();
    final act = _acts(source, 'structure.insert').single['args']! as Map;
    expect((jsonDecode(act['json'] as String) as List).map((o) => (o as Map)['id']), ['p1', 'p2']);
  });

  test(
    'Vorlagen der Instanz aus der Server-Antwort: leer = keine Kategorie, ohne Namen der Kategorie „Weitere Vorlagen“',
    () {
      expect(InstanceTemplates.fromJson({'ok': true, 'category': 'X', 'templates': []}).category, isNull);
      expect(InstanceTemplates.fromJson(null).list, isEmpty);
      final p = InstanceTemplates.fromJson({
        'templates': [
          {
            'id': 'a',
            'name': 'A',
            'objects': [_note('n', 0, 0)],
          },
          {
            'name': 'ohne ID',
            'objects': [_note('m', 0, 0)],
          },
        ],
      });
      expect(p.category, 'Weitere Vorlagen');
      expect(p.list.map((t) => t.id), ['a']);
      expect(instanceTemplateMatches(p.list.single, 'Weitere Vorlagen', 'weitere'), isTrue);
      expect(instanceTemplateMatches(p.list.single, 'Weitere Vorlagen', 'nix'), isFalse);
    },
  );

  testWidgets('Vorlagen der Instanz: ohne Vorlagen keine Kategorie', (tester) async {
    final host = _PackHost()..pack = {'ok': true, 'category': 'Beispielverein', 'templates': []};
    final (ui, _) = await _pump(tester, host);
    await _openGallery(tester, ui);
    await _scrollToOwn(tester);
    expect(find.byKey(const Key('stachelTemplateCat-Meine Vorlagen')), findsOneWidget);
    expect(find.byKey(const Key('stachelTemplateCat-Beispielverein')), findsNothing);
  });

  testWidgets('ohne Host für eigene Vorlagen: keine Kategorie „Meine Vorlagen“, kein Menüeintrag', (tester) async {
    final (ui, _) = await _pump(tester, null, objects: [_note('a', 0, 0)]);
    await _openGallery(tester, ui);
    expect(find.byKey(const Key('stachelTemplateCat-Meine Vorlagen')), findsNothing);
    expect(find.byKey(const Key('stachelTemplateCat-Events')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTemplatesClose')));
    await tester.pumpAndSettle();
    ui.editor.select({'a'});
    showBoardMenu(
      tester.element(find.byType(BoardView)),
      ui,
      MenuTarget.object,
      const MenuAt(Offset.zero, objectId: 'a'),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSaveSelectionTemplate')), findsNothing);
  });

  testWidgets('Objektmenü „Auswahl als Vorlage speichern …“: Name vorgeschlagen, speichert Auswahl samt Verbinder', (
    tester,
  ) async {
    final host = _Host();
    final (ui, _) = await _pump(
      tester,
      host,
      objects: [
        _note('a', 0, 0, text: 'Bühne\nzweite Zeile'),
        _note('b', 300, 0, text: 'Bar'),
        {
          'id': 'c',
          'type': 'connector',
          'x': 0,
          'y': 0,
          'w': 1,
          'h': 1,
          'z': 'b1',
          'from': {'objectId': 'a'},
          'to': {'objectId': 'b'},
        },
      ],
    );
    ui.editor.select({'a', 'b'});
    showBoardMenu(
      tester.element(find.byType(BoardView)),
      ui,
      MenuTarget.object,
      const MenuAt(Offset.zero, objectId: 'a'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelSaveSelectionTemplate')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSaveTemplateDialog')), findsOneWidget);
    expect((tester.widget(find.byKey(const Key('stachelSaveTemplateName'))) as TextField).controller!.text, 'Bühne');
    await tester.enterText(find.byKey(const Key('stachelSaveTemplateName')), '   ');
    await tester.pump();
    expect((tester.widget(find.byKey(const Key('stachelSaveTemplateOk'))) as FilledButton).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('stachelSaveTemplateName')), 'Ablauf  Bar');
    await tester.pump();
    await tester.tap(find.byKey(const Key('stachelSaveTemplateOk')));
    await tester.pumpAndSettle();
    expect(host.saved.single.$1, 'Ablauf Bar');
    expect(host.saved.single.$2.map((o) => o['id']), ['a', 'b', 'c']);
    expect(host.messages.single, contains('Meine Vorlagen'));
  });
}
