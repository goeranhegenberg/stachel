// Mind maps in the board widget (like the web's structure/mindmap): buttons at the nodes (plus on the selected node,
// root on both sides; collapse „−“; count on a collapsed branch), subtopic/same level/collapse/delete/duplicate/drag as
// the `mind` op (contract §8.6) with the prediction shown at once, writing in place (Enter = same level, a new node
// left empty goes away), the mind map tool and template, no size handles, a server without the feature gets the
// predicted plain ops. Golden of a map in the web's look with its buttons.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'sample_mindmap.dart';
import 'test_fonts.dart';

/// Fixture source whose server knows the `mind` op (or not, [mind] false).
class _Source extends FixtureBoardSource {
  _Source(super.snapshot, {this.mind = true}) : super(rev: 5);
  final bool mind;

  @override
  Future<void> open({String? resumeEpoch, int? resumeRev}) async {
    if (!mind) return super.open(resumeEpoch: resumeEpoch, resumeRev: resumeRev);
    push(
      WelcomeMessage(
        proto: nativeProtocolVersion,
        rev: rev,
        snapshot: snapshot,
        info: const ConnectionInfo(
          epoch: 'fixture',
          role: 'edit',
          boardId: 'fixture',
          features: ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'mind'],
        ),
      ),
    );
  }

  @override
  ValueNotifier<BoardConnection> get connection => _live;
  final _live = ValueNotifier(BoardConnection.live);
}

/// The sample map of the web reference (Sommerfest → Programm (Bands und Musik, Workshops), Orga; Technik (Strom)
/// on the left), laid out by the web code.
List<Map<String, Object?>> _map() {
  final f = jsonDecode(File('../../../docs/native_fixtures/web/mindmap.json').readAsStringSync()) as Map;
  return [for (final o in ((f['cases'] as List).first as Map)['start'] as List) (o as Map).cast<String, Object?>()];
}

typedef _Env = (BoardController, _Source, BoardEditor, GlobalKey<BoardViewState>);

