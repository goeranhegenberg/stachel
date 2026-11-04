// P3 in the board UI (parity audit C14–C15, D23, E16–E17, I02–I15, I29–I30): the tool „Karte, Tabelle, Mindmap“ places a
// card (title in place, `card.title` with its base) or a table (cell editor, `table.setCell`, ← → ↓, Tab after the
// last cell appends a row), the card's context bar (status, person, due date, details with live description), the
// object menu „In Karte umwandeln“, the table's context bar (rows, columns, head), templates (gallery → `structure.template`
// in the middle of the view, the camera only zooms out) and „Einfügen als …“ (`structure.paste`).

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/cards/card_model.dart';
import 'package:stachel_board/src/features/cards/structure_state.dart';
import 'package:stachel_board/src/features/templates/template_widgets.dart';

const _actions = {
  'structure.template': 1,
  'structure.paste': 1,
  'structure.toCard': 1,
  'structure.people': 1,
  'card.title': 1,
  'card.desc': 1,
  'table.setCell': 1,
  'table.addRow': 1,
  'table.addCol': 1,
  'table.removeRow': 1,
  'table.removeCol': 1,
  'table.resizeCol': 1,
  'table.setHead': 1,
};

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  StructureState get st => StructureState.of(editor);
}

Future<_Board> _pump(WidgetTester tester, {List<Map<String, Object?>> objects = const []}) async {
  tester.view.physicalSize = const Size(900, 700);
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
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
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
          child: Builder(
            builder: (context) => Column(
              children: [
                Expanded(
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: BoardView(
                          key: ui.viewKey,
                          controller: controller,
                          editor: editor,
                          fitOnLoad: false,
                          onObjectMenu: (w, id) =>
                              showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id)),
                        ),
                      ),
                      Positioned.fill(child: BoardOverlays(ui: ui)),
                      Positioned(
                        left: 8,
                        right: 8,
                        top: 8,
                        child: ListenableBuilder(
                          listenable: Listenable.merge([editor, controller]),
                          builder: (context, _) => BoardContextBar(ui: ui),
                        ),
                      ),
                    ],
                  ),
                ),
                ListenableBuilder(
                  listenable: Listenable.merge([editor, controller]),
                  builder: (context, _) => BoardToolbar(ui: ui, enabled: editor.editable),
                ),
              ],
            ),
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

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

List<Map<String, Object?>> _acts(FixtureBoardSource s, String name) => [
  for (final o in _ops(s))
    if (o['op'] == 'act' && o['name'] == name) o,
];

/// Answers the last `ops` message (act results by op index).
void _ack(FixtureBoardSource s, [Map<int, ActResult> results = const {}]) {
  final m = s.sent.lastWhere((m) => m['t'] == 'ops');
  s.push(AckMessage(m['req']! as int, 30, const [], results));
}

Future<void> _openMoreTool(WidgetTester tester, String moreKey) async {
  await tester.tap(find.byKey(const Key('stachelToolMore')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(moreKey)));
  await tester.pumpAndSettle();
}

Map<String, Object?> _card(String id, {double x = 100, double y = 100, Map<String, Object?> extra = const {}}) => {
  'id': id,
  'type': 'card',
  'x': x,
  'y': y,
  'w': 300,
  'h': 50,
  'text': 'Strom',
  'color': '#1763b5',
  'z': 'a1',
  ...extra,
};

Map<String, Object?> _table(String id) => {
  'id': id,
  'type': 'table',
  'x': 100,
  'y': 100,
  'w': 480,
  'h': 126,
  'color': '#0a0a0a',
  'z': 'a2',
  'table': {
    'rows': ['r1', 'r2', 'r3'],
    'cols': ['c1', 'c2', 'c3'],
    'cells': {'r1:c1': 'Bereich'},
    'widths': {},
  },
};

