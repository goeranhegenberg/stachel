import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';

// Import aus anderen Whiteboards (docs/features/import.md, Typen `shared/import.ts`): was die Instanz anbietet,
// Verbinden mit Miro (Token oder OAuth), Board-Liste der Quelle, Aufträge (Jobs) mit Fortschritt und Bericht.
// Die Bildschirme stehen in `stachel_import_screen.dart`.

/// Höchstens so viele Boards je Auftrag (`IMPORT_MAX_BOARDS_PER_REQUEST`).
const stachelImportMaxBoards = 10;

/// Abfrage-Abstand für den Fortschritt (`IMPORT_POLL_MS`, Web und App).
const stachelImportPoll = Duration(milliseconds: 1500);

/// Verbindung „gespeicherte OAuth-Verbindung der Person“ (`ImportConn`).
const stachelImportOauthConn = 'oauth';

/// Wo Miro die eigenen Apps (und damit das Zugriffstoken) verwaltet.
const stachelMiroAppsUrl = 'https://miro.com/app/settings/user-profile/apps';

/// `GET /api/import/sources` → `miro`.
class StachelImportSources {
  const StachelImportSources({this.enabled = false, this.token = false, this.oauth = false, this.connected = false});

  /// Fehlt `miro` oder ist es kaputt: nichts angeboten.
  static StachelImportSources fromJson(Object? j) {
    final m = j is Map ? j['miro'] : null;
    if (m is! Map) return const StachelImportSources();
    return StachelImportSources(
      enabled: m['enabled'] == true,
      token: m['token'] == true,
      oauth: m['oauth'] == true,
      connected: m['connected'] == true,
    );
  }

  /// Import grundsätzlich an.
  final bool enabled;

  /// Persönliches Zugriffstoken einfügen erlaubt.
  final bool token;

  /// „Mit Miro verbinden“ (OAuth) möglich.
  final bool oauth;

  /// Die Person hat eine gespeicherte OAuth-Verbindung.
  final bool connected;

  /// Der Eintrag „Board importieren“ lohnt sich: an und mindestens ein Weg zum Verbinden.
  bool get available => enabled && (token || oauth);
}

/// Ein Board in Miro (`ImportRemoteBoard`); nichts davon wird gespeichert.
class StachelImportRemoteBoard {
  const StachelImportRemoteBoard({required this.id, required this.name, this.description = '', this.modifiedAt});

  static StachelImportRemoteBoard? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    final name = j['name'];
    return StachelImportRemoteBoard(
      id: j['id'] as String,
      name: name is String && name.trim().isNotEmpty ? name : 'Unbenanntes Board',
      description: j['description'] is String ? j['description'] as String : '',
      modifiedAt: DateTime.tryParse(j['modifiedAt'] is String ? j['modifiedAt'] as String : ''),
    );
  }

  final String id;
  final String name;
  final String description;
  final DateTime? modifiedAt;
}

/// Eine Seite der Board-Liste (`ImportRemoteBoards`); [next] = `offset` der nächsten Seite, null = Ende.
class StachelImportRemoteBoards {
  const StachelImportRemoteBoards(this.boards, {this.next});

  static StachelImportRemoteBoards fromJson(Object? j) {
    if (j is! Map || j['boards'] is! List) throw StachelException.forCode('error');
    final next = j['next'];
    return StachelImportRemoteBoards([
      for (final b in j['boards'] as List) ?StachelImportRemoteBoard.fromJson(b),
    ], next: next is num ? next.toInt() : null);
  }

  final List<StachelImportRemoteBoard> boards;
  final int? next;
}

/// Optionen eines Imports (`ImportOptions`).
class StachelImportOptions {
  const StachelImportOptions({this.keepColors = false, this.description = true});

  /// Notizfarben als Originalfarbe statt der nächsten Palettenfarbe.
  final bool keepColors;

  /// Board-Beschreibung als Text oben links.
  final bool description;

