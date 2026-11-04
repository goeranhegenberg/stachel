// Q3 „Bedienung“ in the board UI (web features/tools/organize.tsx): the object
// menu „Clustern“ (→ `tools.cluster`) and „Typ wechseln“ (→ `tools.convert`), the row „Ersetzen durch“ of the search
// (preview like the web's `replacePreview`, → `tools.replace`, not for „ansehen“) and the command palette „Befehl
// suchen …“ in the board menu (lists tools and menu entries, runs them). The model values are the web's
// (web/src/features/tools/organize.test.ts).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/commands/commands_model.dart';
import 'package:stachel_board/src/features/commands/palette.dart';
import 'package:stachel_board/src/features/search/search_bar.dart';

const _actions = {'tools.cluster': 1, 'tools.convert': 1, 'tools.replace': 1};

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
}

Future<_Board> _pump(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = const [],
  Map<String, int> actions = _actions,
  String role = 'edit',
}) async {
  tester.view.physicalSize = const Size(900, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    role: role,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  addTearDown(() {
    replaceOpen.value = false;
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
  return _Board(controller, source, editor, ui);
}

List<Map<String, Object?>> _acts(FixtureBoardSource s, String name) => [
  for (final m in s.sent)
    if (m['t'] == 'ops')
      for (final o in (m['ops'] as List).cast<Map<String, Object?>>())
        if (o['op'] == 'act' && o['name'] == name) o,
];

Map<String, Object?> _note(String id, double x, double y, {String? text, String? color, bool locked = false}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 100,
  'h': 100,
  'text': text ?? id,
  'z': 'a$id',
  'color': ?color,
  if (locked) 'locked': true,
};

BoardObject _obj(Map<String, Object?> raw) => BoardObject.fromJson(raw)!;

Future<void> _objectMenu(WidgetTester tester, _Board b, String id) async {
  showBoardMenu(
    tester.element(find.byType(BoardView)),
    b.ui,
    MenuTarget.object,
    MenuAt(const Offset(150, 150), objectId: id),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('Modell wie im Web', () {
    test('Clustern: Gruppen zählen einmal, Rahmen/Verbinder/Gesperrtes nicht', () {
      final sel = [
        _obj(_note('a', 0, 0)),
        _obj({..._note('g1', 0, 0), 'groupId': 'G'}),
        _obj({..._note('g2', 0, 0), 'groupId': 'G'}),
        _obj(_note('l', 0, 0, locked: true)),
        _obj({'id': 'f', 'type': 'frame', 'x': 0, 'y': 0, 'w': 9, 'h': 9}),
      ];
      expect(clusterUnitCount(sel), 2);
      expect(canCluster(sel.sublist(0, 1)), isFalse);
    });

    test('Typ wechseln: Ziele ohne den gemeinsamen Typ, nichts bei Gesperrtem oder Fremdem', () {
      expect(convertTargets([_obj(_note('a', 0, 0))]), ['shape', 'text', 'card']);
      expect(
        convertTargets([
          _obj(_note('a', 0, 0)),
          _obj({..._note('t', 0, 0), 'type': 'text'}),
        ]),
        ['sticky', 'shape', 'text', 'card'],
      );
      expect(convertTargets([_obj(_note('a', 0, 0, locked: true))]), isEmpty);
      expect(
        convertTargets([
          _obj({'id': 'f', 'type': 'frame', 'x': 0, 'y': 0, 'w': 9, 'h': 9}),
        ]),
        isEmpty,
      );
    });

    test('Suchen & Ersetzen: Fundstellen und Vorschau wie replace.ts', () {
      expect(findAll('Bühne, buehne, BÜHNE', 'bühne'), [(0, 5), (7, 13), (15, 20)]);
      expect(findAll('abc', '  '), isEmpty);
      final objs = [
        _obj({..._note('n', 0, 0), 'text': 'Die Bühne steht\nbühne zwei'}),
        _obj({'id': 'f', 'type': 'frame', 'x': 0, 'y': 0, 'w': 9, 'h': 9, 'title': 'Bühnenplan'}),
        _obj({
          'id': 'c',
          'type': 'card',
          'x': 0,
          'y': 0,
          'w': 300,
          'h': 96,
          'text': 'Bühne bauen',
          'desc': 'Bühne bis Freitag',
        }),
        _obj(_note('l', 0, 0, text: 'Bühne', locked: true)),
      ];
      final p = replacePreview(objs, 'bühne');
      expect((p.total, p.objects, p.locked), (5, 3, 1));
      expect(replacePreviewText(p), '5 Stellen in 3 Objekten, 1 gesperrt');
      expect(replacePreviewText((total: 0, objects: 0, locked: 0)), 'Keine Stelle zum Ersetzen');
    });

    test('Befehlspalette: Wortanfang vor Teilwort, Umlaut-tolerant (wie filterCommands)', () {
      PaletteCommand c(String label, [String group = 'Board']) =>
          PaletteCommand(id: label, label: label, group: group, run: (_, _) async {});
      final list = [
        c('Board exportieren …'),
        c('Export als PNG'),
        c('Auf dem Board suchen'),
        c('Größe ändern', 'Auswahl'),
      ];
      expect(filterCommands(list, 'export').map((x) => x.label), ['Export als PNG', 'Board exportieren …']);
      expect(filterCommands(list, 'groesse').map((x) => x.label), ['Größe ändern']);
      expect(filterCommands(list, 'auswahl').map((x) => x.label), ['Größe ändern']);
      expect(filterCommands(list, ''), hasLength(4));
      final flat = flattenMenu([
        MenuEntry(
          label: 'Ausrichten',
          items: [
            MenuEntry(label: 'Links', onSelect: (_, _) {}),
            MenuEntry(label: 'Aus', disabled: true, onSelect: (_, _) {}),
          ],
        ),
        MenuEntry(label: 'Löschen', onSelect: (_, _) {}),
      ]);
      expect(flat.map((f) => f.$1), ['Ausrichten › Links', 'Löschen']);
    });
  });

  testWidgets('Objekt-Menü „Clustern › Nach Farbe“ → tools.cluster mit der Auswahl', (tester) async {
    final b = await _pump(
      tester,
      objects: [
        _note('a', 100, 100, color: '#fff27a'),
        _note('b', 300, 100),
      ],
    );
    b.editor.select({'a', 'b'});
    await tester.pump();
    await _objectMenu(tester, b, 'a');
    await tester.tap(find.byKey(const Key('stachelMenuCluster')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelMenuCluster-color')));
    await tester.pumpAndSettle();
    final args = _acts(b.source, 'tools.cluster').single['args']! as Map;
    expect(args['by'], 'color');
    expect((args['ids'] as List).toSet(), {'a', 'b'});
  });

  testWidgets('„Clustern“ fehlt bei einem Objekt und ohne Server-Aktion', (tester) async {
    final b = await _pump(tester, objects: [_note('a', 100, 100), _note('b', 300, 100)], actions: const {});
    b.editor.select({'a', 'b'});
    await tester.pump();
    await _objectMenu(tester, b, 'a');
    expect(find.byKey(const Key('stachelMenuCluster')), findsNothing);
    expect(find.byKey(const Key('stachelMenuConvert')), findsNothing);
  });

  testWidgets('Objekt-Menü „Typ wechseln › Form“ → tools.convert; nichts für Gesperrtes', (tester) async {
    final b = await _pump(tester, objects: [_note('a', 100, 100), _note('l', 400, 100, locked: true)]);
    b.editor.select({'a'});
    await tester.pump();
    await _objectMenu(tester, b, 'a');
    await tester.tap(find.byKey(const Key('stachelMenuConvert')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelMenuConvert-sticky')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelMenuConvert-shape')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'tools.convert').single['args'], {
      'ids': ['a'],
      'to': 'shape',
    });
    b.editor.select({'l'});
    await tester.pump();
    await _objectMenu(tester, b, 'l');
    expect(find.byKey(const Key('stachelMenuConvert')), findsNothing);
  });

  testWidgets('Suchen & Ersetzen: Vorschau, „Alle“ und „Ersetzen“ ab dem aktuellen Treffer → tools.replace', (
    tester,
  ) async {
    final b = await _pump(
      tester,
      objects: [
        _note('a', 100, 100, text: 'Bar und bar'),
        _note('b', 300, 100, text: 'Bar'),
        _note('l', 500, 100, text: 'bar', locked: true),
      ],
    );
    openReplace(b.ui);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'bar');
    await tester.pump();
    await tester.enterText(find.byKey(const Key('stachelReplaceField')), 'Theke');
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(const Key('stachelReplaceCount'))).data,
      '3 Stellen in 2 Objekten, 1 gesperrt',
    );
    await tester.tap(find.byKey(const Key('stachelReplaceAll')));
    await tester.pump();
    expect(_acts(b.source, 'tools.replace').single['args'], {
      'ids': ['a', 'b', 'l'],
      'query': 'bar',
      'replace': 'Theke',
      'first': false,
    });
    // nächster Treffer, dann „Ersetzen“: ab b, nur die erste Fundstelle
    await tester.tap(find.byKey(const Key('stachelSearchNext')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('stachelReplaceOne')));
    await tester.pump();
    expect(_acts(b.source, 'tools.replace').last['args'], {
      'ids': ['b', 'l', 'a'],
      'query': 'bar',
      'replace': 'Theke',
      'first': true,
    });
    // Umschalter schließt die Zeile
    await tester.tap(find.byKey(const Key('stachelSearchReplaceToggle')));
    await tester.pump();
    expect(find.byKey(const Key('stachelReplaceBar')), findsNothing);
  });

  testWidgets('Ersetzen gibt es nicht beim Ansehen', (tester) async {
    final b = await _pump(
      tester,
      objects: [_note('a', 100, 100, text: 'bar')],
      role: 'view',
    );
    openReplace(b.ui);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSearchBar')), findsOneWidget);
    expect(find.byKey(const Key('stachelSearchReplaceToggle')), findsNothing);
    expect(find.byKey(const Key('stachelReplaceBar')), findsNothing);
  });

  testWidgets('Board-Menü „Befehl suchen …“: Palette listet Werkzeuge und Menüs, führt den Befehl aus', (tester) async {
    final b = await _pump(tester, objects: [_note('a', 100, 100)]);
    b.editor.select({'a'});
    await tester.pump();
    showBoardMenu(tester.element(find.byType(BoardView)), b.ui, MenuTarget.board, const MenuAt(Offset(300, 300)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelBoardReplace')), findsOneWidget);
    await tester.tap(find.byKey(const Key(paletteMenuKey)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelPaletteSheet')), findsOneWidget);
    // ohne Suchbegriff: Gruppen mit Überschrift, die Palette selbst fehlt
    expect(find.text('AUSWAHL'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('WERKZEUGE'),
      300,
      scrollable: find.descendant(of: find.byKey(const Key('stachelPaletteList')), matching: find.byType(Scrollable)),
    );
    expect(find.text('WERKZEUGE'), findsOneWidget);
    expect(find.byKey(const Key('stachelPalette-board:Befehl suchen …')), findsNothing);
    await tester.enterText(find.byKey(const Key('stachelPaletteField')), 'typ form');
    await tester.pump();
    expect(find.text('Kein Befehl passt zu „typ form“.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelPaletteField')), 'Form');
    await tester.pump();
    final convert = find.byKey(const Key('stachelPalette-object:Typ wechseln › Form'));
    expect(convert, findsOneWidget);
    await tester.tap(convert);
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'tools.convert').single['args'], {
      'ids': ['a'],
      'to': 'shape',
    });
    // Werkzeug aus der Palette
    showBoardMenu(tester.element(find.byType(BoardView)), b.ui, MenuTarget.board, const MenuAt(Offset(300, 300)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key(paletteMenuKey)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('stachelPaletteField')), 'stift');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.go);
    await tester.pumpAndSettle();
    expect(b.editor.activeToolId, 'pen');
  });
}
