import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:stachel_board/stachel_board.dart' show BoardDesktop;

import 'stachel_client_base.dart';
import 'stachel_import_api.dart';
import 'stachel_overview.dart';
import 'stachel_style.dart';

// „Board importieren“ wie der Web-Dialog (`web/src/features/import/ImportDialog.tsx`, docs/features/import.md): Quelle
// und letzte Importe → Verbinden (Mit Miro verbinden im System-Browser / Zugriffstoken) → Boards wählen → Übernehmen
// (Fortschritt, Bericht je Board, Board öffnen). Gleiche Schritte und Texte wie im Web; am Handy eine eigene Seite, in
// großen Fenstern (BoardDesktop.isWide) ein Dialog.

/// Kleiner Hinweis im Import-Bildschirm (Marke, keine Verbindung zu Miro; Web `BRAND_NOTE`).
const stachelMiroTrademark = 'Miro ist eine Marke der RealtimeBoard, Inc. Stachel steht in keiner Verbindung zu Miro.';

/// Ein Board, das nach dem Import geöffnet werden soll.
typedef StachelImportedBoard = ({String id, String title});

/// Öffnet „Board importieren“; liefert das Board, das danach geöffnet werden soll („Board öffnen“), sonst null.
/// [sources]: schon bekanntes Angebot der Instanz (wird neu geladen). [onImported]: ein Import ist fertig (Board-Liste
/// neu laden). [onLoginLost]: die Stachel-Anmeldung ist weg (der Import schließt sich).
Future<StachelImportedBoard?> showStachelImport(
  BuildContext context, {
  required StachelImportApi api,
  StachelImportSources? sources,
  ExternalLauncher launcher = launchExternal,
  VoidCallback? onImported,
  void Function(StachelException e)? onLoginLost,
}) {
  StachelImportFlow flow(bool dialog) => StachelImportFlow(
    api: api,
    sources: sources,
    launcher: launcher,
    onImported: onImported,
    onLoginLost: onLoginLost,
    dialog: dialog,
  );
  if (BoardDesktop.wideOf(context)) {
    return showDialog<StachelImportedBoard>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Sk.surface,
        clipBehavior: Clip.antiAlias,
        child: SizedBox(
          width: 640,
          height: (MediaQuery.sizeOf(ctx).height * 0.9).clamp(400.0, 800.0),
          child: flow(true),
        ),
      ),
    );
  }
  return Navigator.of(context).push<StachelImportedBoard>(MaterialPageRoute(builder: (_) => flow(false)));
}

enum _Step { source, connect, boards, jobs }

/// Der ganze Ablauf (als Seite oder, mit [dialog], als Inhalt eines Dialogs).
class StachelImportFlow extends StatefulWidget {
  const StachelImportFlow({
    super.key,
    required this.api,
    this.sources,
    this.launcher = launchExternal,
    this.onImported,
    this.onLoginLost,
    this.dialog = false,
    this.oauthPoll = const Duration(seconds: 2),
    this.oauthWait = const Duration(minutes: 10),
  });

  final StachelImportApi api;
  final StachelImportSources? sources;
  final ExternalLauncher launcher;
  final VoidCallback? onImported;
  final void Function(StachelException e)? onLoginLost;
  final bool dialog;

  /// Abstand der Abfrage, ob die Miro-Freigabe da ist, und wie lange höchstens gewartet wird (`state` gilt 10 min).
  final Duration oauthPoll;
  final Duration oauthWait;

  @override
  State<StachelImportFlow> createState() => _StachelImportFlowState();
}

class _StachelImportFlowState extends State<StachelImportFlow> {
  StachelImportApi get _api => widget.api;

  _Step _step = _Step.source;
  late StachelImportSources? _sources = widget.sources;
  String? _sourceError;
  List<StachelImportJob>? _recent;

  /// Die Person hat schon etwas getan (dann springt der Ablauf nicht mehr von selbst zu laufenden Importen).
  bool _moved = false;

  // verbinden
  final _token = TextEditingController();
  bool _tokenHidden = true;
  String? _busy; // 'oauth' | 'token'
  String? _connectError;
  bool _waitingOauth = false;
  Timer? _oauthTimer;
  DateTime? _oauthUntil;
  Uri? _oauthUrl;
  bool _checking = false;
  late final AppLifecycleListener _lifecycle;

  // Boards wählen
  String? _conn;
  final _query = TextEditingController();
  Timer? _searchTimer;
  int _seq = 0;
  List<StachelImportRemoteBoard>? _remote;
  int? _next;
  bool _loadingBoards = false;
  String? _boardsError;
  final _selected = <String>[];
  bool _keepColors = false;
  bool _description = true;
  bool _starting = false;