  Map<String, Object?> toJson() => {'keepColors': keepColors, 'description': description};
}

/// Ein Eintrag im Bericht: stabiler [code], deutscher [text], [count].
class StachelImportReportEntry {
  const StachelImportReportEntry(this.code, this.text, this.count);

  static StachelImportReportEntry? fromJson(Object? j) {
    if (j is! Map || j['text'] is! String) return null;
    final n = j['count'];
    return StachelImportReportEntry(
      j['code'] is String ? j['code'] as String : '',
      j['text'] as String,
      n is num ? n.toInt() : 1,
    );
  }

  final String code;
  final String text;
  final int count;
}

/// Bericht eines Imports (`ImportReport`).
class StachelImportReport {
  const StachelImportReport({
    this.imported = const {},
    this.adjusted = const [],
    this.skipped = const [],
    this.notes = const [],
  });

  static StachelImportReport? fromJson(Object? j) {
    if (j is! Map) return null;
    List<StachelImportReportEntry> entries(Object? l) => [
      for (final e in (l is List ? l : const [])) ?StachelImportReportEntry.fromJson(e),
    ];
    final imported = j['imported'];
    return StachelImportReport(
      imported: {
        if (imported is Map)
          for (final e in imported.entries)
            if (e.key is String && e.value is num && (e.value as num) > 0) e.key as String: (e.value as num).toInt(),
      },
      adjusted: entries(j['adjusted']),
      skipped: entries(j['skipped']),
      notes: [
        for (final n in (j['notes'] is List ? j['notes'] as List : const []))
          if (n is String && n.trim().isNotEmpty) n,
      ],
    );
  }

  /// Übernommene Objekte je Stachel-Typ.
  final Map<String, int> imported;

  /// Übernommen, aber angepasst.
  final List<StachelImportReportEntry> adjusted;

  /// Nicht übernommen.
  final List<StachelImportReportEntry> skipped;

  /// Feste Hinweise.
  final List<String> notes;

  int get importedTotal => imported.values.fold(0, (a, b) => a + b);
}

/// Deutsche Namen der Stachel-Typen im Bericht (Einzahl, Mehrzahl) wie im Web (`TYPE_NAMES`).
const stachelImportTypeNames = {
  'sticky': ('Notiz', 'Notizen'),
  'shape': ('Form', 'Formen'),
  'text': ('Text', 'Texte'),
  'connector': ('Verbinder', 'Verbinder'),
  'frame': ('Rahmen', 'Rahmen'),
  'image': ('Bild', 'Bilder'),
  'document': ('Dokument', 'Dokumente'),
  'card': ('Karte', 'Karten'),
  'mindnode': ('Mindmap-Knoten', 'Mindmap-Knoten'),
  'table': ('Tabelle', 'Tabellen'),
  'pen': ('Zeichnung', 'Zeichnungen'),
  'line': ('Linie', 'Linien'),
  'timeline': ('Zeitleiste', 'Zeitleisten'),
};

/// „1 Notiz“, „12 Notizen“; unbekannter Typ: „3 × name“.
String stachelImportTypeCount(String type, int n) {
  final names = stachelImportTypeNames[type];
  if (names == null) return '$n × $type';
  return '$n ${n == 1 ? names.$1 : names.$2}';
}

/// Übernommene Objekte als „12 Notizen“ …, größte Zahl zuerst (gleich viele: in der Reihenfolge der Namensliste).
List<String> stachelImportedList(StachelImportReport? r) {
  final order = stachelImportTypeNames.keys.toList();
  int rank(String t) => order.contains(t) ? order.indexOf(t) : order.length;
  final entries = (r?.imported ?? const <String, int>{}).entries.where((e) => e.value > 0).toList()
    ..sort((a, b) => b.value != a.value ? b.value - a.value : rank(a.key) - rank(b.key));
  return [for (final e in entries) stachelImportTypeCount(e.key, e.value)];
}

