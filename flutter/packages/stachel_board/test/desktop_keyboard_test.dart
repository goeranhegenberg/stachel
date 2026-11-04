// Desktop: Tastatur wie im Web (docs/features/desktop.md §2) – Werkzeug-Tasten, Entf, Strg Z/Y/A/D/C/V/G, Pfeile,
// Strg K/F, Esc, Enter, Strg B beim Schreiben, Mindmap Tab/Enter/Pfeile, Leertaste, Hand-Werkzeug, Tastenkürzel-
// Übersicht; ein anderes Textfeld (Suche) behält seine Tasten.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/desktop/register.dart' show handToolBehavior;
import 'package:stachel_board/src/features/shapes/shape_state.dart' show P2Tools;
import 'package:stachel_board/stachel_board.dart';

const _actions = {
  'core.group': 1,
  'core.ungroup': 1,
  'tools.layerStep': 1,
  'tools.copyStyle': 1,
  'tools.pasteStyle': 1,
  'tools.replace': 1,
  'richtext.whole': 1,
};

const _features = ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra', 'mind'];

Map<String, Object?> _sticky(String id, double x, double y, [Map<String, Object?> extra = const {}]) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 100,
  'h': 100,
  'text': id,
  'z': 'a$id',
  ...extra,
};

final _objects = [_sticky('a', 0, 0), _sticky('b', 200, 0)];

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;

  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops']! as List).cast<Map<String, Object?>>(),
  ];
  List<String> get acts => [
    for (final o in ops)
      if (o['op'] == 'act') o['name']! as String,
  ];
}

Future<_Board> _pump(WidgetTester tester, {List<Map<String, Object?>>? objects, String role = 'edit'}) async {
  tester.view.physicalSize = const Size(1200, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects ?? _objects}),
    rev: 20,
    role: role,
    features: _features,
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
    BoardDesktop.resetForTest();
    BoardViewPrefs.of(ui).searchOpen.value = false;
  });
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: BoardKeyboard(
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
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _Board(controller, source, editor, ui);
}

/// Presses [key] with Strg (and Umschalt / Alt).
Future<void> _mod(WidgetTester tester, LogicalKeyboardKey key, {bool shift = false, bool alt = false}) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  if (shift) await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  if (alt) await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(key);
  if (alt) await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  if (shift) await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pump();
}

Future<void> _shift(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pump();
}

Future<void> _key(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pump();
}

List<Map<String, Object?>> _mindMap() {
  final f = jsonDecode(File('../../../docs/native_fixtures/web/mindmap.json').readAsStringSync()) as Map;
  return [for (final o in ((f['cases'] as List).first as Map)['start'] as List) (o as Map).cast<String, Object?>()];
}

