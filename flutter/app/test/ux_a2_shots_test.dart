// UX-A2 (Welle UX+Q): Bildschirmfotos nachher in 390 × 844 (Pixeldichte 2) gegen die lokale Sandbox – die Vorher-Bilder
// sind die des UX-Reviews (docs/screenshots/ux-review/, Stand main cfa2012). Läuft nur mit STACHEL_SANDBOX und
// STACHEL_SHOTS (Aufbau wie test/ux_review_test.dart):
//
//   MSYS_NO_PATHCONV=1 server/node_modules/.bin/tsx tools/sandbox.mts 8862 --local --seed --info <sandbox.json>
//   dart run tool/ux_review_record.dart <sandbox.json> <rec>
//   flutter test test/ux_a2_shots_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8862
//     --dart-define=STACHEL_SHOTS=<ordner>
@Tags(['live'])
library;

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

const _w = 390.0, _h = 844.0, _dpr = 2.0, _top = 28.0, _bottom = 20.0;
final _shotKey = GlobalKey();
late WidgetTester _t;

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
  final root = Platform.environment['FLUTTER_ROOT'] ?? '';
  final icons = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  if (icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
  final roboto = Directory('$root/bin/cache/artifacts/material_fonts');
  if (roboto.existsSync()) {
    final l = FontLoader('Roboto');
    for (final f in roboto.listSync().whereType<File>().where((f) => f.path.contains('Roboto-'))) {
      l.addFont(Future.value(ByteData.sublistView(f.readAsBytesSync())));
    }
    await l.load();
  }
}

/// Handy-Rahmen mit Statusleiste (wie im UX-Review).
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
        ],
      ),
    ),
  );
}

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

Future<void> tapKey(String key, {int rounds = 4}) async {
  await _t.tap(find.byKey(Key(key)).first);
  await settle(rounds);
}

Future<void> step(String name, Future<void> Function() body) async {
  try {
    await body();
  } catch (e, st) {
    // ignore: avoid_print
    print('SCHRITT $name FEHLER: $e\n${st.toString().split('\n').take(8).join('\n')}');
  }
}

BoardViewState _view() => _t.state<BoardViewState>(find.byType(BoardView));

Offset _at(Offset world) {
  final box = _t.renderObject<RenderBox>(find.byType(BoardView));
  return box.localToGlobal(_view().camera.value.toScreen(world));
}

Iterable<BoardObject> _objs([String? type]) =>
    _view().editor.controller.state.ordered.where((o) => type == null || o.type == type);

Offset _center(BoardObject o) => _at(Offset(o.x + o.w / 2, o.y + o.h / 2));

Future<void> closeSheets() async {
  final nav = _t.state<NavigatorState>(find.byType(Navigator).first);
  nav.popUntil((r) => r.isFirst || r is PageRoute);
  await settle(4);
}

Future<void> openBoard(String title) async {
  _t.state<NavigatorState>(find.byType(Navigator).first).popUntil((r) => r.isFirst);
  await settle(4);
  for (var i = 0; i < 40 && find.byType(Scrollable).evaluate().isEmpty; i++) {
    await settle(2);
  }
  final list = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first;
  if (find.text(title).hitTestable().evaluate().isEmpty) {
    await _t.scrollUntilVisible(find.text(title), 200, scrollable: list);
  }
  await _t.tap(find.text(title).first);
  await settle(25);
}

Future<void> menu(String label) async {
  await tapKey('stachelBoardMenu');
  final sheet = find.descendant(of: find.byKey(const Key('stachelBoardMenuSheet')), matching: find.byType(Scrollable));
  final item = find.descendant(
    of: find.byKey(const Key('stachelBoardMenuSheet')),
    matching: find.byWidgetPredicate((w) => w is Text && (w.data ?? '').startsWith(label)),
  );
  await _t.scrollUntilVisible(item, 150, scrollable: sheet.first);
  await _t.tap(item.first);
  await settle(6);
}

/// Tippen mit [fingers] Fingern in der Mitte der Fläche.
Future<void> fingerTap(int fingers) async {
  final box = _t.renderObject<RenderBox>(find.byType(BoardView));
  final c = box.localToGlobal(box.size.center(Offset.zero));
  final gs = <TestGesture>[];
  for (var i = 0; i < fingers; i++) {
    gs.add(await _t.startGesture(c + Offset(50.0 * i - 25.0 * (fingers - 1), 0), pointer: 40 + i));
  }
  await _t.pump(const Duration(milliseconds: 60));
  for (final g in gs) {
    await g.up();
  }
  await _t.pump();
}