/// Eine Zeile über den Bericht: „128 Objekte übernommen · 12 angepasst · 3 nicht übernommen“.
String stachelImportReportSummary(StachelImportReport? r) {
  if (r == null) return '';
  int sum(Iterable<int> xs) => xs.fold(0, (a, b) => a + (b > 0 ? b : 0));
  final n = sum(r.imported.values);
  final adj = sum(r.adjusted.map((e) => e.count));
  final skip = sum(r.skipped.map((e) => e.count));
  return [
    '${n == 1 ? '1 Objekt' : '$n Objekte'} übernommen',
    if (adj > 0) '$adj angepasst',
    if (skip > 0) '$skip nicht übernommen',
  ].join(' · ');
}

/// Eintrag „angepasst“/„nicht übernommen“ mit Zahl davor, wenn der Text sie nicht schon nennt.
String stachelImportEntryText(StachelImportReportEntry e) =>
    e.count <= 1 || RegExp(r'\d').hasMatch(e.text) ? e.text : '${e.count} × ${e.text}';

/// Überschrift über dem Fortschritt bzw. Ergebnis (Web `jobsHeading`).
String stachelImportJobsHeading(List<StachelImportJob> jobs) {
  final many = jobs.length > 1;
  if (jobs.any((j) => j.active)) return many ? 'Boards werden übernommen' : 'Board wird übernommen';
  if (jobs.every((j) => j.status == 'done')) return 'Import fertig';
  if (!many && jobs.isNotEmpty && jobs.first.status == 'failed') return 'Import fehlgeschlagen';
  if (!many && jobs.isNotEmpty && jobs.first.status == 'canceled') return 'Import abgebrochen';
  return 'Import beendet';
}

/// Ein Import-Auftrag (`ImportJob`).
class StachelImportJob {
  const StachelImportJob({
    required this.id,
    this.source = 'miro',
    this.sourceBoard = '',
    required this.sourceName,
    required this.status,
    this.phase = 'queued',
    this.done = 0,
    this.total = 0,
    this.boardId,
    this.error,
    this.report,
    this.createdAt,
    this.finishedAt,
  });

  static StachelImportJob? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    String? s(String k) => j[k] is String ? j[k] as String : null;
    int n(String k) => j[k] is num ? (j[k] as num).toInt() : 0;
    final name = s('sourceName');
    return StachelImportJob(
      id: j['id'] as String,
      source: s('source') ?? 'miro',
      sourceBoard: s('sourceBoard') ?? '',
      sourceName: name == null || name.trim().isEmpty ? 'Unbenanntes Board' : name,
      status: s('status') ?? 'queued',
      phase: s('phase') ?? 'queued',
      done: n('done'),
      total: n('total'),
      boardId: s('boardId'),
      error: s('error'),
      report: StachelImportReport.fromJson(j['report']),
      createdAt: DateTime.tryParse(s('createdAt') ?? ''),
      finishedAt: DateTime.tryParse(s('finishedAt') ?? ''),
    );
  }

  final String id;
  final String source;
  final String sourceBoard;
  final String sourceName;

  /// `queued` / `running` / `done` / `failed` / `canceled`.
  final String status;

  /// `queued` / `read` / `images` / `build` / `done`.
  final String phase;
  final int done;
  final int total;
  final String? boardId;
  final String? error;
  final StachelImportReport? report;
  final DateTime? createdAt;
  final DateTime? finishedAt;

  /// Läuft noch (wartet oder arbeitet).
  bool get active => status == 'queued' || status == 'running';

  /// Anteil der aktuellen Phase (0…1); null = der Server kennt noch keine Gesamtzahl.
  double? get progress {
    if (status == 'done') return 1;
    if (!active || total <= 0) return null;
    return (done / total).clamp(0.0, 1.0);
  }

  /// Was gerade passiert, z. B. „Bilder laden“; nach dem Ende der Status (Web `phaseLabel`).
  String get phaseLabel => switch (status) {
    'done' => 'Fertig',
    'failed' => 'Fehlgeschlagen',
    'canceled' => 'Abgebrochen',
    'queued' => 'Wartet auf den Start',
    _ => switch (phase) {
      'queued' => 'Wartet',
      'read' => 'Objekte lesen',
      'images' => 'Bilder laden',
      'build' => 'Board anlegen',
      'done' => 'Fertig',
      _ => 'Läuft',
    },
  };

  /// „Objekte lesen · 3 von 12“ bzw. nur die Phase (Web `progressText`).
  String get progressText {
    if (!active || status == 'queued' || total <= 0) return phaseLabel;
    return '$phaseLabel · ${done < total ? done : total} von $total';
  }

  /// Kurzer Zustand für „Letzte Importe“: „Fertig“, „Bilder laden 60 %“ … (Web `statusChip`).
  String get chipText {
    if (!active) return phaseLabel;
    final p = progress;
    return p == null ? phaseLabel : '$phaseLabel ${(p * 100).round()} %';
  }
}

