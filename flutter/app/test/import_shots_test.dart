// „Board importieren“ (docs/features/import.md): Bildschirmfotos der Schritte im Theme der Stachel-App – Handy
// 390 × 844 hell und dunkel, Fenster 1280 × 800 (Dialog) – gegen einen Attrappen-Server über MockClient. Läuft nur mit
// STACHEL_SHOTS (Ordner für die PNGs):
//
//   flutter test test/import_shots_test.dart --dart-define=STACHEL_SHOTS=<ordner>
@Tags(['shots'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/theme.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _shots = String.fromEnvironment('STACHEL_SHOTS');
final _skip = _shots.isEmpty ? 'STACHEL_SHOTS fehlt' : null;

Future<void> _fonts() async {
  Future<void> family(String name, List<String> files) async {
    final l = FontLoader(name);
    for (final f in files) {
      final file = File('assets/fonts/$f');
      if (file.existsSync()) l.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await l.load();
  }

  await family('Barlow', ['Barlow-Regular.ttf', 'Barlow-Medium.ttf', 'Barlow-SemiBold.ttf', 'Barlow-Bold.ttf']);
  await family('BarlowCondensed', [
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
}

http.Response _json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

const _report = {
  'imported': {'sticky': 128, 'shape': 34, 'text': 21, 'connector': 40, 'frame': 6, 'image': 9},
  'adjusted': [
    {'code': 'sticky_color', 'text': 'Notizfarbe auf die nächste Palettenfarbe gesetzt', 'count': 37},
    {'code': 'shape_simplified', 'text': 'Form vereinfacht (Wolke → Ellipse)', 'count': 2},
  ],
  'skipped': [
    {'code': 'image_quota', 'text': 'Bild über deiner Speichergrenze', 'count': 1},
  ],
  'notes': [
    'Tabellen, Kommentare, Freihand-Zeichnungen, Kanban und Zeitleisten kann Miro über seine Schnittstelle nicht '
        'herausgeben.',
  ],
};

/// Attrappe: Import-Routen mit festen Ständen; [jobState] bestimmt, was GET /api/import/jobs/:id liefert.
class _Fake {
  bool oauth = true, connected = false;
  String jobState = 'running';
  String? tokenError;

  final boards = [
    for (final (i, n) in const [
      'Workshop Q4 – Ideen',
      'Retro Oktober',
      'Festivalplanung 2027',
      'User Journey App',
      'Roadmap Team Nord',
      'Brainstorming Logo',
      'Kundeninterviews',
      'Sprint 42',
      'Onboarding neue Kolleg:innen',
      'Architektur-Skizzen',
      'OKR 2027',
      'Moodboard Messe',
    ].indexed)
      {
        'id': 'm$i',
        'name': n,
        'modifiedAt': DateTime.now().subtract(Duration(hours: 3 + i * 17)).toUtc().toIso8601String(),
      },
  ];

  Map<String, Object?> job(String id, String name) => switch (jobState) {
    'done' => {
      'id': id,
      'sourceName': name,
      'status': 'done',
      'phase': 'done',
      'done': 1,
      'total': 1,
      'boardId': 'b-$id',
      'report': _report,
      'createdAt': DateTime.now().subtract(const Duration(minutes: 2)).toUtc().toIso8601String(),
      'finishedAt': DateTime.now().toUtc().toIso8601String(),
    },
    _ => {
      'id': id,
      'sourceName': name,
      'status': 'running',
      'phase': id == 'j1' ? 'images' : 'read',
      'done': id == 'j1' ? 31 : 7,
      'total': id == 'j1' ? 48 : 12,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    },
  };

  List<Map<String, Object?>> recent = [];

  late final http.Client client = MockClient((req) async {
    final p = req.url.path;
    if (p == '/api/import/sources') {
      return _json({
        'ok': true,
        'miro': {'enabled': true, 'token': true, 'oauth': oauth, 'connected': connected},
      });
    }
    if (p == '/api/import/jobs') return _json({'ok': true, 'jobs': recent});
    if (p == '/api/import/miro/token') {
      final e = tokenError;
      if (e != null) return _json({'ok': false, 'error': 'miro_token_invalid', 'message': e}, 400);
      return _json({'ok': true, 'conn': 'c1', 'expiresAt': '2026-11-04T10:00:00Z'});
    }
    if (p == '/api/import/miro/oauth/start') return _json({'ok': true, 'url': 'https://miro.com/oauth/authorize?x=1'});
    if (p == '/api/import/miro/boards') return _json({'ok': true, 'boards': boards, 'next': 50});
    if (p == '/api/import/miro/jobs') {
      final ids = ((jsonDecode(req.body) as Map)['boards'] as List).cast<String>();
      return _json({
        'ok': true,
        'jobs': [
          for (final (i, id) in ids.indexed)
            job('j${i + 1}', boards.firstWhere((b) => b['id'] == id)['name'] as String),
        ],
      }, 202);
    }
    final m = RegExp(r'^/api/import/jobs/(.+)$').firstMatch(p);
    if (m != null) {
      return _json({'ok': true, 'job': job(m.group(1)!, m.group(1) == 'j1' ? 'Workshop Q4 – Ideen' : 'Retro Oktober')});
    }
    return _json({'ok': true, 'boards': []});
  });
}

class _Client extends StachelClient {
  _Client(this.httpClient);
  @override
  final http.Client httpClient;
  @override
  String get base => 'https://stachel.test';
  @override
  String get appName => 'Stachel-App';
  @override
  String? get loginKey => 'flo@test.de';
  @override
  Future<String> newSession(String base) async => 'sts_test';
  @override
  void loginLost(BuildContext context, {String? message}) {}
  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {}
  @override
  BoardRegistry get registry => stachelBoardRegistry;
}

final _shotKey = GlobalKey();
late WidgetTester _t;

Future<void> _settle([int rounds = 8]) async {
  for (var i = 0; i < rounds; i++) {
    await _t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await _t.pump(const Duration(milliseconds: 60));
  }
}

Future<void> _shot(String name, double dpr) async {
  await _settle(3);
  final ro = _shotKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await _t.runAsync(() async {
    final img = await ro.toImage(pixelRatio: dpr);
    final png = await img.toByteData(format: ui.ImageByteFormat.png);
    Directory(_shots).createSync(recursive: true);
    File('$_shots/$name.png').writeAsBytesSync(png!.buffer.asUint8List());
  });
  // ignore: avoid_print
  print('Bild $name');
}

Future<void> _tap(String key) async {
  final f = find.byKey(Key(key));
  if (f.evaluate().isEmpty) {
    final list = find.descendant(of: find.byKey(const Key('stachelImportScreen')), matching: find.byType(Scrollable));
    await _t.scrollUntilVisible(f, 200, scrollable: list.first);
  }
  if (f.hitTestable().evaluate().isEmpty) await _t.ensureVisible(f);
  await _t.pump();
  await _t.tap(f.first);
  await _settle();
}

/// Ein Durchgang: Handy (390 × 844, Dichte 2) oder Fenster (1280 × 800, Dichte 1), hell oder dunkel.
Future<void> _run(WidgetTester t, {required String prefix, required bool dark, required bool wide}) async {
  _t = t;
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  BoardDesktop.enabled = wide;
  addTearDown(BoardDesktop.resetForTest);
  final size = wide ? const Size(1280, 800) : const Size(390, 844);
  final dpr = wide ? 1.0 : 2.0;
  t.view.physicalSize = size * dpr;
  t.view.devicePixelRatio = dpr;
  addTearDown(t.view.reset);
  Sk.style = StachelTheme.style;
  Sk.darkStyle = StachelTheme.darkStyle;
  Sk.brightness = dark ? Brightness.dark : Brightness.light;
  addTearDown(() {
    Sk.darkStyle = null;
    Sk.brightness = Brightness.light;
  });
  final fake = _Fake();
  fake.recent = [
    {
      'id': 'r1',
      'sourceName': 'Retro Oktober',
      'status': 'done',
      'phase': 'done',
      'boardId': 'b-r1',
      'report': _report,
      'createdAt': DateTime.now().subtract(const Duration(days: 1)).toUtc().toIso8601String(),
      'finishedAt': DateTime.now().subtract(const Duration(days: 1)).toUtc().toIso8601String(),
    },
    {
      'id': 'r2',
      'sourceName': 'Alte Planung',
      'status': 'failed',
      'phase': 'read',
      'error': 'Die Verbindung zu Miro ist abgelaufen. Bitte verbinde Stachel noch einmal mit Miro.',
      'createdAt': DateTime.now().subtract(const Duration(days: 2)).toUtc().toIso8601String(),
    },
  ];
  final api = StachelImportApi(HttpStachelBoardsApi(_Client(fake.client), release: false));
  await t.pumpWidget(
    RepaintBoundary(
      key: _shotKey,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: StachelTheme.theme(),
        darkTheme: StachelTheme.darkTheme(),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        home: Builder(
          builder: (ctx) => Scaffold(
            appBar: skAppBar('Stachel'),
            body: Center(
              child: FilledButton(
                key: const Key('go'),
                onPressed: () => showStachelNewBoardSheet(
                  ctx,
                  templates: const [],
                  thumbnail: (_) => null,
                  onCreate: (_, _) async {},
                  onImport: () => showStachelImport(ctx, api: api, launcher: (_) async => true),
                ),
                child: const Text('NEUES BOARD'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await _settle();
  await _tap('go');
  await _settle();
  if (!dark && !wide) await _shot('${prefix}00_neues_board_blatt', dpr);
  await _tap('stachelImportBoard');
  await _settle(10);
  await _shot('${prefix}01_quelle_letzte_importe', dpr);

  // Verbinden: Token falsch, Anleitung offen
  await _tap('stachelImportSourceMiro');
  await _shot('${prefix}02_verbinden', dpr);
  if (!dark) {
    fake.tokenError =
        'Miro hat das Token abgelehnt. Prüfe, ob du es vollständig kopiert hast, oder hol dir in Miro '
        'unter „Your apps“ ein neues.';
    await t.enterText(find.byKey(const Key('stachelImportToken')), 'falsches-token');
    await _tap('stachelImportTokenConnect');
    await _tap('stachelImportTokenHelp');
    await _shot('${prefix}03_token_fehler_anleitung', dpr);
    fake.tokenError = null;
    // Mit Miro verbinden: Warten
    final list = find.descendant(of: find.byKey(const Key('stachelImportScreen')), matching: find.byType(Scrollable));
    await t.scrollUntilVisible(find.byKey(const Key('stachelImportOauth')), -200, scrollable: list.first);
    await _tap('stachelImportOauth');
    await _shot('${prefix}04_oauth_warten', dpr);
    await _tap('stachelImportOauthCancel');
  }
  // Boards wählen
  await t.enterText(find.byKey(const Key('stachelImportToken')), 'tok');
  await _tap('stachelImportTokenConnect');
  await _tap('stachelImportBoard-m0');
  await _tap('stachelImportBoard-m1');
  await _shot('${prefix}05_boards_waehlen', dpr);
  // Fortschritt
  await _tap('stachelImportStart');
  await _shot('${prefix}06_fortschritt', dpr);
  // fertig mit Bericht
  fake.jobState = 'done';
  await t.pump(stachelImportPoll);
  await _settle(10);
  await _tap('stachelImportReport-j1');
  await _shot('${prefix}07_bericht', dpr);
  await t.pumpWidget(const SizedBox());
}

void main() {
  setUpAll(_fonts);
  testWidgets('Handy hell', (t) => _run(t, prefix: 'handy_hell_', dark: false, wide: false), skip: _skip != null);
  testWidgets('Handy dunkel', (t) => _run(t, prefix: 'handy_dunkel_', dark: true, wide: false), skip: _skip != null);
  testWidgets('Fenster hell', (t) => _run(t, prefix: 'fenster_hell_', dark: false, wide: true), skip: _skip != null);
}