void main() {
  testWidgets('UX-A2: Bildschirmfotos nachher', (t) async {
    _t = t;
    HttpOverrides.global = null;
    GestureOnboarding.autoShow = true; // flutter_test_config schaltet sie sonst aus
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

    await step('login', () async {
      await t.enterText(find.byKey(const Key('loginEmail')), 'owner@sandbox.test');
      await t.enterText(find.byKey(const Key('loginPassword')), 'Stachel-Probe-2026');
      await tapKey('loginSubmit', rounds: 25);
    });

    // ---- P5: Einführung beim ersten Board ----
    await step('einfuehrung', () async {
      await openBoard('Brainstorming Sommerfest');
      for (var i = 0; i < 20 && find.byKey(const Key('stachelOnboarding')).evaluate().isEmpty; i++) {
        await settle(2);
      }
      const names = ['a2-01-einfuehrung-bewegen', 'a2-02-einfuehrung-greifen', 'a2-03-einfuehrung-auswaehlen'];
      for (final n in names) {
        await settle(12); // mitten in der kleinen Animation
        await shot(n);
        await tapKey('stachelOnboardingNext', rounds: 6);
      }
      await settle(12);
      await shot('a2-04-einfuehrung-rueckgaengig');
      await tapKey('stachelOnboardingNext', rounds: 6);
      await shot('a2-04b-nach-der-einfuehrung');
    });

    // ---- P13 im Gesten-Blatt, Einführung im Menü ----
    await step('gesten-blatt', () async {
      await tapKey('stachelBoardMenu');
      final menuSheet = find.descendant(
        of: find.byKey(const Key('stachelBoardMenuSheet')),
        matching: find.byType(Scrollable),
      );
      await t.scrollUntilVisible(find.byKey(const Key('stachelBoardGestures')), 150, scrollable: menuSheet.first);
      await shot('a2-05a-boardmenue-einfuehrung');
      await tapKey('stachelBoardGestures', rounds: 6);
      final sheet = find.descendant(of: find.byKey(const Key('stachelGesturesSheet')), matching: find.byType(Scrollable));
      await t.scrollUntilVisible(find.byKey(const Key('stachelGesturesOnboarding')), 150, scrollable: sheet.first);
      await settle(3);
      await shot('a2-05-gesten-blatt');
      await closeSheets();
    });

    // ---- P6: „Mehrere wählen“ ----
    await step('mehrere-waehlen', () async {
      final view = _t.getRect(find.byType(BoardView)).deflate(40);
      final notes = _objs('sticky').where((o) => view.contains(_center(o))).toList()
        ..sort((a, b) => _center(a).dy.compareTo(_center(b).dy));
      await t.tapAt(_center(notes[0]));
      await settle(4);
      await shot('a2-06-mehrere-waehlen-aus');
      await tapKey('stachelMultiSelect');
      await t.tapAt(_center(notes[1]));
      await settle(4);
      await t.tapAt(_center(notes[2]));
      await settle(4);
      await shot('a2-06b-mehrere-waehlen-an');
      final g = await t.startGesture(_center(notes[0]));
      for (var i = 0; i < 8; i++) {
        await g.moveBy(const Offset(6, 10));
        await t.pump(const Duration(milliseconds: 30));
      }
      await g.up();
      await settle(6);
      await shot('a2-06c-nach-verschieben-aus');
    });

    // ---- P13: zwei Finger = Rückgängig ----
    await step('rueckgaengig', () async {
      await fingerTap(2);
      await t.pump(const Duration(milliseconds: 500));
      await settle(6);
      await shot('a2-07-zwei-finger-rueckgaengig');
      await settle(30);
    });

    // ---- P3: Abstimmung im Festival in der Übersicht (vorher: 28c) ----
    await step('festival-abstimmung', () async {
      await openBoard('Sommerfest 2027 – Planung');
      await tapKey('stachelBoardFit');
      if (_view().editor.voteTapInterceptor == null) {
        await menu('Abstimmung starten');
        await tapKey('collabVoteStartGo', rounds: 10);
      }
      final s = _objs('shape').firstWhere((o) => o.displayText.startsWith('Bühne'));
      // ignore: avoid_print
      print('Zoom ${_view().camera.value.z.toStringAsFixed(3)}');
      await t.tapAt(_center(s));
      await settle(8);
      await shot('a2-08-abstimmung-gestimmt');
    });

    await t.pumpWidget(const SizedBox());
    await t.pump(const Duration(seconds: 30));
  }, skip: _sandbox.isEmpty || _shots.isEmpty);
}