/// Deutscher Text eines Import-Fehlers, wenn der Server keinen schickt (Vertrag `docs/features/import.md` §2).
String stachelImportErrorText(String code) => switch (code) {
  'miro_token_invalid' =>
    'Miro hat das Token abgelehnt. Prüfe, ob du es vollständig kopiert hast, oder hol dir in Miro unter „Your apps“ '
        'ein neues.',
  'miro_conn_expired' => 'Die Verbindung zu Miro ist abgelaufen. Bitte verbinde dich noch einmal.',
  'import_limit' => 'Für heute sind genug Boards importiert. Versuch es morgen wieder.',
  'board_limit' => 'Du hast zu viele Boards. Lösche alte Boards und leere den Papierkorb, dann klappt der Import.',
  'oauth_disabled' =>
    'Diese Stachel-Instanz kann sich nicht direkt mit Miro verbinden. Füge stattdessen ein Zugriffstoken ein.',
  'import_disabled' =>
    'Der Import ist auf dieser Stachel-Instanz ausgeschaltet. Frag die Person, die Stachel betreibt.',
  'miro_unavailable' => 'Miro antwortet gerade nicht. Versuch es in ein paar Minuten noch einmal.',
  _ => stachelErrorText(code, null),
};

/// Fehler, nach denen man sich neu verbinden muss (Web `RECONNECT_CODES`).
const stachelImportReconnectCodes = {'miro_conn_expired', 'miro_token_invalid'};

/// Fehlercodes, die nur der Import kennt (ihr Text kommt vom Server bzw. aus [stachelImportErrorText]).
const stachelImportErrorCodes = {
  'miro_token_invalid',
  'miro_conn_expired',
  'import_limit',
  'board_limit',
  'oauth_disabled',
  'import_disabled',
  'miro_unavailable',
};

/// Der Import über die App-Sitzung von [boards] (Bearer `sts_…`, schreibend mit `X-Stachel: 1`). Wirft
/// [StachelException]; der Text ist der deutsche des Servers (`message`), sonst [stachelImportErrorText].
///
/// Achtung: `miro_conn_expired` kommt mit 401 – das ist die Miro-Verbindung, nicht die Stachel-Sitzung, also keine neue
/// Sitzung holen.
class StachelImportApi {
  StachelImportApi(this.boards);

  final HttpStachelBoardsApi boards;

  static const _timeout = Duration(seconds: 30);