  // übernehmen
  List<StachelImportJob> _jobs = const [];
  String? _jobsConn;
  String? _jobsError;
  Timer? _pollTimer;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _resumed);
    unawaited(_loadSources());
    unawaited(_loadRecent(first: true));
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _oauthTimer?.cancel();
    _searchTimer?.cancel();
    _pollTimer?.cancel();
    _token.dispose();
    _query.dispose();
    super.dispose();
  }

  /// Zurück in der App (z. B. aus dem Browser nach der Miro-Freigabe): gleich nachsehen.
  void _resumed() {
    if (_waitingOauth) unawaited(_checkOauth());
    if (_step == _Step.jobs) unawaited(_poll());
  }

  void _go(_Step s) => setState(() {
    _moved = true;
    _step = s;
  });

  /// Stachel-Anmeldung weg → schließen und der App melden; true = erledigt.
  bool _loginGone(StachelException e) {
    if (!e.needsLogin) return false;
    widget.onLoginLost?.call(e);
    if (mounted) Navigator.of(context).pop();
    return true;
  }

  Future<void> _loadSources() async {
    try {
      final s = await _api.sources();
      if (mounted) setState(() => _sources = s);
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      if (_sources == null) setState(() => _sourceError = e.message);
    }
  }

  /// Letzte Importe; beim Öffnen mit laufenden Importen gleich deren Fortschritt (wie der Web-Knopf „läuft“).
  Future<void> _loadRecent({bool first = false}) async {
    try {
      final jobs = await _api.jobs();
      if (!mounted) return;
      setState(() => _recent = jobs);
      final running = jobs.where((j) => j.active).toList();
      if (first && !_moved && _step == _Step.source && running.isNotEmpty) _showJobs(running);
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      setState(() => _recent ??= const []);
    }
  }

  // ---- 0. Quelle ------------------------------------------------------------------------------------------------

  /// „Aus Miro“: gespeicherte Verbindung → gleich zur Auswahl, sonst verbinden.
  void _chooseMiro() {
    final s = _sources;
    if (s == null || !s.available) return;
    if (s.oauth && s.connected) {
      _useConn(stachelImportOauthConn);
    } else {
      setState(() => _connectError = null);
      _go(_Step.connect);
    }
  }

  // ---- 1. Verbinden ---------------------------------------------------------------------------------------------

  Future<void> _connectOauth() async {
    setState(() {
      _busy = 'oauth';
      _connectError = null;
    });
    try {
      final url = await _api.oauthStart();
      _oauthUrl = url;
      if (!await widget.launcher(url)) throw StachelException.forCode('no_browser');
      if (!mounted) return;
      setState(() {
        _busy = null;
        _waitingOauth = true;
        _oauthUntil = DateTime.now().add(widget.oauthWait);
      });
      _oauthTimer?.cancel();
      _oauthTimer = Timer.periodic(widget.oauthPoll, (_) => _checkOauth());
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      setState(() {
        _busy = null;
        _connectError = e.message;
        final s = _sources;
        if (e.code == 'oauth_disabled' && s != null) {
          _sources = StachelImportSources(enabled: s.enabled, token: s.token, oauth: false, connected: false);
        }
      });
    }
  }

  Future<void> _reopenBrowser() async {
    final url = _oauthUrl;
    if (url == null) return;
    try {
      if (!await widget.launcher(url)) throw StachelException.forCode('no_browser');
    } on StachelException catch (e) {
      if (mounted) setState(() => _connectError = e.message);
    }
  }

  void _stopOauth({String? error}) {
    _oauthTimer?.cancel();
    _oauthTimer = null;
    setState(() {
      _waitingOauth = false;
      _connectError = error;
    });
  }

  /// Ist die Freigabe in Miro schon da? (Abfrage im Takt und beim Zurückkehren in die App)
  Future<void> _checkOauth() async {
    if (!_waitingOauth || _checking) return;
    final until = _oauthUntil;
    if (until != null && DateTime.now().isAfter(until)) {
      _stopOauth(error: 'Der Freigabe-Link ist abgelaufen. Tippe noch einmal auf „Mit Miro verbinden“.');
      return;
    }
    _checking = true;
    try {
      final s = await _api.sources();
      if (!mounted || !_waitingOauth) return;
      _sources = s;
      if (s.connected) {
        _stopOauth();
        _useConn(stachelImportOauthConn);
      }
    } on StachelException catch (e) {
      _loginGone(e); // sonst: Netz kurz weg, weiter warten
    } finally {
      _checking = false;
    }
  }

  Future<void> _connectToken() async {
    final t = _token.text.trim();
    if (t.isEmpty) {
      setState(() => _connectError = 'Bitte füge zuerst das Token aus Miro ein.');
      return;
    }
    setState(() {
      _busy = 'token';
      _connectError = null;
    });
    try {
      final conn = await _api.connectToken(t);
      if (!mounted) return;
      _token.clear(); // das Token lebt nur im Feld und in der einen Anfrage
      setState(() => _busy = null);
      _useConn(conn);
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      setState(() {
        _busy = null;
        _connectError = e.message;
      });
    }
  }

  Future<void> _paste() async {
    final text = (await Clipboard.getData(Clipboard.kTextPlain))?.text?.trim() ?? '';
    if (!mounted) return;
    setState(() {
      if (text.isEmpty) {
        _connectError = 'In der Zwischenablage ist kein Text.';
      } else {
        _token.text = text;
        _connectError = null;
      }
    });
  }

  Future<void> _openMiroApps() async {
    try {
      if (!await widget.launcher(Uri.parse(stachelMiroAppsUrl))) throw StachelException.forCode('no_browser');
    } on StachelException catch (e) {
      if (mounted) setState(() => _connectError = e.message);
    }
  }

  // ---- 2. Boards wählen -----------------------------------------------------------------------------------------

  void _useConn(String conn) {
    setState(() {
      _moved = true;
      _conn = conn;
      _step = _Step.boards;
      _remote = null;
      _next = null;
      _selected.clear();
      _boardsError = null;
      _query.clear();
    });
    unawaited(_loadBoards());
  }

  /// Verbindung abgelaufen/abgelehnt → zurück zum Verbinden, mit Grund.
  void _reconnect(String error) {
    final s = _sources;
    setState(() {
      if (s != null && s.connected) {
        _sources = StachelImportSources(enabled: s.enabled, token: s.token, oauth: s.oauth, connected: false);
      }
      _conn = null;
      _connectError = error;
      _step = _Step.connect;
    });
  }

  void _fail(StachelException e, void Function(String) show) {
    if (_loginGone(e) || !mounted) return;
    if (stachelImportReconnectCodes.contains(e.code)) {
      _reconnect(e.message);
    } else {
      show(e.message);
    }
  }

  void _searchChanged(String _) {
    _searchTimer?.cancel();
    _searchTimer = Timer(const Duration(milliseconds: 300), () => _loadBoards());
  }

  Future<void> _loadBoards({int? offset}) async {
    final conn = _conn;
    if (conn == null) return;
    final my = ++_seq;
    setState(() {
      _loadingBoards = true;
      _boardsError = null;
    });
    try {
      final page = await _api.remoteBoards(conn, query: _query.text, offset: offset ?? 0);
      if (!mounted || my != _seq) return;
      setState(() {
        final list = _remote;
        if (offset == null || list == null) {
          _remote = page.boards;
        } else {
          final seen = {for (final b in list) b.id};
          _remote = [...list, ...page.boards.where((b) => !seen.contains(b.id))];
        }
        _next = page.next;
        _loadingBoards = false;
      });
    } on StachelException catch (e) {
      if (!mounted || my != _seq) return;
      setState(() => _loadingBoards = false);
      _fail(e, (m) => setState(() => _boardsError = m));
    }
  }

  void _toggle(String id) => setState(() {
    if (!_selected.remove(id) && _selected.length < stachelImportMaxBoards) _selected.add(id);
  });

  Future<void> _disconnect() async {
    try {
      await _api.disconnect();
      if (!mounted) return;
      final s = _sources;
      setState(() {
        if (s != null) {
          _sources = StachelImportSources(enabled: s.enabled, token: s.token, oauth: s.oauth, connected: false);
        }
        _conn = null;
        _connectError = null;
        _step = _Step.connect;
      });
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      setState(() => _boardsError = e.message);
    }
  }

  Future<void> _start() async {
    final conn = _conn;
    if (conn == null || _selected.isEmpty) return;
    setState(() {
      _starting = true;
      _boardsError = null;
    });
    try {
      final jobs = await _api.startJobs(conn, [
        ..._selected,
      ], options: StachelImportOptions(keepColors: _keepColors, description: _description));
      if (!mounted) return;
      setState(() => _starting = false);
      _showJobs(jobs, conn: conn);
    } on StachelException catch (e) {
      if (!mounted) return;
      setState(() => _starting = false);
      _fail(e, (m) => setState(() => _boardsError = m));
    }
  }

  // ---- 3. Übernehmen --------------------------------------------------------------------------------------------

  void _showJobs(List<StachelImportJob> jobs, {String? conn}) {
    setState(() {
      _moved = true;
      _jobs = jobs;
      _jobsConn = conn;
      _jobsError = null;
      _step = _Step.jobs;
    });
    _startPolling();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    if (_jobs.any((j) => j.active)) _pollTimer = Timer.periodic(stachelImportPoll, (_) => _poll());
  }

  Future<void> _poll() async {
    final before = _jobs;
    if (_polling || !before.any((j) => j.active)) return;
    _polling = true;
    try {
      final fresh = <String, StachelImportJob>{};
      StachelException? error;
      for (final j in before.where((j) => j.active)) {
        try {
          fresh[j.id] = await _api.job(j.id);
        } on StachelException catch (e) {
          if (_loginGone(e)) return;
          error = e;
        }
      }
      if (!mounted || _step != _Step.jobs || !identical(before, _jobs)) return;
      final merged = [for (final j in before) fresh[j.id] ?? j];
      final finished = merged.any((j) => j.status == 'done' && before.any((b) => b.id == j.id && b.status != 'done'));
      setState(() {
        _jobs = merged;
        _jobsError = error?.message;
      });
      if (finished) widget.onImported?.call();
      if (!merged.any((j) => j.active)) {
        _pollTimer?.cancel();
        unawaited(_loadRecent());
      }
    } finally {
      _polling = false;
    }
  }

  Future<void> _cancel(StachelImportJob job) async {
    try {
      await _api.cancelJob(job.id);
      if (!mounted) return;
      setState(() {
        _jobs = [
          for (final j in _jobs)
            j.id == job.id
                ? StachelImportJob(
                    id: j.id,
                    source: j.source,
                    sourceBoard: j.sourceBoard,
                    sourceName: j.sourceName,
                    status: 'canceled',
                    phase: j.phase,
                    createdAt: j.createdAt,
                  )
                : j,
        ];
      });
      if (!_jobs.any((j) => j.active)) _pollTimer?.cancel();
    } on StachelException catch (e) {
      if (_loginGone(e) || !mounted) return;
      setState(() => _jobsError = e.message);
    }
  }

  void _more() {
    final conn = _jobsConn;
    if (conn != null) {
      _useConn(conn);
    } else {
      _chooseMiro();
    }
  }

  void _openBoard(StachelImportJob job) {
    final id = job.boardId;
    if (id != null) Navigator.of(context).pop<StachelImportedBoard>((id: id, title: job.sourceName));
  }

  // ---- Navigation -----------------------------------------------------------------------------------------------

  void _back() {
    switch (_step) {
      case _Step.source:
        Navigator.of(context).pop();
      case _Step.connect:
        if (_waitingOauth) _stopOauth();
        _go(_Step.source);
      case _Step.boards:
        _go(_Step.source);
      case _Step.jobs:
        _pollTimer?.cancel();
        unawaited(_loadRecent());
        _go(_Step.source);
    }
  }

  void _close() => Navigator.of(context).pop();

  // ---- Aufbau ---------------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final body = KeyedSubtree(
      key: const Key('stachelImportScreen'),
      child: switch (_step) {
        _Step.source => _sourceView(),
        _Step.connect => _connectView(),
        _Step.boards => _boardsView(),
        _Step.jobs => _jobsView(),
      },
    );
    return PopScope(
      canPop: _step == _Step.source,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: widget.dialog ? _dialogFrame(body) : _pageFrame(body),
    );
  }

  Widget _backButton() => IconButton(
    key: const Key('stachelImportBack'),
    tooltip: 'Zurück',
    icon: const Icon(Icons.arrow_back),
    onPressed: _back,
  );

  Widget _pageFrame(Widget body) => Scaffold(
    appBar: AppBar(
      leading: _backButton(),
      title: const Text('BOARD IMPORTIEREN'),
      bottom: PreferredSize(preferredSize: const Size.fromHeight(5), child: Sk.stripe(height: 5)),
    ),
    body: SafeArea(top: false, child: body),
  );

  Widget _dialogFrame(Widget body) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
        child: Row(
          children: [
            if (_step != _Step.source) _backButton() else const SizedBox(width: 12),
            Expanded(
              child: Text(
                'BOARD IMPORTIEREN',
                style: TextStyle(fontFamily: Sk.cond, fontSize: 22, fontWeight: FontWeight.w800),
              ),
            ),
            IconButton(
              key: const Key('stachelImportClose'),
              tooltip: 'Schließen',
              icon: const Icon(Icons.close),
              onPressed: _close,
            ),
          ],
        ),
      ),
      Sk.stripe(height: 4),
      Expanded(child: body),
    ],
  );

  static const _pad = EdgeInsets.fromLTRB(20, 14, 20, 20);

  /// Kleine Schrittanzeige: Verbinden · Boards wählen · Übernehmen (zu schmal: verkleinert statt abgeschnitten).
  Widget _steps(int at) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.centerLeft,
      child: Row(
        key: const Key('stachelImportSteps'),
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (i, name) in const ['Verbinden', 'Boards wählen', 'Übernehmen'].indexed) ...[
            if (i > 0)
              SizedBox(width: 18, child: Divider(color: Sk.ink.withValues(alpha: 0.25), indent: 3, endIndent: 3)),
            _StepDot(n: i + 1, name: name, now: i == at, done: i < at),
          ],
        ],
      ),
    ),
  );

  Widget _h(String text) => Padding(
    padding: const EdgeInsets.only(top: 4, bottom: 10),
    child: Text(
      text,
      style: TextStyle(fontFamily: Sk.cond, fontSize: 21, fontWeight: FontWeight.w800),
    ),
  );

  Widget _muted(String text, {Key? key, double size = 13}) => Text(
    text,
    key: key,
    style: TextStyle(color: Sk.grey, fontSize: size),
  );

  Widget _alert(String? text, {required Key key}) => text == null
      ? const SizedBox.shrink()
      : Container(
          margin: const EdgeInsets.symmetric(vertical: 8),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Sk.danger.withValues(alpha: 0.08),
            border: Border.all(color: Sk.danger.withValues(alpha: 0.5)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.error_outline, color: Sk.danger, size: 20),
              const SizedBox(width: 8),
              Expanded(child: Text(text, key: key)),
            ],
          ),
        );

  Widget _brand() => Padding(
    padding: const EdgeInsets.only(top: 20),
    child: _muted(stachelMiroTrademark, key: const Key('stachelImportTrademark'), size: 11),
  );

  Widget _actions(List<Widget> buttons) => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: Wrap(alignment: WrapAlignment.end, spacing: 8, runSpacing: 8, children: buttons),
  );

  Widget _sourceView() {
    final s = _sources;
    final recent = _recent ?? const <StachelImportJob>[];
    return ListView(
      padding: _pad,
      children: [
        const Text('Hol dir Boards aus einem anderen Whiteboard. Das Original bleibt, wie es ist.'),
        const SizedBox(height: 12),
        _h('Woher?'),
        if (s == null && _sourceError == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (s == null)
          _alert(_sourceError, key: const Key('stachelImportSourceError'))
        else ...[
          _SourceTile(
            key: const Key('stachelImportSourceMiro'),
            title: 'Aus Miro',
            subtitle: 'Boards mit Notizen, Formen, Texten, Verbindern, Rahmen und Bildern übernehmen',
            enabled: s.available,
            onTap: _chooseMiro,
          ),
          if (!s.available)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _muted(stachelImportErrorText('import_disabled'), key: const Key('stachelImportUnavailable')),
            ),
        ],
        if (recent.isNotEmpty) ...[
          const SizedBox(height: 22),
          _h('Letzte Importe'),
          for (final j in recent)
            ListTile(
              key: Key('stachelImportRecent-${j.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text(j.sourceName, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: (j.finishedAt ?? j.createdAt) == null ? null : Text(relativeTime(j.finishedAt ?? j.createdAt!)),
              trailing: _Chip(job: j),
              onTap: () => _showJobs([j]),
            ),
        ],
        _actions([TextButton(key: const Key('stachelImportDone'), onPressed: _close, child: const Text('SCHLIESSEN'))]),
        _brand(),
      ],
    );
  }

  Widget _connectView() {
    final s = _sources ?? const StachelImportSources();
    return ListView(
      padding: _pad,
      children: [
        _steps(0),
        _h('Zugang zu Miro'),
        _alert(_connectError, key: const Key('stachelImportConnectError')),
        if (s.oauth) ...[
          if (_waitingOauth)
            SkPanel(
              key: const Key('stachelImportOauthWaiting'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    children: [
                      SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text('Warte auf die Freigabe in Miro …', style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Erlaube Stachel in Miro, deine Boards zu lesen, und tippe danach im Browser auf „Verbinden“. Sobald '
                    '„Fertig – verbunden“ erscheint, kehr hierher zurück – es geht von allein weiter.',
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: [
                      TextButton(
                        key: const Key('stachelImportOauthReopen'),
                        onPressed: _reopenBrowser,
                        child: const Text('BROWSER NOCH EINMAL ÖFFNEN'),
                      ),
                      TextButton(
                        key: const Key('stachelImportOauthCancel'),
                        onPressed: () => _stopOauth(),
                        child: const Text('ABBRECHEN'),
                      ),
                    ],
                  ),
                ],
              ),
            )
          else ...[
            const Text(
              'Du meldest dich bei Miro an und erlaubst Stachel, deine Boards zu lesen. In Miro ändert sich nichts.',
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: const Key('stachelImportOauth'),
                onPressed: _busy != null ? null : _connectOauth,
                child: Text(_busy == 'oauth' ? 'ÖFFNET MIRO …' : 'MIT MIRO VERBINDEN'),
              ),
            ),
          ],
          if (s.token)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Row(
                children: [
                  const Expanded(child: Divider()),
                  Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: _muted('oder')),
                  const Expanded(child: Divider()),
                ],
              ),
            ),
        ],
        if (s.token) ..._tokenForm() else _actions([_backText()]),
        _brand(),
      ],
    );
  }

  Widget _backText() =>
      TextButton(key: const Key('stachelImportBackText'), onPressed: _back, child: const Text('ZURÜCK'));

  List<Widget> _tokenForm() => [
    const Text('Zugriffstoken einfügen', style: TextStyle(fontWeight: FontWeight.w700)),
    const SizedBox(height: 6),
    TextField(
      key: const Key('stachelImportToken'),
      controller: _token,
      obscureText: _tokenHidden,
      autocorrect: false,
      enableSuggestions: false,
      enableIMEPersonalizedLearning: false,
      keyboardType: TextInputType.visiblePassword,
      textInputAction: TextInputAction.done,
      onSubmitted: (_) => _busy != null ? null : _connectToken(),
      decoration: InputDecoration(
        hintText: 'Token aus Miro',
        suffixIcon: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              key: const Key('stachelImportTokenShow'),
              tooltip: _tokenHidden ? 'Token zeigen' : 'Token verbergen',
              icon: Icon(_tokenHidden ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              onPressed: () => setState(() => _tokenHidden = !_tokenHidden),
            ),
            IconButton(
              key: const Key('stachelImportTokenPaste'),
              tooltip: 'Aus der Zwischenablage einfügen',
              icon: const Icon(Icons.content_paste),
              onPressed: _paste,
            ),
          ],
        ),
      ),
    ),
    const SizedBox(height: 6),
    _muted(
      'Das Token bleibt nur kurz auf dem Server und wird nicht gespeichert. Danach kannst du die App in Miro wieder '
      'löschen.',
    ),
    Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        key: const Key('stachelImportTokenHelp'),
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 4),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        title: const Text('So bekommst du ein Token', style: TextStyle(fontWeight: FontWeight.w700)),
        children: [
          for (final (i, step) in _tokenSteps.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 24,
                    child: Text('${i + 1}.', style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                  Expanded(child: Text(step)),
                ],
              ),
            ),
          TextButton.icon(
            key: const Key('stachelImportMiroApps'),
            onPressed: _openMiroApps,
            icon: const Icon(Icons.open_in_new),
            label: const Text('miro.com/app/settings/user-profile/apps'),
          ),
        ],
      ),
    ),
    _actions([
      _backText(),
      FilledButton(
        key: const Key('stachelImportTokenConnect'),
        onPressed: _busy != null ? null : _connectToken,
        child: Text(_busy == 'token' ? 'PRÜFT …' : 'WEITER'),
      ),
    ]),
  ];

  static const _tokenSteps = [
    'Öffne in Miro dein Profil → Einstellungen → „Your apps“ (Link unten).',
    'Tippe auf „Create new app“ und gib ihr einen Namen, zum Beispiel „Stachel-Import“.',
    'Setz bei den Berechtigungen nur den Haken bei „boards:read“.',
    'Tippe auf „Install app and get OAuth token“.',
    'Wähl das Team, in dem deine Boards liegen.',
    'Kopier das Token und füg es oben ein.',
  ];

  Widget _boardsView() {
    final remote = _remote;
    final n = _selected.length;
    final full = n >= stachelImportMaxBoards;
    final oauth = _conn == stachelImportOauthConn;
    final q = _query.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: ListView(
            padding: _pad,
            children: [
              _steps(1),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                children: [
                  Icon(Icons.circle, size: 10, color: Sk.yellow),
                  Text(oauth ? 'Mit Miro verbunden' : 'Mit deinem Token verbunden'),
                  TextButton(
                    key: Key(oauth ? 'stachelImportDisconnect' : 'stachelImportOtherToken'),
                    onPressed: oauth
                        ? _disconnect
                        : () {
                            setState(() => _connectError = null);
                            _go(_Step.connect);
                          },
                    child: Text(oauth ? 'Verbindung zu Miro trennen' : 'Anderes Token'),
                  ),
                ],
              ),
              _h('Welche Boards?'),
              TextField(
                key: const Key('stachelImportSearch'),
                controller: _query,
                textInputAction: TextInputAction.search,
                autocorrect: false,
                onChanged: _searchChanged,
                onSubmitted: (_) {
                  _searchTimer?.cancel();
                  unawaited(_loadBoards());
                },
                decoration: const InputDecoration(hintText: 'In Miro suchen', prefixIcon: Icon(Icons.search)),
              ),
              _alert(_boardsError, key: const Key('stachelImportBoardsError')),
              const SizedBox(height: 4),
              if (remote == null && _loadingBoards)
                _muted('Boards werden geladen …', size: 14)
              else if (remote != null && remote.isEmpty && !_loadingBoards)
                _muted(
                  q.isEmpty ? 'In diesem Miro-Zugang gibt es keine Boards.' : 'Kein Board in Miro passt zu „$q“.',
                  key: const Key('stachelImportNoBoards'),
                  size: 14,
                )
              else if (remote != null)
                for (final b in remote) _boardTile(b, full),
              if (_next != null && remote != null)
                Center(
                  child: TextButton(
                    key: const Key('stachelImportMore'),
                    onPressed: _loadingBoards ? null : () => _loadBoards(offset: _next),
                    child: Text(_loadingBoards ? 'LÄDT …' : 'MEHR LADEN'),
                  ),
                ),
              const SizedBox(height: 8),
              SwitchListTile(
                key: const Key('stachelImportKeepColors'),
                contentPadding: EdgeInsets.zero,
                value: _keepColors,
                onChanged: (v) => setState(() => _keepColors = v),
                title: const Text('Originalfarben der Notizen behalten'),
                subtitle: const Text('Sonst bekommt jede Notiz die ähnlichste Stachel-Farbe.'),
              ),
              SwitchListTile(
                key: const Key('stachelImportDescription'),
                contentPadding: EdgeInsets.zero,
                value: _description,
                onChanged: (v) => setState(() => _description = v),
                title: const Text('Board-Beschreibung als Text'),
                subtitle: const Text('Steht dann oben links auf dem Board.'),
              ),
              _brand(),
            ],
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: Sk.surface,
            border: Border(top: BorderSide(color: Sk.ink.withValues(alpha: 0.15))),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Semantics(
                  liveRegion: true,
                  child: Text(
                    n == 0
                        ? 'Wähle bis zu $stachelImportMaxBoards Boards.'
                        : '$n ausgewählt${full ? ' – mehr als $stachelImportMaxBoards gehen nicht auf einmal' : ''}',
                    key: const Key('stachelImportCount'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 8,
                  children: [
                    _backText(),
                    FilledButton(
                      key: const Key('stachelImportStart'),
                      onPressed: n == 0 || _starting ? null : _start,
                      child: Text(
                        _starting
                            ? 'STARTET …'
                            : n > 1
                            ? '$n BOARDS IMPORTIEREN'
                            : 'IMPORTIEREN',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _boardTile(StachelImportRemoteBoard b, bool full) {
    final on = _selected.contains(b.id);
    final modified = b.modifiedAt;
    return CheckboxListTile(
      key: Key('stachelImportBoard-${b.id}'),
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      value: on,
      enabled: on || !full,
      onChanged: (_) => _toggle(b.id),
      title: Text(b.name, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: modified == null ? null : Text('Geändert ${relativeTime(modified)}'),
    );
  }

  Widget _jobsView() {
    final active = _jobs.any((j) => j.active);
    return ListView(
      padding: _pad,
      children: [
        _steps(2),
        _h(stachelImportJobsHeading(_jobs)),
        if (active)
          Text(
            widget.dialog
                ? 'Du kannst den Dialog schließen – der Import läuft im Hintergrund weiter.'
                : 'Du kannst diese Seite schließen – der Import läuft im Hintergrund weiter.',
          ),
        _alert(_jobsError, key: const Key('stachelImportJobsError')),
        const SizedBox(height: 6),
        for (final j in _jobs)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: SkPanel(
              key: Key('stachelImportJob-${j.id}'),
              // eigene Material-Fläche: die aufklappbare Kachel des Berichts malt sonst unter dem Panel
              child: Material(
                type: MaterialType.transparency,
                child: _jobCard(j, single: _jobs.length == 1),
              ),
            ),
          ),
        _actions([
          if (!active)
            TextButton(
              key: const Key('stachelImportMoreBoards'),
              onPressed: _more,
              child: const Text('WEITERE IMPORTIEREN'),
            ),
          if (active)
            FilledButton(
              key: const Key('stachelImportBackground'),
              onPressed: _close,
              child: const Text('IM HINTERGRUND WEITER'),
            )
          else
            TextButton(key: const Key('stachelImportDone'), onPressed: _close, child: const Text('SCHLIESSEN')),
        ]),
        _brand(),
      ],
    );
  }

  Widget _jobCard(StachelImportJob j, {required bool single}) {
    final running = j.active;
    final report = j.report;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                j.sourceName,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
            ),
            if (!running) _Chip(job: j),
          ],
        ),
        if (running) ...[
          const SizedBox(height: 10),
          LinearProgressIndicator(value: j.progress, minHeight: 6, borderRadius: BorderRadius.circular(3)),
          Row(
            children: [
              Expanded(child: Text(j.progressText, key: Key('stachelImportPhase-${j.id}'))),
              TextButton(
                key: Key('stachelImportCancel-${j.id}'),
                onPressed: () => _cancel(j),
                child: const Text('Abbrechen'),
              ),
            ],
          ),
        ],
        if (j.status == 'failed')
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              j.error ?? 'Der Import ist fehlgeschlagen. Versuch es noch einmal.',
              key: Key('stachelImportJobError-${j.id}'),
              style: TextStyle(color: Sk.danger),
            ),
          ),
        if (j.status == 'canceled')
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _muted('Abgebrochen – es wurde kein Board angelegt.', key: Key('stachelImportCanceled-${j.id}')),
          ),
        if (j.status == 'done') ...[
          if (report != null)
            Theme(
              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                key: Key('stachelImportReport-${j.id}'),
                tilePadding: EdgeInsets.zero,
                initiallyExpanded: single,
                expandedCrossAxisAlignment: CrossAxisAlignment.start,
                title: Text(stachelImportReportSummary(report), style: const TextStyle(fontSize: 14)),
                children: [_report(report)],
              ),
            ),
          if (j.boardId != null)
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: Key('stachelImportOpen-${j.id}'),
                onPressed: () => _openBoard(j),
                child: const Text('BOARD ÖFFNEN'),
              ),
            ),
        ],
      ],
    );
  }

  Widget _report(StachelImportReport r) {
    final got = stachelImportedList(r);
    Widget h(String t) => Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 4),
      child: Text(
        t.toUpperCase(),
        style: TextStyle(fontFamily: Sk.cond, fontSize: 15, fontWeight: FontWeight.w800, letterSpacing: 0.3),
      ),
    );
    Widget line(String t, {required IconData icon, Color? color}) => Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 8),
            child: Icon(icon, size: 16, color: color ?? Sk.grey),
          ),
          Expanded(child: Text(t)),
        ],
      ),
    );
    return Column(
      key: const Key('stachelImportReportView'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        h('Übernommen'),
        if (got.isEmpty)
          _muted('Nichts – das Board war leer.')
        else
          Wrap(spacing: 14, runSpacing: 4, children: [for (final g in got) Text(g)]),
        if (r.adjusted.isNotEmpty) ...[
          h('Angepasst'),
          for (final e in r.adjusted) line(stachelImportEntryText(e), icon: Icons.tune),
        ],
        if (r.skipped.isNotEmpty) ...[
          h('Nicht übernommen'),
          for (final e in r.skipped) line(stachelImportEntryText(e), icon: Icons.block, color: Sk.danger),
        ],
        if (r.notes.isNotEmpty) ...[h('Gut zu wissen'), for (final n in r.notes) line(n, icon: Icons.info_outline)],
        const SizedBox(height: 8),
      ],
    );
  }
}