Future<_Env> _pump(WidgetTester tester, {bool mind = true, List<Map<String, Object?>>? objects, Camera? camera}) async {
  tester.view.physicalSize = const Size(1000, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = _Source(BoardSnapshot.fromJson({'objects': objects ?? _map()}), mind: mind);
  final controller = BoardController(
    source,
    presenceInterval: Duration.zero,
    sendInterval: const Duration(milliseconds: 30),
  );
  addTearDown(controller.dispose);
  final scene = BoardScene(controller.state);
  final cam = CameraController(camera ?? const Camera(-40, 60, 1));
  final editor = BoardEditor(controller: controller, scene: scene, camera: cam)..onHaptic = () {};
  addTearDown(editor.dispose);
  final key = GlobalKey<BoardViewState>();
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: RepaintBoundary(
          key: const Key('board'),
          child: BoardView(key: key, controller: controller, editor: editor, fitOnLoad: false, reportPresence: false),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return (controller, source, editor, key);
}

List<Map<String, Object?>> _ops(_Source s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

List<Map<String, Object?>> _mindOps(_Source s) => [
  for (final o in _ops(s))
    if (o['op'] == 'mind') o,
];

Offset _screen(BoardEditor e, String id, {double fx = 0.5, double fy = 0.5}) {
  final o = e.controller.state[id]!;
  return e.camera.value.toScreen(Offset(o.x + o.w * fx, o.y + o.h * fy));
}

Future<void> _tap(WidgetTester tester, Offset p) async {
  await tester.tapAt(p);
  await tester.pump(const Duration(milliseconds: 350)); // past the double tap window
}

void main() {
  setUpAll(() async {
    await loadBoardFonts();
  });

  testWidgets(
    'ausgewählter Knoten: „+“ (Wurzel beidseitig), „−“ bei Unterthemen, keine Größen-Griffe; eingeklappt zeigt die Zahl',
    (tester) async {
      final (c, source, e, _) = await _pump(tester);
      e.select({'root'});
      await tester.pump();
      final root = e.mindButtons().where((b) => b.nodeId == 'root').toList();
      expect(root.map((b) => '${b.kind}-${b.side}'), ['toggle-r', 'add-r', 'toggle-l', 'add-l']);
      expect(e.handles(), isEmpty, reason: 'Größe bestimmt das Layout');
      e.select({'bands'});
      await tester.pump();
      expect(e.mindButtons().where((b) => b.nodeId == 'bands').map((b) => b.kind), ['add'], reason: 'Blatt: nur Plus');
      // Programm einklappen über den Knopf: Op `collapse`, Bands/Workshops sofort versteckt, Zahl am Knoten
      e.select({'prog'});
      await tester.pump();
      final toggle = e.mindButtons().firstWhere((b) => b.nodeId == 'prog' && b.kind == 'toggle');
      await _tap(tester, toggle.at);
      expect(_mindOps(source).last, {'op': 'mind', 'do': 'collapse', 'id': 'prog', 'collapsed': true});
      expect(c.state['bands']!.mind.hidden, isTrue);
      e.select(const {});
      await tester.pump();
      final count = e.mindButtons().singleWhere((b) => b.nodeId == 'prog');
      expect([count.kind, count.collapsed, count.count], ['toggle', true, 2]);
      // auch ohne Auswahl antippbar: ausklappen
      await _tap(tester, count.at);
      expect(_mindOps(source).last, {'op': 'mind', 'do': 'collapse', 'id': 'prog', 'collapsed': false});
      expect(c.state['bands']!.mind.hidden, isFalse);
    },
  );

  testWidgets(
    '„+“ legt ein Unterthema an (sofort mit Layout wie der Server), Schreiben ordnet neu an, Enter = gleiche Ebene, leer verschwindet',
    (tester) async {
      final (c, source, e, _) = await _pump(tester);
      e.select({'orga'});
      await tester.pump();
      final plus = e.mindButtons().singleWhere((b) => b.nodeId == 'orga' && b.kind == 'add');
      await _tap(tester, plus.at);
      final op = _mindOps(source).last;
      expect(op['do'], 'child');
      expect(op['id'], 'orga');
      final nid = op['new'] as String;
      // gleiche Rechnung wie der Web-Code (Referenzfall „Unterthema an einem Hauptthema“)
      final want = (MindPlanner.fromRaw(_map())..child('orga', nid))[nid]!;
      final shown = c.state[nid]!;
      expect([shown.x, shown.y, shown.w, shown.h], [want['x'], want['y'], want['w'], want['h']]);
      expect(shown.color, c.state['orga']!.color, reason: 'Unterthemen erben die Zweigfarbe');
      expect(e.editingId, nid, reason: 'gleich schreiben');
      await tester.pump();
      expect(find.byKey(const Key('boardTextField')), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('boardTextField')),
        'Helfer:innen und alle, die sonst noch mit anpacken',
      );
      await tester.pump(const Duration(milliseconds: 100));
      final texts = [
        for (final o in _mindOps(source))
          if (o['do'] == 'text') o,
      ];
      expect(texts.last, {
        'op': 'mind',
        'do': 'text',
        'id': nid,
        'text': 'Helfer:innen und alle, die sonst noch mit anpacken',
      });
      expect(c.state[nid]!.h, greaterThan(want['h']! as num), reason: 'langer Text bricht um, der Knoten wächst');

      // Enter (Tastatur „weiter“): Thema auf gleicher Ebene darunter, wieder im Schreiben
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pump();
      final sib = _mindOps(source).last;
      expect(sib['do'], 'sibling');
      expect(sib['id'], nid);
      final sid = sib['new'] as String;
      expect(e.editingId, sid);
      expect(c.state[sid]!.mind.parent, 'orga');
      // leer gelassen und fertig: verschwindet wieder (eigener Schritt), Auswahl auf den Elternknoten
      e.stopEditing();
      await tester.pump();
      expect(_mindOps(source).last, {
        'op': 'mind',
        'do': 'remove',
        'ids': [sid],
      });
      expect(c.state[sid], isNull);
      expect(e.selection.value, {'orga'});
      expect(c.state[nid], isNotNull, reason: 'der beschriebene bleibt');
    },
  );

  testWidgets('Antippen eines ausgewählten Knotens schreibt (Klartext, kein Rich-Text); Wurzel: Enter beendet nur', (
    tester,
  ) async {
    final (c, source, e, _) = await _pump(tester);
    await _tap(tester, _screen(e, 'root'));
    expect(e.selection.value, {'root'});
    await _tap(tester, _screen(e, 'root'));
    expect(e.editingId, 'root');
    await tester.enterText(find.byKey(const Key('boardTextField')), 'Festival 2028');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(e.editingId, isNull);
    expect([for (final o in _mindOps(source)) o['do']], everyElement('text'));
    expect(c.state['root']!.raw.containsKey('content'), isFalse);
    expect(c.state['root']!.text, 'Festival 2028');
  });

  testWidgets(
    'Ziehen: auf einen anderen Knoten = umhängen (ein Schritt: update + drop); Wurzel ziehen nimmt die Mindmap mit',
    (tester) async {
      final (c, source, e, _) = await _pump(tester);
      // Bands auswählen, dann auf Orga ziehen
      e.select({'bands'});
      await tester.pump();
      final from = _screen(e, 'bands'), to = _screen(e, 'orga');
      final g = await tester.startGesture(from);
      for (var i = 1; i <= 8; i++) {
        await g.moveTo(Offset.lerp(from, to, i / 8)!);
        await tester.pump(const Duration(milliseconds: 20));
      }
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
      final last = (source.sent.lastWhere((m) => m['t'] == 'ops')['ops'] as List).cast<Map<String, Object?>>();
      expect(last.map((o) => o['op']), ['update', 'mind']);
      expect(last[1], {
        'op': 'mind',
        'do': 'drop',
        'ids': ['bands'],
      });
      expect(c.state['bands']!.mind.parent, 'orga');
      expect(c.state['bands']!.color, c.state['orga']!.color);

      // Wurzel ziehen: alle Knoten wandern mit (Layout), Op `layout` mit
      final before = {
        for (final id in ['tech', 'strom', 'orga']) id: Offset(c.state[id]!.x, c.state[id]!.y),
      };
      e.select({'root'});
      await tester.pump();
      final r = _screen(e, 'root');
      final g2 = await tester.startGesture(r);
      await g2.moveTo(r + const Offset(30, 0));
      await tester.pump(const Duration(milliseconds: 20));
      await g2.moveTo(r + const Offset(100, 50));
      await tester.pump(const Duration(milliseconds: 20));
      await g2.up();
      await tester.pump(const Duration(milliseconds: 100));
      for (final id in before.keys) {
        expect(Offset(c.state[id]!.x, c.state[id]!.y) - before[id]!, const Offset(100, 50), reason: id);
      }
      expect(_mindOps(source).map((o) => o['do']), contains('layout'));
    },
  );

  testWidgets('Löschen nimmt Unterthemen mit, Duplikat eines Unterthemas wird eigene Wurzel und angeordnet', (
    tester,
  ) async {
    final (c, source, e, _) = await _pump(tester);
    e.select({'prog'});
    e.deleteSelection();
    await tester.pump();
    expect(_mindOps(source).last, {
      'op': 'mind',
      'do': 'remove',
      'ids': ['prog'],
    });
    expect(
      [
        for (final id in ['prog', 'bands', 'work']) c.state[id],
      ],
      [null, null, null],
    );
    expect(c.state['orga'], isNotNull);

    e.select({'strom'});
    e.duplicateSelection();
    await tester.pump();
    final msg = (source.sent.lastWhere((m) => m['t'] == 'ops')['ops'] as List).cast<Map<String, Object?>>();
    expect(msg.map((o) => o['op']), ['create', 'mind']);
    final copy = ((msg[0]['objects'] as List).single as Map).cast<String, Object?>();
    expect((copy['mind'] as Map).containsKey('parent'), isFalse, reason: 'ohne mitkopierten Elternknoten = Wurzel');
    expect(msg[1], {
      'op': 'mind',
      'do': 'layout',
      'ids': [copy['id']],
    });
    final shown = c.state[copy['id'] as String]!;
    expect(shown.mind.level, 0);
    expect(shown.h, mindSize('Strom', 0).h, reason: 'als Wurzel neu vermessen');
  });

  testWidgets('Mindmap-Werkzeug: leere Mindmap (schreiben) bzw. Vorlage (Baum) am getippten Punkt', (tester) async {
    final (c, source, e, _) = await _pump(tester, objects: const []);
    e.tool = BoardTool.mindmap;
    await _tap(tester, const Offset(300, 300));
    final root = _mindOps(source).last;
    expect(root['do'], 'root');
    expect(e.editingId, root['new']);
    expect(e.tool, BoardTool.select);
    e.stopEditing();
    await tester.pump();
    expect(c.state[root['new'] as String], isNull, reason: 'leer gelassen → weg');

    e
      ..mindTemplate = sampleMindmap
      ..tool = BoardTool.mindmap;
    await _tap(tester, const Offset(500, 350));
    final tree = _mindOps(source).last;
    expect(tree['do'], 'tree');
    expect((tree['tree'] as Map)['text'], 'Sommerfest');
    final id = tree['new'] as String;
    expect(
      [
        for (final o in c.state.objects.values)
          if (o.type == 'mindnode') o,
      ].length,
      16,
    );
    expect(c.state['$id-3']!.mind.side, 'r');
    expect(e.editingId, isNull);
  });

  testWidgets('Server ohne Mindmap-Op: die vorausberechneten Ops gehen als create/update', (tester) async {
    final (c, source, e, _) = await _pump(tester, mind: false);
    e.select({'orga'});
    final nid = e.mindChild('orga')!;
    await tester.pump();
    expect(_mindOps(source), isEmpty);
    final created = _ops(source).firstWhere((o) => o['op'] == 'create');
    expect(((created['objects'] as List).single as Map)['id'], nid);
    expect(c.state[nid]!.mind.parent, 'orga');
  });

  testWidgets(
    'Golden: Mindmap wie im Web, Wurzel ausgewählt (Plus beidseitig), eingeklappter Zweig mit Zahl',
    (tester) async {
      final objects = _map();
      final plan = MindPlanner.fromRaw(objects)..collapse('tech', true);
      final (_, _, e, _) = await _pump(tester, objects: plan.nodes, camera: const Camera(-60, 40, 1));
      e.select({'root'});
      for (var i = 0; i < 4; i++) {
        await tester.pump();
      }
      await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/mindmap.png'));
    },
    skip: !Platform.isWindows,
    tags: ['golden'],
  );
}
