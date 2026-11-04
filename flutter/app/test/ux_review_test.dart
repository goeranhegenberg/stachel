// UX-Review 2026-11 (docs/ux_review_app_2026-11.md): Bildschirmfotos der Stachel-App in Handygröße (390 × 844,
// Pixeldichte 2) gegen die lokale Sandbox – echte Anmeldung, echte Board-Liste, echte Boards über die Native-API.
// Kein Test im eigentlichen Sinn: läuft nur mit STACHEL_SANDBOX und schreibt PNGs nach STACHEL_SHOTS.
//
//   npm --prefix server run build
//   MSYS_NO_PATHCONV=1 server/node_modules/.bin/tsx tools/sandbox.mts 8850 --local --seed
//   dart run tool/ux_review_record.dart <sandbox.json> <rec>   (Boards anlegen; Token „edit“ und Festival-ID daraus)
//   flutter test test/ux_review_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8850
//     --dart-define=STACHEL_SHOTS=<ordner> --dart-define=STACHEL_PEER_TOKEN=<sts_ von edit>
//     --dart-define=STACHEL_FESTIVAL=<id aus rec/ids.json>
@Tags(['live'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/app_session.dart';
import 'package:stachel/links.dart';
import 'package:stachel/root.dart';
import 'package:stachel/theme.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');
const _shots = String.fromEnvironment('STACHEL_SHOTS');
final _skip = _sandbox.isEmpty || _shots.isEmpty ? 'STACHEL_SANDBOX / STACHEL_SHOTS fehlen' : null;

const _w = 390.0, _h = 844.0, _dpr = 2.0, _top = 28.0, _bottom = 20.0, _kb = 300.0;
final _shotKey = GlobalKey();
final _kbOn = ValueNotifier(false);

Future<void> _fonts() async {
  Future<void> family(String name, String dir, List<String> files) async {
    final l = FontLoader(name);
    for (final f in files) {
      final file = File('$dir/$f');
      if (file.existsSync()) l.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await l.load();
  }

  await family('Barlow', 'assets/fonts', [
    'Barlow-Regular.ttf',
    'Barlow-Medium.ttf',
    'Barlow-SemiBold.ttf',
    'Barlow-Bold.ttf',
  ]);
  await family('BarlowCondensed', 'assets/fonts', [
    'BarlowCondensed-Medium.ttf',
    'BarlowCondensed-SemiBold.ttf',
    'BarlowCondensed-Bold.ttf',
    'BarlowCondensed-Black.ttf',
  ]);
  const pkg = '../packages/stachel_board/assets/fonts';
  await family(BoardFonts.serifFamily, pkg, [
    'SourceSerif4-Regular.ttf',
    'SourceSerif4-Italic.ttf',
    'SourceSerif4-SemiBold.ttf',
    'SourceSerif4-Bold.ttf',
  ]);
  await family(BoardFonts.monoFamily, pkg, ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Bold.ttf']);
  final root = Platform.environment['FLUTTER_ROOT'] ?? '';
  final icons = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  if (icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
  // Roboto für alles ohne eigene Schrift (Systemtexte), sonst Kästchen
  final roboto = Directory('$root/bin/cache/artifacts/material_fonts');
  if (roboto.existsSync()) {
    final l = FontLoader('Roboto');
    for (final f in roboto.listSync().whereType<File>().where((f) => f.path.contains('Roboto-'))) {
      l.addFont(Future.value(ByteData.sublistView(f.readAsBytesSync())));
    }
    await l.load();
  }
}

/// Handy-Rahmen: Statusleiste oben, auf Wunsch eine (graue) Bildschirmtastatur unten.
class _Phone extends StatelessWidget {
  const _Phone({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    key: _shotKey,
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Stack(
        children: [
          Positioned.fill(child: child),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: _top,
            child: IgnorePointer(
              child: Container(
                color: const Color(0x22000000),
                padding: const EdgeInsets.symmetric(horizontal: 18),
                alignment: Alignment.centerLeft,
                child: const Row(
                  children: [
                    Text(
                      '21:08',
                      style: TextStyle(fontFamily: 'Barlow', fontSize: 13, color: Color(0xFF222222)),
                    ),
                    Spacer(),
                    Icon(Icons.wifi, size: 14, color: Color(0xFF222222)),
                    SizedBox(width: 4),
                    Icon(Icons.battery_5_bar, size: 14, color: Color(0xFF222222)),
                    Text(
                      ' 87 %',
                      style: TextStyle(fontFamily: 'Barlow', fontSize: 13, color: Color(0xFF222222)),
                    ),
                  ],
                ),
              ),
            ),
          ),
          ValueListenableBuilder(
            valueListenable: _kbOn,
            builder: (_, on, _) => !on
                ? const SizedBox.shrink()
                : Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: _kb,
                    child: const IgnorePointer(child: _Keyboard()),
                  ),
          ),
        ],
      ),
    ),
  );
}

class _Keyboard extends StatelessWidget {
  const _Keyboard();

  @override
  Widget build(BuildContext context) {
    Widget row(String keys) => Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (final k in keys.split(''))
          Container(
            width: 30,
            height: 44,
            margin: const EdgeInsets.all(2),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: const Color(0xFFFFFFFF), borderRadius: BorderRadius.circular(5)),
            child: Text(
              k,
              style: const TextStyle(fontFamily: 'Barlow', fontSize: 18, color: Color(0xFF222222)),
            ),
          ),
      ],
    );
    return Container(
      color: const Color(0xFFD5D8DD),
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        children: [
          row('qwertzuiopü'),
          row('asdfghjklö'),
          row('yxcvbnm'),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 230,
                height: 44,
                margin: const EdgeInsets.all(3),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(5)),
              ),
              Container(
                width: 70,
                height: 44,
                margin: const EdgeInsets.all(3),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: const Color(0xFF1A73E8), borderRadius: BorderRadius.circular(5)),
                child: const Icon(Icons.keyboard_return, color: Colors.white, size: 20),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

late WidgetTester _t;

/// Echte Netz-Ereignisse abarbeiten und Bilder nachziehen ([rounds] × ~120 ms).
Future<void> settle([int rounds = 6]) async {
  for (var i = 0; i < rounds; i++) {
    await _t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
    await _t.pump(const Duration(milliseconds: 60));
  }
}

Future<void> shot(String name) async {
  await settle(2);
  final ro = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await _t.runAsync(() async {
    final img = await ro.toImage(pixelRatio: _dpr);
    final png = await img.toByteData(format: ui.ImageByteFormat.png);
    File('$_shots/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
  });
  // ignore: avoid_print
  print('Bild $name');
}

Future<void> keyboard(bool on) async {
  _kbOn.value = on;
  _t.view.viewInsets = FakeViewPadding(bottom: on ? _kb * _dpr : 0);
  await settle(3);
}

Future<void> tapKey(String key, {int rounds = 4}) async {
  await _t.tap(find.byKey(Key(key)).first);
  await settle(rounds);
}

Future<void> tapText(String text, {int rounds = 4}) async {
  await _t.tap(find.text(text).first);
  await settle(rounds);
}

Future<void> back() async {
  final nav = _t.state<NavigatorState>(find.byType(Navigator).first);
  if (nav.canPop()) nav.pop();
  await settle(6);
}

void main() {
  testWidgets('UX-Review: Bildschirmfotos aller Hauptabläufe', (t) async {
    _t = t;
    HttpOverrides.global = null; // echtes Netz zur Sandbox
    await _fonts();
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
    Sk.style = StachelTheme.style;
    t.view.physicalSize = const Size(_w * _dpr, _h * _dpr);
    t.view.devicePixelRatio = _dpr;
    t.view.padding = const FakeViewPadding(top: _top * _dpr, bottom: _bottom * _dpr);
    t.view.viewPadding = const FakeViewPadding(top: _top * _dpr, bottom: _bottom * _dpr);
    addTearDown(t.view.reset);
    t.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async => null);

    final session = AppSession(client: http.Client());
    await t.pumpWidget(
      _Phone(
        child: StachelApp(
          session: session,
          links: StachelAppLinks(_sandbox),
          accountsBase: _sandbox,
          checkInbox: false,
          launcher: (u) async => true,
          boardScreen: (id, title, object) => StachelBoardScreen(
            client: StachelAppClient(session, session.account!),
            boardId: id,
            title: title,
            objectId: object,
            images: NoBoardImages(),
            cache: MemoryBoardCache(),
            uploads: MemoryStachelUploads(),
            pendingStore: MemoryPendingStore(),
          ),
        ),
      ),
    );
    await settle(10);
    await flows(t, session);
    await t.pumpWidget(const SizedBox());
    await t.pump(const Duration(seconds: 30));
  }, skip: _skip != null);
}

// ---- Abläufe --------------------------------------------------------------------------------------------------------

BoardViewState _view() => _t.state<BoardViewState>(find.byType(BoardView));

/// Bildschirmpunkt des Board-Punkts [world].
Offset _at(Offset world) {
  final box = _t.renderObject<RenderBox>(find.byType(BoardView));
  return box.localToGlobal(_view().camera.value.toScreen(world));
}

Iterable<BoardObject> _objs([String? type]) =>
    _view().editor.controller.state.ordered.where((o) => type == null || o.type == type);

Offset _center(BoardObject o) => _at(Offset(o.x + o.w / 2, o.y + o.h / 2));

Future<void> step(String name, Future<void> Function() body) async {
  try {
    await body();
  } catch (e, st) {
    // ignore: avoid_print
    print('SCHRITT $name FEHLER: $e\n${st.toString().split('\n').take(8).join('\n')}');
  }
}

/// Blätter und Dialoge über der Seite schließen ([depth] 0 = Board-Liste, 1 = Board).
Future<void> closeSheets(int depth) async {
  final nav = _t.state<NavigatorState>(find.byType(Navigator).first);
  nav.popUntil((r) => r.isFirst || (r is PageRoute && depth == 1));
  await settle(4);
}

Future<void> openBoard(String title) async {
  _t.state<NavigatorState>(find.byType(Navigator).first).popUntil((r) => r.isFirst);
  await settle(4);
  for (var i = 0; i < 40 && find.byType(Scrollable).evaluate().isEmpty; i++) {
    await settle(2);
  }
  final list = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first;
  for (var i = 0; i < 5; i++) {
    await _t.drag(list, const Offset(0, 1500));
    await settle(2);
  }
  if (find.text(title).hitTestable().evaluate().isEmpty) {
    await _t.scrollUntilVisible(find.text(title), 200, scrollable: list);
  }
  await _t.tap(find.text(title).first);
  await settle(25);
}

Future<void> leaveBoard() async {
  _kbOn.value = false;
  _t.view.viewInsets = FakeViewPadding.zero;
  final nav = _t.state<NavigatorState>(find.byType(Navigator).first);
  nav.popUntil((r) => r.isFirst);
  await settle(6);
}

/// Board-Menü öffnen, bis zum Eintrag [label] (Anfang) scrollen und ihn wählen.
Future<void> menu(String label) async {
  await tapKey('stachelBoardMenu');
  final sheet = find.descendant(of: find.byKey(const Key('stachelBoardMenuSheet')), matching: find.byType(Scrollable));
  final item = find.descendant(
    of: find.byKey(const Key('stachelBoardMenuSheet')),
    // rows by their text; the tiles of the quick row (UX P7) by their tooltip (full label)
    matching: find.byWidgetPredicate(
      (w) => (w is Text && (w.data ?? '').startsWith(label)) || (w is Tooltip && (w.message ?? '').startsWith(label)),
    ),
  );
  await _t.scrollUntilVisible(item.first, 150, scrollable: sheet.first);
  await _t.tap(item.first);
  await settle(6);
}

const _peerToken = String.fromEnvironment('STACHEL_PEER_TOKEN');
WebSocket? _peer;

/// Eine zweite Person (Konto „edit“) kommt aufs Board [boardId]: Cursor und Auswahl als Anwesenheit.
Future<void> peerJoin(String boardId, {required Offset cursor, List<String> selection = const []}) async {
  if (_peerToken.isEmpty) return;
  await _t.runAsync(() async {
    final ws = await WebSocket.connect(
      '${_sandbox.replaceFirst('http', 'ws')}/native/v1',
      headers: {'Authorization': 'Bearer $_peerToken'},
    );
    ws.listen((_) {}, onError: (_) {});
    ws.add(jsonEncode(helloMessage(board: boardId, app: '1.1.0+3', client: 'stachel')));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    ws.add(
      jsonEncode(
        presenceMessage(
          cursorX: cursor.dx,
          cursorY: cursor.dy,
          selection: selection,
          viewport: (x: cursor.dx - 400, y: cursor.dy - 300, w: 800, h: 600),
        ),
      ),
    );
    _peer = ws;
  });
  await settle(8);
}

Future<void> peerLeave() async {
  final ws = _peer;
  _peer = null;
  if (ws != null) await _t.runAsync(() => ws.close());
}

/// „Alles einpassen“ (UX-A1: nicht mehr in der App-Leiste; am Handy über den Zoom-Hinweis oder das Flächen-Menü).
Future<void> fitAll() async {
  _view().fitAll();
  await settle(4);
}

Future<void> longPressAt(Offset p) async {
  final g = await _t.startGesture(p);
  await _t.pump(const Duration(milliseconds: 650));
  await g.up();
  await settle(4);
}

Future<void> flows(WidgetTester t, AppSession session) async {
  await shot('01-anmelden');
  await step('registrieren', () async {
    await tapKey('loginRegister');
    await shot('02-registrieren');
    await back();
  });
  await step('organisation', () async {
    await tapKey('loginOrg');
    await shot('02b-mit-organisation');

    await back();
  });
  await step('login', () async {
    await t.tap(find.byKey(const Key('loginEmail')));
    await keyboard(true);
    await t.enterText(find.byKey(const Key('loginEmail')), 'owner@sandbox.test');
    await shot('01b-anmelden-tastatur');
    await keyboard(false);
    await t.enterText(find.byKey(const Key('loginPassword')), 'Stachel-Probe-2026');
    await tapKey('loginSubmit', rounds: 25);
    await shot('03-board-liste');
  });
  await step('liste-menue', () async {
    await t.tap(find.byIcon(Icons.more_vert).first);
    await settle(4);
    await shot('03b-board-menue-liste');
    await closeSheets(0);
  });
  await step('liste-suche', () async {
    await t.tap(find.byKey(const Key('stachelSearch')));
    await keyboard(true);
    await t.enterText(find.byKey(const Key('stachelSearch')), 'fest');
    await settle(4);
    await shot('03c-suche');
    await t.enterText(find.byKey(const Key('stachelSearch')), '');
    await keyboard(false);
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(3);
  });
  await step('liste-unten', () async {
    await t.drag(find.byType(Scrollable).first, const Offset(0, -2000));
    await settle(4);
    await shot('03d-liste-unten');
    await t.drag(find.byType(Scrollable).first, const Offset(0, 3000));
    await settle(4);
  });
  await step('neues-board', () async {
    await tapKey('stachelNewBoard');
    await shot('03e-neues-board');
    await closeSheets(0);
  });
  await step('konto', () async {
    await tapKey('stachelAccount');
    await shot('04-konto');
    await t.drag(find.byType(Scrollable).last, const Offset(0, -1500));
    await settle(3);
    await shot('04b-konto-unten');
    await back();
  });

  // ---- leeres Board: Werkzeuge, Haftnotiz anlegen, schreiben, Kontextleiste ----
  await step('leeres-board', () async {
    await openBoard('Neues Board');
    await shot('05-leeres-board');
  });
  await step('werkzeuge-mehr', () async {
    await tapKey('stachelToolMore');
    await shot('05b-weitere-werkzeuge');
    await closeSheets(1);
  });
  await step('haftnotiz', () async {
    await tapKey('stachelToolSticky');
    await shot('06-werkzeug-haftnotiz');
    final box = t.renderObject<RenderBox>(find.byType(BoardView));
    await t.tapAt(box.localToGlobal(box.size.center(const Offset(-60, -120))));
    await settle(6);
    await keyboard(true);
    await shot('06b-haftnotiz-schreiben');
    await t.enterText(find.byKey(const Key('boardTextField')), 'Bühne aufbauen\nFreitag 14 Uhr');
    await settle(4);
    await shot('06c-haftnotiz-text');
  });
  await step('fertig', () async {
    await tapKey('stachelEditDone');
    await keyboard(false);
    await shot('07-auswahl-kontextleiste');
  });
  await step('ctx-mehr', () async {
    await tapKey('stachelCtxMore');
    await shot('07b-weitere-aktionen');
    await t.drag(find.byKey(const Key('stachelCtxMoreSheet')), const Offset(0, -900));
    await settle(3);
    await shot('07c-weitere-aktionen-unten');
    await closeSheets(1);
  });
  await step('objektmenue', () async {
    final s = _objs('sticky').first;
    await longPressAt(_center(s));
    await shot('08-objektmenue-langdruck');
    await closeSheets(1);
  });
  await step('plus-griffe', () async {
    final s = _objs('sticky').first;
    _view().editor.select({s.id});
    await settle(3);
    await shot('09-plus-griffe');
    await t.tapAt(_at(Offset(s.x + s.w + 22, s.y + s.h / 2)));
    await settle(6);
    await keyboard(true);
    await shot('09b-plus-neue-notiz');
    await t.enterText(find.byKey(const Key('boardTextField')), 'Technik prüfen');
    await tapKey('stachelEditDone');
    await keyboard(false);
    await shot('09c-verbunden');
  });
  await step('leeres-langdruck', () async {
    _view().editor.select(const {});
    await settle(2);
    final box = t.renderObject<RenderBox>(find.byType(BoardView));
    await longPressAt(box.localToGlobal(Offset(60, box.size.height - 90)));
    await shot('10-flaechenmenue-langdruck');
    await closeSheets(1);
  });
  await step('boardmenue', () async {
    await tapKey('stachelBoardMenu');
    await shot('11-boardmenue');
    await t.drag(find.byKey(const Key('stachelBoardMenuSheet')), const Offset(0, -700));
    await settle(3);
    await shot('11b-boardmenue-mitte');
    await t.drag(find.byKey(const Key('stachelBoardMenuSheet')), const Offset(0, -1500));
    await settle(3);
    await shot('11c-boardmenue-unten');
    await closeSheets(1);
  });
  await step('form', () async {
    await tapKey('stachelToolShape');
    await shot('12-werkzeug-form');
    await closeSheets(1);
  });
  await step('verbinder-werkzeug', () async {
    await tapKey('stachelToolSelect');
    await tapKey('stachelToolConnector');
    await shot('13-werkzeug-verbinder');
    final a = _objs('sticky').first, b = _objs('sticky').last;
    // dritte Notiz per Doppeltippen, dann Linie von der ersten zur dritten ziehen
    final box = _t.renderObject<RenderBox>(find.byType(BoardView));
    final p = box.localToGlobal(Offset(box.size.width / 2, box.size.height - 160));
    await tapKey('stachelToolSelect');
    await _t.tapAt(p);
    await _t.pump(const Duration(milliseconds: 80));
    await _t.tapAt(p);
    await settle(6);
    await keyboard(true);
    await shot('13b-doppeltippen-notiz');
    await _t.enterText(find.byKey(const Key('boardTextField')), 'Strom');
    await tapKey('stachelEditDone');
    await keyboard(false);
    final c = _objs('sticky').last;
    await tapKey('stachelToolConnector');
    final g = await _t.startGesture(_center(a));
    for (var i = 1; i <= 12; i++) {
      await g.moveTo(Offset.lerp(_center(a), _center(c), i / 12)!);
      await _t.pump(const Duration(milliseconds: 30));
    }
    await shot('13c-linie-ziehen');
    await g.up();
    await settle(6);
    await shot('13d-linie-fertig');
    if (b.id == c.id) return;
  });
  await leaveBoard();

  // ---- reiches Board: Festival ----
  await step('festival', () async {
    await openBoard('Sommerfest 2027 – Planung');
    await shot('20-festival-start');
  });
  await step('festival-erwaehnung', () async {
    await t.tap(find.byKey(const Key('stachelMentioned')));
    await settle(8);
    await shot('22-kommentar-faden');
    await closeSheets(1);
  });
  await step('festival-auswahl', () async {
    final s = _objs('shape').firstWhere((o) => o.displayText.startsWith('Bühne'));
    await t.tapAt(_center(s));
    await settle(4);
    await shot('21-festival-form-gewaehlt');
    await t.tapAt(_center(s));
    await settle(6);
    await keyboard(true);
    await shot('21b-festival-form-schreiben');
    await keyboard(false);
    _view().finishEditing();
    _view().editor.select(const {});
    await settle(4);
  });
  await step('festival-alles', () async {
    await fitAll();
    await shot('20b-festival-alles');
  });
  // UX-A3: Board-Menü mit Kommentar-Zähler in der Schnellzeile, Kontextleiste einer Form samt „Mehr“
  await step('festival-boardmenue', () async {
    await tapKey('stachelBoardMenu');
    await shot('11d-boardmenue-festival');
    await closeSheets(1);
  });
  await step('festival-form-mehr', () async {
    final s = _objs('shape').firstWhere((o) => o.displayText.startsWith('Bühne'));
    _view().editor.select({s.id});
    await settle(4);
    await tapKey('stachelCtxMore');
    await shot('21c-festival-form-mehr');
    await closeSheets(1);
    _view().editor.select(const {});
    await settle(3);
  });
  await step('festival-quer', () async {
    t.view.physicalSize = const Size(_h * _dpr, _w * _dpr);
    await settle(6);
    await shot('40-quer-board');
    t.view.physicalSize = const Size(_w * _dpr, _h * _dpr);
    await settle(6);
  });
  await step('festival-teilen', () async {
    await menu('Teilen');
    await settle(6);
    await shot('23-teilen');
    await t.drag(find.byType(Scrollable).last, const Offset(0, -800));
    await settle(3);
    await shot('23b-teilen-unten');
    await closeSheets(1);
  });
  await step('festival-suche', () async {
    await menu('Auf dem Board suchen');
    await keyboard(true);
    await t.enterText(find.byKey(const Key('stachelSearchField')), 'Bühne');
    await settle(4);
    await shot('24-suche-board');
    await keyboard(false);
    await tapKey('stachelSearchClose');
  });
  await step('festival-export', () async {
    await menu('Exportieren');
    await shot('25-export');
    await closeSheets(1);
  });
  await step('festival-timer', () async {
    await menu('Timer einstellen');
    await shot('26-timer-einstellen');
    await closeSheets(1);
    await menu('Timer für alle');
    await settle(6);
    await shot('26b-timer-laeuft');
  });
  await step('festival-abstimmung', () async {
    await menu('Abstimmung starten');
    await shot('28-abstimmung-start');
    await tapKey('collabVoteStartGo', rounds: 10);
    await shot('28b-abstimmung-laeuft');
    final s = _objs('shape').firstWhere((o) => o.displayText.startsWith('Bühne'));
    await t.tapAt(_center(s));
    await settle(8);
    await shot('28c-abstimmung-gestimmt');
    // UX-A1 (P2): Suche über laufender Abstimmung und Timer – alles stapelt sich oben
    await menu('Auf dem Board suchen');
    await t.enterText(find.byKey(const Key('stachelSearchField')), 'Bühne');
    await settle(4);
    _view().editor.select(const {});
    await settle(4);
    await shot('29-suche-ueber-abstimmung');
    await tapKey('stachelSearchClose');
  });
  await step('festival-anwesende', () async {
    final o = _objs('frame').first;
    final id = const String.fromEnvironment('STACHEL_FESTIVAL');
    await peerJoin(id, cursor: Offset(o.x + o.w / 2, o.y + o.h / 2), selection: [_objs('shape').last.id]);
    await shot('27-anwesend-zweite-person');
    await tapKey('collabAvatarMe');
    await shot('27b-anwesende-liste');
    await closeSheets(1);
    await peerLeave();
  });
  await leaveBoard();

  await step('tablet-liste', () async {
    t.view.physicalSize = const Size(800 * _dpr, 1280 * _dpr);
    await settle(6);
    await shot('41-tablet-liste');
    t.view.physicalSize = const Size(_w * _dpr, _h * _dpr);
    await settle(6);
  });

  await step('mindmap', () async {
    await openBoard('Ideen Mindmap');
    await fitAll();
    await shot('30-mindmap');
    final n = _objs().firstWhere((o) => o.type.contains('mind'), orElse: () => _objs().first);
    await t.tapAt(_center(n));
    await settle(4);
    await shot('30b-mindmap-knoten');
    await t.tapAt(_center(n));
    await t.pump(const Duration(milliseconds: 80));
    await t.tapAt(_center(n));
    await settle(6);
    await keyboard(true);
    await shot('30c-mindmap-schreiben');
    await keyboard(false);
    _view().finishEditing();
    await settle(4);
  });
  await leaveBoard();
  await step('kanban', () async {
    await openBoard('Aufgaben Aufbau');
    await fitAll();
    await shot('31-kanban');
  });
  await leaveBoard();

  // ---- UX-A1 (P14): Dunkelmodus folgt dem System – Oberfläche dunkel, Board-Fläche hell ----
  t.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
  addTearDown(t.platformDispatcher.clearPlatformBrightnessTestValue);
  await settle(6);
  await step('dunkel-liste', () async {
    await shot('50-dunkel-liste');
    await tapKey('stachelAccount');
    await shot('51-dunkel-konto');
    await back();
  });
  await step('dunkel-board', () async {
    await openBoard('Sommerfest 2027 – Planung');
    await shot('52-dunkel-board');
    await tapKey('stachelBoardMenu');
    await shot('55-dunkel-boardmenue');
    await closeSheets(1);
    await tapKey('stachelToolMore');
    await shot('56-dunkel-werkzeuge');
    await closeSheets(1);
  });
  await step('dunkel-auswahl', () async {
    // auf dem Festival-Board läuft die Abstimmung (Tippen = Stimme): Auswahl und Schreiben auf dem eigenen Board
    await openBoard('Neues Board');
    final s = _objs('sticky').first;
    await t.tapAt(_center(s));
    await settle(4);
    await shot('53-dunkel-auswahl');
    await t.tapAt(_center(s));
    await settle(6);
    await keyboard(true);
    await shot('54-dunkel-schreiben');
    await keyboard(false);
    _view().finishEditing();
    await settle(4);
  });
  await leaveBoard();
}