/// Nummer und Name eines Schritts.
class _StepDot extends StatelessWidget {
  const _StepDot({required this.n, required this.name, required this.now, required this.done});
  final int n;
  final String name;
  final bool now;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final on = now || done;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 22,
          height: 22,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: now ? Sk.ink : (done ? Sk.yellow : null),
            border: Border.all(color: on ? Sk.ink : Sk.grey, width: 1.5),
          ),
          child: done
              ? Icon(Icons.check, size: 14, color: Sk.canvasInk)
              : Text(
                  '$n',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: now ? Sk.surface : Sk.grey),
                ),
        ),
        const SizedBox(width: 5),
        Text(
          name,
          maxLines: 1,
          softWrap: false,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: now ? FontWeight.w800 : FontWeight.w500,
            color: on ? null : Sk.grey,
          ),
        ),
      ],
    );
  }
}

/// Kurzer Zustand eines Auftrags (Web `statusChip`).
class _Chip extends StatelessWidget {
  const _Chip({required this.job});
  final StachelImportJob job;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (job.status) {
      'done' => (Sk.yellow, Sk.canvasInk),
      'failed' => (Sk.danger.withValues(alpha: 0.14), Sk.danger),
      'canceled' => (Sk.grey.withValues(alpha: 0.16), Sk.grey),
      _ => (Sk.blue.withValues(alpha: 0.14), Sk.blue),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(
        job.chipText,
        key: Key('stachelImportChip-${job.id}'),
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// Eine Quelle zum Wählen (neutral, ohne fremde Logos oder Farben).
class _SourceTile extends StatelessWidget {
  const _SourceTile({
    super.key,
    required this.title,
    required this.subtitle,
    required this.enabled,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Sk.surface,
    shape: RoundedRectangleBorder(
      side: BorderSide(color: Sk.ink.withValues(alpha: enabled ? 0.6 : 0.2), width: 1.5),
      borderRadius: BorderRadius.circular(10),
    ),
    clipBehavior: Clip.antiAlias,
    child: ListTile(
      enabled: enabled,
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
    ),
  );
}