void main() {
  testWidgets('Werkzeug „Karte, Tabelle, Mindmap“: Karte anlegen, Titel an Ort und Stelle (card.title mit Basis)', (
    tester,
  ) async {
    final b = await _pump(tester);
    await _openMoreTool(tester, 'stachelMoreBlocks');
    expect(b.editor.activeToolId, 'structure.blocks');
    expect(find.byKey(const Key('stachelBlocks-card')), findsOneWidget);
    await tester.tapAt(const Offset(450, 300));
    await tester.pump();
    final create = _ops(b.source).firstWhere((o) => o['op'] == 'create');
    final card = (create['objects']! as List).single as Map;
    expect(card, containsPair('type', 'card'));
    expect((card['w'], card['h'], card['text'], card['color']), (300, 96, '', '#1763b5'));
    expect(b.editor.activeToolId, 'select');
    await tester.pump();
    expect(find.byKey(const Key('stachelCardTitleInline')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelCardTitleInline')), 'Bühne aufbauen');
    await tester.pump(const Duration(milliseconds: 400));
    final act = _acts(b.source, 'card.title').single;
    expect(act['args'], {'id': card['id'], 'base': '', 'text': 'Bühne aufbauen'});
    // Fertig (Enter) beendet das Schreiben
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(find.byKey(const Key('stachelCardTitleInline')), findsNothing);
  });

  testWidgets('Karte: Kontextleiste Status/Zuständig/Fällig (update mit Höhe), Details mit Beschreibung live', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_card('k1')]);
    b.editor.select({'k1'});
    await tester.pump();
    expect(find.byKey(const Key('stachelCardStatus')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelCardStatus')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelCardStatus-doing')));
    await tester.pumpAndSettle();
    var upd = _ops(b.source).lastWhere((o) => o['op'] == 'update');
    final want = cardContentHeight(BoardObject({..._card('k1'), 'status': 'doing'}));
    expect(upd['patches'], {
      'k1': {'status': 'doing', 'h': want},
    });
    // Zuständig: ich (aus der Sitzung) und „Niemand“
    await tester.tap(find.byKey(const Key('stachelCardWho')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelCardPerson-none')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelCardPerson-none')));
    await tester.pumpAndSettle();
    upd = _ops(b.source).lastWhere((o) => o['op'] == 'update');
    expect((upd['patches']! as Map)['k1'], containsPair('assignee', null));
    // Details: Beschreibung live als card.desc
    await tester.tap(find.byKey(const Key('stachelCardDetails')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelCardDetailsSheet')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelCardDesc')), 'Kabel holen');
    await tester.pump(const Duration(milliseconds: 400));
    expect(_acts(b.source, 'card.desc').single['args'], {'id': 'k1', 'base': '', 'text': 'Kabel holen'});
    // Tag hinzufügen
    await tester.scrollUntilVisible(
      find.byKey(const Key('stachelCardNewTag')),
      200,
      scrollable: find
          .descendant(of: find.byKey(const Key('stachelCardDetailsSheet')), matching: find.byType(Scrollable))
          .first,
    );
    await tester.enterText(find.byKey(const Key('stachelCardNewTag')), 'Technik');
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('stachelCardAddTag')));
    await tester.tap(find.byKey(const Key('stachelCardAddTag')));
    await tester.pump();
    upd = _ops(b.source).lastWhere((o) => o['op'] == 'update');
    expect(((upd['patches']! as Map)['k1'] as Map)['tags'], [
      {'label': 'Technik', 'color': '#c9e14a'},
    ]);
  });

  testWidgets('Objekt-Menü „In Karte umwandeln“ nur für ungesperrte Haftnotizen → structure.toCard', (tester) async {
    final b = await _pump(
      tester,
      objects: [
        {'id': 'n1', 'type': 'sticky', 'x': 100, 'y': 100, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a1'},
        _card('k1', x: 500),
      ],
    );
    b.editor.select({'n1'});
    await tester.pump();
    showBoardMenu(
      tester.element(find.byType(BoardView)),
      b.ui,
      MenuTarget.object,
      const MenuAt(Offset(200, 200), objectId: 'n1'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelMenuToCard')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'structure.toCard').single['args'], {
      'ids': ['n1'],
    });
    b.editor.select({'k1'});
    await tester.pump();
    showBoardMenu(
      tester.element(find.byType(BoardView)),
      b.ui,
      MenuTarget.object,
      const MenuAt(Offset(600, 120), objectId: 'k1'),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelMenuToCard')), findsNothing);
  });

  testWidgets(
    'Tabelle: Werkzeug legt 3×3 an und schreibt in die erste Zelle; → wandert, Tab nach der letzten Zelle hängt '
    'eine Zeile an',
    (tester) async {
      final b = await _pump(tester);
      await _openMoreTool(tester, 'stachelMoreBlocks');
      await tester.tap(find.byKey(const Key('stachelBlocks-table')));
      await tester.pump();
      await tester.tapAt(const Offset(450, 300));
      await tester.pump();
      final t = ((_ops(b.source).firstWhere((o) => o['op'] == 'create')['objects']! as List).single as Map)
          .cast<String, Object?>();
      expect((t['type'], t['w'], t['h']), ('table', 480, 126));
      final rows = ((t['table']! as Map)['rows']! as List).cast<String>();
      final cols = ((t['table']! as Map)['cols']! as List).cast<String>();
      await tester.pump();
      expect(find.byKey(const Key('stachelCellEditor')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelCellEditor')), 'Bar');
      await tester.pump(const Duration(milliseconds: 400));
      expect(_acts(b.source, 'table.setCell').single['args'], {
        'id': t['id'],
        'r': rows[0],
        'c': cols[0],
        'base': '',
        'text': 'Bar',
      });
      await tester.tap(find.byKey(const Key('stachelCellNext')));
      await tester.pump();
      expect(b.st.edit!.cell, (r: rows[0], c: cols[1]));
      await tester.tap(find.byKey(const Key('stachelCellDown')));
      await tester.pump();
      expect(b.st.edit!.cell, (r: rows[1], c: cols[1]));
      // letzte Zelle, Tab: neue Zeile (table.addRow), dann deren erste Zelle
      b.st.startCell(t['id']! as String, (r: rows[2], c: cols[2]));
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCellNext')));
      await tester.pump();
      final add = _acts(b.source, 'table.addRow').single;
      expect(add['args'], {'id': t['id']});
      final key = add['key']! as String;
      // der Server bestätigt das Anlegen und die Zellen, schickt die neue Zeile und beantwortet die Aktion
      final addReq = b.source.sent.lastWhere((m) => m['t'] == 'ops')['req']! as int;
      b.source.push(
        PatchMessage(
          rev: 22,
          changes: [
            ObjectCreated(
              BoardObject({
                ...t,
                'z': 'a1',
                'h': 168,
                'table': {
                  'rows': [...rows, '$key-1'],
                  'cols': cols,
                  'cells': {'${rows[0]}:${cols[0]}': 'Bar'},
                  'widths': {},
                },
              }),
            ),
          ],
        ),
      );
      for (final m in [...b.source.sent.where((m) => m['t'] == 'ops' && m['req'] != addReq)]) {
        b.source.push(AckMessage(m['req']! as int, 22));
      }
      b.source.push(
        AckMessage(addReq, 22, const [], {
          0: ActResult(data: {'row': '$key-1'}),
        }),
      );
      await tester.pump();
      await tester.pump();
      expect(b.st.edit!.cell, (r: '$key-1', c: cols[0]));
      await tester.tap(find.byKey(const Key('stachelCellDone')));
      await tester.pump();
      expect(find.byKey(const Key('stachelCellEditor')), findsNothing);
    },
  );

  testWidgets('Tabelle: Tippen setzt die aktive Zelle, Kontextleiste Zeile/Spalte/Kopfbereich als Web-Aktionen', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_table('t1')]);
    // erstes Tippen wählt (und merkt die Zelle), zweites schreibt in diese Zelle
    await tester.tapAt(const Offset(100 + 400, 100 + 60));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.editor.selection.value, {'t1'});
    expect(b.st.activeCell(b.controller.state['t1']!), (r: 'r2', c: 'c3'));
    expect(find.byKey(const Key('stachelTableActive')), findsOneWidget);
    expect(find.byKey(const Key('stachelTableAddRow')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTableRowAdd')));
    await tester.pump();
    expect(_acts(b.source, 'table.addRow').single['args'], {'id': 't1', 'after': 'r2'});
    _ack(b.source, {
      0: const ActResult(data: {'row': 'neu'}),
    });
    await tester.pump();
    await tester.tap(find.byKey(const Key('stachelTableHead')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelTableHead-both')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'table.setHead').single['args'], {'id': 't1', 'head': 'both'});
    await tester.tapAt(const Offset(100 + 400, 100 + 60));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('stachelCellEditor')), findsOneWidget);
  });

  testWidgets('Vorlagen: Galerie (Suche, Kategorie, Vorschau, Enthält) → structure.template in der Bildmitte, Kamera '
      'zoomt nur heraus', (tester) async {
    final b = await _pump(tester);
    showBoardMenu(tester.element(find.byType(BoardView)), b.ui, MenuTarget.board, const MenuAt(Offset.zero));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelBoardTemplates')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplates')), findsOneWidget);
    expect(find.byKey(const Key('stachelTemplatePreview-kanban')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelTemplateCat-Events')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplate-kanban')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelTemplate-shifts')));
    await tester.pump(const Duration(milliseconds: 500)); // Doppeltippen = gleich einfügen: Tippen wartet kurz
    await tester.pumpAndSettle();
    // ignore: avoid_print
    print(
      'ENT ${find.byKey(const Key('stachelTemplateContains')).evaluate().map((e) => (e.widget as Text).data).toList()}',
    );
    expect(find.textContaining('Enthält 1 Rahmen · 1 Tabelle'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTemplateSearch')), 'nichts dergleichen');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelTemplatesNone')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelTemplateSearch')), '');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelTemplateUse')));
    await tester.pumpAndSettle();
    final act = _acts(b.source, 'structure.template').single;
    final size = b.st.viewSize;
    final c = b.editor.camera.value.toWorld(size.center(Offset.zero));
    expect(act['args'], {'template': 'shifts', 'x': c.dx.roundToDouble(), 'y': c.dy.roundToDouble()});
    // Vorlage größer als der Ausschnitt: Kamera zoomt heraus (nie hinein)
    final z0 = b.editor.camera.value.z;
    _ack(b.source, {
      0: const ActResult(
        select: [],
        data: {
          'rect': {'x': -800, 'y': -300, 'w': 1640, 'h': 600},
        },
      ),
    });
    await tester.pumpAndSettle();
    expect(b.editor.camera.value.z, lessThan(z0));
  });

  testWidgets('Einfügen als …: Tabellendaten → Tabelle / N Haftnotizen / eine Haftnotiz als structure.paste', (
    tester,
  ) async {
    final b = await _pump(tester);
    final ctx = tester.element(find.byType(BoardView));
    expect(await showPasteAs(ctx, b.ui, 'nur eine Zeile', Offset.zero), isFalse);
    showPasteAs(ctx, b.ui, 'A\tB\n1\t2', const Offset(10, 20));
    await tester.pumpAndSettle();
    expect(find.text('Tabellendaten mit 2 Zeilen und 2 Spalten.'), findsOneWidget);
    expect(find.text('4 HAFTNOTIZEN'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelPasteTable')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'structure.paste').single['args'], {
      'text': 'A\tB\n1\t2',
      'as': 'table',
      'x': 10,
      'y': 20,
      'color': b.editor.stickyColor,
    });
    showPasteAs(ctx, b.ui, 'eins\nzwei\ndrei', Offset.zero);
    await tester.pumpAndSettle();
    expect(find.text('Text mit 3 Zeilen.'), findsOneWidget);
    expect(find.byKey(const Key('stachelPasteTable')), findsNothing);
    await tester.tap(find.byKey(const Key('stachelPasteNotes')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'structure.paste').last['args'], containsPair('as', 'notes'));
  });

  testWidgets('Seitengriffe einer Karte: Breite ≥ 160 und Höhe aus dem Inhalt (Typ-Regel im Editor)', (tester) async {
    final b = await _pump(tester, objects: [_card('k1', x: 100, y: 100)]);
    b.editor.select({'k1'});
    await tester.pump();
    final ids = b.editor.handles().map((h) => h.id).toList();
    expect(ids, ['e', 'w', 'add-n', 'add-e', 'add-s', 'add-w'], reason: 'web: handles e/w, addHandles (P1)');
    final e = b.editor.handles().firstWhere((h) => h.id == 'e');
    b.editor.handleStart('e', e.at);
    b.editor.handleUpdate(e.at - const Offset(250, 0));
    b.editor.handleEnd(e.at - const Offset(250, 0));
    await tester.pump();
    final o = b.controller.state['k1']!;
    expect(o.w, 160);
    expect(o.h, cardContentHeight(o));
  });

  testWidgets('„Einfügen“ (P1) mit Tabellendaten fragt „Einfügen als …“ (P3); eine Zeile wird gleich eine Notiz', (
    tester,
  ) async {
    final b = await _pump(tester);
    final read = BoardClipboard.read;
    addTearDown(() => BoardClipboard.read = read);
    final ctx = tester.element(find.byType(BoardView));
    BoardClipboard.read = () async => 'A\tB\n1\t2';
    unawaited(pasteAt(b.ui, const Offset(10, 20), context: ctx));
    await tester.pumpAndSettle();
    expect(find.text('Tabellendaten mit 2 Zeilen und 2 Spalten.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelPasteTable')));
    await tester.pumpAndSettle();
    expect(_acts(b.source, 'structure.paste').single['args'], containsPair('as', 'table'));
    BoardClipboard.read = () async => 'nur eine Zeile';
    await pasteAt(b.ui, const Offset(10, 20), context: ctx);
    await tester.pumpAndSettle();
    expect(b.controller.state.objects.values.where((o) => o.type == 'sticky').single.text, 'nur eine Zeile');
  });
}