void main() {
  testWidgets('Werkzeug-Tasten wie im Web: N T S L P E F H V, Esc zurück zu Auswahl', (tester) async {
    final b = await _pump(tester);
    await _key(tester, LogicalKeyboardKey.keyN);
    expect(b.editor.activeToolId, 'sticky');
    await _key(tester, LogicalKeyboardKey.keyT);
    expect(b.editor.activeToolId, 'text');
    await _key(tester, LogicalKeyboardKey.keyS);
    expect(b.editor.activeToolId, 'shape');
    await _key(tester, LogicalKeyboardKey.keyL);
    expect(b.editor.activeToolId, 'connector');
    await _key(tester, LogicalKeyboardKey.keyP);
    expect(b.editor.activeToolId, 'pen');
    await _key(tester, LogicalKeyboardKey.keyE);
    expect(b.editor.activeToolId, 'eraser');
    await _key(tester, LogicalKeyboardKey.keyF);
    expect(b.editor.activeToolId, 'frame');
    await _key(tester, LogicalKeyboardKey.keyH);
    expect(b.editor.activeToolId, 'hand');
    await _key(tester, LogicalKeyboardKey.keyV);
    expect(b.editor.activeToolId, 'select');
    await _key(tester, LogicalKeyboardKey.keyO);
    expect(b.editor.activeToolId, 'shape');
    expect(P2Tools.of(b.editor).shapeEntry, 'circle', reason: 'O = Kreis');
    await _key(tester, LogicalKeyboardKey.escape);
    expect(b.editor.activeToolId, 'select');
  });

  testWidgets('Entf löscht die Auswahl, Strg Z / Strg Y / Strg Umschalt Z gehen an den Server', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'a'});
    await tester.pump();
    await _key(tester, LogicalKeyboardKey.delete);
    expect(b.controller.state['a'], isNull);
    await _mod(tester, LogicalKeyboardKey.keyZ);
    await tester.pump(const Duration(milliseconds: 200));
    expect(b.source.sent.where((m) => m['t'] == 'undo'), hasLength(1));
    // nothing to redo yet (the server answers the undo with `canRedo`): Strg Y / Strg Umschalt Z send nothing
    await _mod(tester, LogicalKeyboardKey.keyY);
    await _mod(tester, LogicalKeyboardKey.keyZ, shift: true);
    await tester.pump(const Duration(milliseconds: 200));
    expect(b.source.sent.where((m) => m['t'] == 'redo'), isEmpty);
    expect(b.source.sent.where((m) => m['t'] == 'undo'), hasLength(1), reason: 'Strg Umschalt Z ist kein Strg Z');
  });

  testWidgets('Strg A wählt alles, Strg D dupliziert, Esc hebt die Auswahl auf', (tester) async {
    final b = await _pump(tester);
    await _mod(tester, LogicalKeyboardKey.keyA);
    expect(b.editor.selection.value, {'a', 'b'});
    await _key(tester, LogicalKeyboardKey.escape);
    expect(b.editor.selection.value, isEmpty);
    b.editor.select({'a'});
    await _mod(tester, LogicalKeyboardKey.keyD);
    expect(b.controller.state.objects, hasLength(3));
  });

  testWidgets('Strg C / Strg V: Kopie einfügen', (tester) async {
    final b = await _pump(tester);
    final clip = <String, Object?>{};
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') clip.addAll((call.arguments as Map).cast<String, Object?>());
      if (call.method == 'Clipboard.getData') return clip;
      if (call.method == 'Clipboard.hasStrings') return {'value': clip.isNotEmpty};
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    b.editor.select({'a'});
    await _mod(tester, LogicalKeyboardKey.keyC);
    await tester.pump(const Duration(milliseconds: 50));
    expect(clip['text'], isNotNull);
    await _mod(tester, LogicalKeyboardKey.keyV);
    await tester.pump(const Duration(milliseconds: 50));
    expect(b.controller.state.objects, hasLength(3));
  });

  testWidgets('Pfeile verschieben um 1, mit Umschalt um 10', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'a'});
    await _key(tester, LogicalKeyboardKey.arrowRight);
    expect(b.controller.state['a']!.x, 1);
    await _shift(tester, LogicalKeyboardKey.arrowDown);
    expect(b.controller.state['a']!.y, 10);
  });

  testWidgets('Strg G gruppiert, Strg Umschalt G löst die Gruppe (Web-Aktionen)', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'a', 'b'});
    await _mod(tester, LogicalKeyboardKey.keyG);
    await _mod(tester, LogicalKeyboardKey.keyG, shift: true);
    await tester.pump(const Duration(milliseconds: 200));
    expect(b.acts, ['core.group', 'core.ungroup']);
  });

  testWidgets('Strg K öffnet die Befehlspalette, Strg F die Suche – deren Feld behält die Buchstaben', (tester) async {
    final b = await _pump(tester);
    await _mod(tester, LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelPaletteSheet')), findsOneWidget);
    Navigator.of(tester.element(find.byKey(const Key('stachelPaletteSheet')))).pop();
    await tester.pumpAndSettle();
    await _mod(tester, LogicalKeyboardKey.keyF);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSearchField')), findsOneWidget);
    await tester.showKeyboard(find.byKey(const Key('stachelSearchField')));
    await _key(tester, LogicalKeyboardKey.keyN);
    expect(b.editor.activeToolId, 'select', reason: 'N im Suchfeld ist ein Buchstabe, kein Werkzeug');
  });

  testWidgets('Enter bearbeitet, Strg B macht die Textauswahl fett, Esc beendet das Schreiben', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'a'});
    await _key(tester, LogicalKeyboardKey.enter);
    await tester.pump();
    expect(b.editor.editingId, 'a');
    await tester.pump();
    b.editor.textRange = (start: 0, end: 1);
    await _mod(tester, LogicalKeyboardKey.keyB);
    expect(b.editor.editingDoc!.hasMark(0, 1, 'bold'), isTrue);
    await _key(tester, LogicalKeyboardKey.escape);
    await tester.pump();
    expect(b.editor.editingId, isNull);
    // the keyboard is back on the board: Esc drops the selection, N is the note tool again
    await _key(tester, LogicalKeyboardKey.escape);
    expect(b.editor.selection.value, isEmpty);
    await _key(tester, LogicalKeyboardKey.keyN);
    expect(b.editor.activeToolId, 'sticky');
  });

  testWidgets('Tippen auf einer gewählten Notiz beginnt das Schreiben mit dem Zeichen', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'b'});
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX, character: 'x');
    await tester.pump();
    expect(b.editor.editingId, 'b');
    expect(b.editor.editingDoc!.text, 'bx');
    expect(b.editor.activeToolId, 'select');
    await tester.pump(const Duration(milliseconds: 400));
  });

  testWidgets('Strg B auf einer gewählten Notiz (ohne Schreiben): ganze Notiz fett', (tester) async {
    final b = await _pump(tester);
    b.editor.select({'a'});
    await _mod(tester, LogicalKeyboardKey.keyB);
    expect(b.controller.state['a']!.raw['bold'], isTrue);
  });

  testWidgets('Leertaste hält das Verschieben, Loslassen beendet es', (tester) async {
    await _pump(tester);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.space);
    expect(BoardDesktop.spaceDown.value, isTrue);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.space);
    expect(BoardDesktop.spaceDown.value, isFalse);
  });

  testWidgets('Zoom: Strg + / − / 0, Umschalt 1', (tester) async {
    final b = await _pump(tester);
    final z0 = b.editor.camera.value.z;
    await _mod(tester, LogicalKeyboardKey.equal);
    expect(b.editor.camera.value.z, greaterThan(z0));
    await _key(tester, LogicalKeyboardKey.minus);
    await _key(tester, LogicalKeyboardKey.minus);
    expect(b.editor.camera.value.z, lessThan(z0));
    await _mod(tester, LogicalKeyboardKey.digit0);
    expect(b.editor.camera.value.z, 1);
  });

  testWidgets('Nur ansehen: Werkzeuge und Löschen nicht, Ansicht schon', (tester) async {
    final b = await _pump(tester, role: 'view');
    b.editor.select({'a'});
    await _key(tester, LogicalKeyboardKey.delete);
    expect(b.controller.state['a'], isNotNull);
    await _key(tester, LogicalKeyboardKey.keyN);
    expect(b.editor.activeToolId, 'select');
    await _mod(tester, LogicalKeyboardKey.keyF);
    expect(BoardViewPrefs.of(b.ui).searchOpen.value, isTrue);
  });

  testWidgets('Mindmap: Tab legt ein Unterthema an, Pfeile wechseln das Thema', (tester) async {
    final b = await _pump(tester, objects: _mindMap());
    b.editor.select({'prog'});
    await _key(tester, LogicalKeyboardKey.arrowRight);
    expect(b.editor.selection.value, {'bands'});
    await _key(tester, LogicalKeyboardKey.arrowDown);
    expect(b.editor.selection.value, {'work'});
    await _key(tester, LogicalKeyboardKey.arrowLeft);
    expect(b.editor.selection.value, {'prog'});
    final before = b.controller.state.objects.length;
    await _key(tester, LogicalKeyboardKey.tab);
    await tester.pump();
    expect(b.controller.state.objects.length, before + 1);
    final id = b.editor.editingId!;
    expect(b.controller.state[id]!.mind.parent, 'prog');
  });

  testWidgets('? öffnet die Tastenkürzel mit Filter und Mausrad-Schalter', (tester) async {
    await _pump(tester);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.slash, character: '?');
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelShortcuts')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelShortcutsFilter')), 'gruppier');
    await tester.pump();
    expect(find.text('Gruppieren'), findsOneWidget);
    expect(find.text('Duplizieren'), findsNothing);
    expect(BoardDesktop.wheel.value, WheelMode.zoom, reason: 'Standard wie im Web');
    await tester.tap(find.text('Schwenken'));
    await tester.pump();
    expect(BoardDesktop.wheel.value, WheelMode.pan);
    expect(BoardPrefs.get(BoardDesktop.wheelKey), 'pan');
    await tester.tap(find.text('Zoomen'));
    await tester.pump();
    expect(BoardDesktop.wheel.value, WheelMode.zoom);
    expect(BoardPrefs.get(BoardDesktop.wheelKey), 'zoom');
    BoardPrefs.set(BoardDesktop.wheelKey, null);
  });

  test('Hand-Werkzeug: Ziehen verschiebt die Ansicht', () {
    final controller = BoardController(FixtureBoardSource(BoardSnapshot.fromJson({'objects': []})));
    final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
    BoardToolEvent at(Offset p) => BoardToolEvent(editor: editor, world: p, screen: p);
    handToolBehavior.onDrawStart!(at(const Offset(10, 10)));
    handToolBehavior.onDrawUpdate!(at(const Offset(40, 30)));
    handToolBehavior.onDrawEnd!(at(const Offset(50, 30)));
    expect(editor.camera.value.x, 40);
    expect(editor.camera.value.y, 20);
    editor.dispose();
    controller.dispose();
  });
}