  Future<Map<String, Object?>> _send(String method, String path, {Object? body, bool retried = false}) async {
    final write = method != 'GET';
    final token = await boards.sessionToken(fresh: retried);
    final req = http.Request(method, Uri.parse('${boards.base}$path'))
      ..followRedirects = false
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        if (write) 'X-Stachel': '1',
        if (body != null) 'Content-Type': 'application/json',
      });
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(
        await boards.client.httpClient.send(req).timeout(_timeout),
      ).timeout(_timeout);
    } catch (_) {
      throw StachelException.forCode('network');
    }
    Object? j;
    try {
      j = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {}
    final code = j is Map && j['error'] is String ? j['error'] as String : null;
    if (res.statusCode == 401 && !retried && code != 'miro_conn_expired') {
      return _send(method, path, body: body, retried: true);
    }
    if (res.statusCode >= 200 && res.statusCode < 300 && j is Map) return j.cast<String, Object?>();
    final message = j is Map && j['message'] is String ? j['message'] as String : null;
    if (code != null && stachelImportErrorCodes.contains(code)) {
      throw StachelException(code, message ?? stachelImportErrorText(code));
    }
    throw stachelErrorFrom(status: res.statusCode, code: code, message: message);
  }

  /// `GET /api/import/sources`.
  Future<StachelImportSources> sources() async =>
      StachelImportSources.fromJson(await _send('GET', '/api/import/sources'));

  /// `POST /api/import/miro/token {token}` → Verbindung (`conn`). Das Token geht nur in diese eine Anfrage.
  Future<String> connectToken(String token) async {
    final conn = (await _send('POST', '/api/import/miro/token', body: {'token': token.trim()}))['conn'];
    if (conn is! String || conn.isEmpty) throw StachelException.forCode('error');
    return conn;
  }

  /// `POST /api/import/miro/oauth/start {client: "app"}` → Adresse der Miro-Freigabeseite (im System-Browser öffnen).
  Future<Uri> oauthStart() async {
    final url = (await _send('POST', '/api/import/miro/oauth/start', body: {'client': 'app'}))['url'];
    final u = url is String ? Uri.tryParse(url) : null;
    if (u == null || (u.scheme != 'https' && u.scheme != 'http')) throw StachelException.forCode('error');
    return u;
  }

  /// `DELETE /api/import/miro/oauth`: Verbindung trennen.
  Future<void> disconnect() => _send('DELETE', '/api/import/miro/oauth');

  /// `GET /api/import/miro/boards?conn=&query=&offset=`.
  Future<StachelImportRemoteBoards> remoteBoards(String conn, {String query = '', int offset = 0}) async {
    final q = {'conn': conn, if (query.trim().isNotEmpty) 'query': query.trim(), if (offset > 0) 'offset': '$offset'};
    return StachelImportRemoteBoards.fromJson(
      await _send('GET', '/api/import/miro/boards?${Uri(queryParameters: q).query}'),
    );
  }

  /// `POST /api/import/miro/jobs {conn, boards, options}` → die angelegten Aufträge.
  Future<List<StachelImportJob>> startJobs(
    String conn,
    List<String> boardIds, {
    StachelImportOptions options = const StachelImportOptions(),
  }) async => _jobs(
    await _send('POST', '/api/import/miro/jobs', body: {'conn': conn, 'boards': boardIds, 'options': options.toJson()}),
  );

  /// `GET /api/import/jobs`: eigene Aufträge der letzten 7 Tage, neueste zuerst.
  Future<List<StachelImportJob>> jobs() async => _jobs(await _send('GET', '/api/import/jobs'));

  /// `GET /api/import/jobs/:id`.
  Future<StachelImportJob> job(String id) async =>
      StachelImportJob.fromJson((await _send('GET', '/api/import/jobs/${Uri.encodeComponent(id)}'))['job']) ??
      (throw StachelException.forCode('error'));

  /// `DELETE /api/import/jobs/:id`: abbrechen.
  Future<void> cancelJob(String id) => _send('DELETE', '/api/import/jobs/${Uri.encodeComponent(id)}');

  static List<StachelImportJob> _jobs(Map<String, Object?> j) => [
    for (final x in (j['jobs'] is List ? j['jobs'] as List : const [])) ?StachelImportJob.fromJson(x),
  ];
}
