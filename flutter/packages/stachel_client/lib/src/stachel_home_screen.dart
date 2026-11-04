import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_import_api.dart';
import 'stachel_import_screen.dart';
import 'stachel_licenses.dart';
import 'stachel_moderation.dart';
import 'stachel_offline.dart';
import 'stachel_overview.dart';
import 'stachel_board_screen.dart';
import 'stachel_board_widgets.dart';
import 'stachel_new_board_sheet.dart';
import 'stachel_offline_sheet.dart';
import 'stachel_share_sheet.dart';
import 'stachel_trash_section.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

/// Builds the board screen for [boardId] (tests inject a fixture source).
typedef StachelBoardScreenBuilder = Widget Function(String boardId, String? title, String? objectId);

/// Stachel in the team area: the board overview like the web (`web/src/pages/BoardsPage.tsx`, audit A01–A15) –
/// templates („Verwenden“), search in title and creator (case and accents ignored, hits marked), order „Geändert /
/// Geöffnet / Name / Von mir“ (kept per device, favorites first), each board with preview image, star and menu
/// (Umbenennen, Duplizieren, Als Vorlage speichern / Board daraus anlegen, Vorlage bearbeiten, Löschen → trash with
/// „RÜCKGÄNGIG“), the trash below, live over SSE. Tapping a board opens it natively ([StachelBoardScreen]); the QR
/// login for a computer („Am Computer anmelden“) and „Im Browser öffnen“ stay as app extras.
///
/// Entry: push-pin symbol in the team top bar and the tile „Stachel“ under Mehr (concept §3.4), board links
/// (`/b/<id>[?o=<object>]`, [openBoard]/[openObject]: the board opens on top of the list). Offline the list from the
/// last visit is shown with its time.
class StachelHomeScreen extends StatefulWidget {
  const StachelHomeScreen({
    super.key,
    required this.client,
    this.boardsApi,
    this.launcher = launchExternal,
    this.openBoard,
    this.openObject,
    this.boardScreen,
    this.showNativePreview = !kReleaseMode,
  });

  /// The app around (login, browser, extras in the app bar).
  final StachelClient client;

  /// Board list; null = HTTP against the client's Stachel. Management (trash, copies …) only when it also is a
  /// [StachelBoardAdminApi].
  final StachelBoardsApi? boardsApi;

  /// Opens the system browser (tests pass a fake).
  final ExternalLauncher launcher;

  /// Board from an app link: opened right away (on top of the list).
  final String? openBoard;

  /// Object of the app link (`?o=`), centered on the board.
  final String? openObject;

  /// Board screen (null = [StachelBoardScreen] live).
  final StachelBoardScreenBuilder? boardScreen;

  /// Test boards of the renderer (debug/profile builds only): a symbol in the app bar.
  final bool showNativePreview;

  @override
  State<StachelHomeScreen> createState() => _StachelHomeScreenState();
}

/// How long „Board gelöscht · RÜCKGÄNGIG“ stays (web `UNDO_MS`).
const stachelUndoDuration = Duration(seconds: 8);

class _StachelHomeScreenState extends State<StachelHomeScreen> {
  late final StachelBoardsApi _boards = widget.boardsApi ?? HttpStachelBoardsApi(widget.client);
  StachelBoardAdminApi? get _admin => _boards is StachelBoardAdminApi ? _boards as StachelBoardAdminApi : null;
  StachelSharingApi? get _sharing => _boards is StachelSharingApi ? _boards as StachelSharingApi : null;
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  List<StachelBoardInfo>? _list;
  List<StachelTrashedBoard>? _trash;
  StachelException? _error;
  StachelUser? _me;
  StachelSort _sort = StachelSort.recent;
  StachelOwnerFilter _filter = StachelOwnerFilter.all;
  bool _trashOpen = false;

  /// What the instance offers for „Board importieren“ (null = unknown / not offered).
  StachelImportSources? _importSources;

  /// Board of the open rename/delete dialog (closed when someone else deletes it, A14) and whether it is the delete
  /// confirmation (own deletion: the „RÜCKGÄNGIG“ hint follows instead).
  String? _dialogFor;
  bool _dialogDeletes = false;

  /// The list shown is the one kept from [_staleSince] (offline or still loading).
  DateTime? _staleSince;
  bool _loading = true;
  bool _opening = false;
  StreamSubscription<StachelBoardEvent>? _events;
  Timer? _reload;
  Timer? _retry;

  @override
  void initState() {
    super.initState();
    // fonts, lucide and PDFium on the app's license page (both apps open Stachel here; idempotent)
    registerStachelLicenses();
    _search.addListener(() => setState(() {}));
    unawaited(_prefs());
    unawaited(_first());
    // N10: offline boards (mark in the list, refresh with this list)
    final boards = _boards;
    if (boards is HttpStachelBoardsApi) StachelOffline.instance.attach(boards, widget.client.httpClient);
    StachelOffline.instance.addListener(_offlineChanged);
    unawaited(StachelOffline.instance.load());
    final id = widget.openBoard;
    if (id != null) WidgetsBinding.instance.addPostFrameCallback((_) => _openBoard(id, objectId: widget.openObject));
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    _reload?.cancel();
    _retry?.cancel();
    _events?.cancel();
    StachelOffline.instance.removeListener(_offlineChanged);
    super.dispose();
  }

  void _offlineChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _prefs() async {
    try {
      final p = await SharedPreferences.getInstance();
      if (!mounted) return;
      setState(() {
        _sort = StachelSort.parse(p.getString(stachelSortKey));
        _filter = StachelOwnerFilter.parse(p.getString(stachelFilterKey));
        _trashOpen = p.getBool(stachelTrashOpenKey) ?? false;
      });
    } catch (_) {}
  }

  void _chooseSort(StachelSort s) {
    setState(() => _sort = s);
    unawaited(
      SharedPreferences.getInstance().then((p) => p.setString(stachelSortKey, s.name)).catchError((_) => false),
    );
  }

  void _chooseFilter(StachelOwnerFilter f) {
    setState(() => _filter = f);
    unawaited(
      SharedPreferences.getInstance().then((p) => p.setString(stachelFilterKey, f.name)).catchError((_) => false),
    );
  }

  /// The owner filter applies on instances with own accounts only (web: mode local).
  StachelOwnerFilter get _shownFilter => widget.client.showsRoles ? _filter : StachelOwnerFilter.all;

  void _toggleTrash() {
    setState(() => _trashOpen = !_trashOpen);
    final open = _trashOpen;
    unawaited(
      SharedPreferences.getInstance().then((p) => p.setBool(stachelTrashOpenKey, open)).catchError((_) => false),
    );
  }

  /// Kept list first (instantly, also offline), then the live one, then live updates.
  Future<void> _first() async {
    final cached = await _boards.cachedBoards();
    if (mounted && cached != null && _list == null) {
      setState(() {
        _list = cached.boards;
        _staleSince = cached.savedAt;
      });
    }
    await _load();
    if (!mounted) return;
    unawaited(_loadImportSources());
    _events = _boards.events().listen(
      _onEvent,
      onError: (Object e) {
        if (mounted && e is StachelException && e.needsLogin) widget.client.loginLost(context, message: e.message);
      },
    );
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    unawaited(_loadTrash());
    unawaited(_loadMe());
    try {
      final list = await _boards.boards();
      if (!mounted) return;
      _retry?.cancel();
      unawaited(StachelOffline.instance.refresh(list)); // changed offline boards (N10)
      setState(() {
        _list = list;
        _staleSince = null;
        _error = null;
        _loading = false;
      });
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) {
        widget.client.loginLost(context, message: e.message);
        return;
      }
      setState(() {
        _error = e;
        _loading = false;
      });
      // network: quietly again every 10 s (web RETRY_MS)
      if (e.code == 'network') {
        _retry?.cancel();
        _retry = Timer(const Duration(seconds: 10), () => _load(quiet: true));
      }
    }
  }

  Future<void> _loadTrash() async {
    final admin = _admin;
    if (admin == null) return;
    try {
      final t = await admin.trash();
      if (mounted) setState(() => _trash = t);
    } on StachelException catch (_) {
      // the list's own error is enough
    }
  }

  Future<void> _loadMe() async {
    final admin = _admin;
    if (admin == null || _me != null) return;
    try {
      final me = await admin.me();
      if (mounted) setState(() => _me = me);
    } on StachelException catch (_) {}
  }

  /// SSE: rename/remove in place, everything else (and a reconnect) reloads the list quietly.
  void _onEvent(StachelBoardEvent e) {
    if (!mounted) return;
    final list = _list;
    switch (e.type) {
      case 'renamed' when list != null && e.id != null && e.title != null:
        setState(() => _list = [for (final b in list) b.id == e.id ? b.withTitle(e.title!) : b]);
      case 'deleted' || 'purged' when list != null && e.id != null:
        final gone = list.where((b) => b.id == e.id).firstOrNull;
        setState(
          () => _list = [
            for (final b in list)
              if (b.id != e.id) b,
          ],
        );
        _closeDialogOf(e, gone);
        if (_admin != null) _reloadSoon();
      default:
        _reloadSoon();
    }
  }

  /// A14: an open rename/delete dialog of a board someone else just deleted closes with a hint.
  void _closeDialogOf(StachelBoardEvent e, StachelBoardInfo? board) {
    if (_dialogFor == null || _dialogFor != e.id || board == null) return;
    // own deletion: the answer brings „RÜCKGÄNGIG“
    if (_dialogDeletes && e.byKey != null && e.byKey == _me?.key) return;
    _dialogFor = null;
    Navigator.of(context, rootNavigator: true).pop();
    final by = e.by;
    _snack(
      '„${board.title}“ wurde gerade${by != null && by.isNotEmpty ? ' von $by' : ''} in den Papierkorb verschoben.',
    );
  }

  void _reloadSoon() {
    _reload?.cancel();
    _reload = Timer(const Duration(milliseconds: 400), () => _load(quiet: true));
  }

  void _snack(String text, {SnackBarAction? action, Duration? duration, Key? key}) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(key: key, content: Text(text), action: action, duration: duration ?? const Duration(seconds: 4)),
    );

  /// Errors of an action: login gone → team login, else the text.
  void _fail(StachelException e) {
    if (!mounted) return;
    if (e.needsLogin) {
      widget.client.loginLost(context, message: e.message);
      return;
    }
    _snack(e.message);
  }

  /// „Im Browser öffnen“ (board or overview), logged in through the app.
  Future<void> _openInBrowser({String? board}) async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      await widget.client.openInBrowser(board: board, launcher: widget.launcher);
    } on StachelException catch (e) {
      _fail(e);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _copyLink(StachelBoardInfo b) async {
    final base = _boards is HttpStachelBoardsApi ? (_boards).base : null;
    await Clipboard.setData(ClipboardData(text: stachelBoardUrl(b.id, base: base ?? widget.client.base)));
    if (mounted) _snack('Link zu „${b.title}“ kopiert.');
  }

  List<StachelBoardInfo> get _templates => sortTemplates([
    for (final b in _list ?? const <StachelBoardInfo>[])
      if (b.template) b,
  ]);

  /// Whether the instance offers an import (`GET /api/import/sources`); older servers or errors: no entry.
  Future<void> _loadImportSources() async {
    final boards = _boards;
    if (boards is! HttpStachelBoardsApi) return;
    try {
      final s = await StachelImportApi(boards).sources();
      if (mounted) setState(() => _importSources = s);
    } on StachelException catch (_) {}
  }

  /// „Board importieren“ (docs/features/import.md); afterwards the list reloads and „Board öffnen“ opens the board.
  Future<void> _import() async {
    final boards = _boards;
    if (boards is! HttpStachelBoardsApi) return;
    final open = await showStachelImport(
      context,
      api: StachelImportApi(boards),
      sources: _importSources,
      launcher: widget.launcher,
      onImported: () => _reloadSoon(),
      onLoginLost: _fail,
    );
    if (!mounted) return;
    unawaited(_load(quiet: true));
    if (open != null) await _openBoard(open.id, title: open.title);
  }

  /// „Neues Board“ (A08) – optionally from [template] (A09 „Verwenden“, „Board daraus anlegen“).
  Future<void> _newBoard({StachelBoardInfo? template}) async {
    final admin = _admin;
    await showStachelNewBoardSheet(
      context,
      templates: admin == null ? const [] : _templates,
      initialTemplate: template,
      thumbnail: _boards.thumbnail,
      onImport: _importSources?.available == true ? () => unawaited(_import()) : null,
      onCreate: (title, templateId) async {
        final b = templateId != null && admin != null
            ? await admin.duplicateBoard(templateId, title: title)
            : await _boards.createBoard(title);
        if (!mounted) return;
        Navigator.of(context).pop();
        unawaited(_load(quiet: true));
        await _openBoard(b.id, title: b.title);
      },
    );
  }

  Future<void> _toggleFavorite(StachelBoardInfo b) async {
    final next = !b.favorite;
    _replace(b.withFavorite(next));
    try {
      await _boards.setFavorite(b.id, next);
    } on StachelException catch (e) {
      if (!mounted) return;
      _replace(b);
      _snack(e.message);
    }
  }

  void _replace(StachelBoardInfo b) =>
      setState(() => _list = [for (final x in _list ?? const <StachelBoardInfo>[]) x.id == b.id ? b : x]);

  Future<void> _rename(StachelBoardInfo b) async {
    _dialogFor = b.id;
    _dialogDeletes = false;
    final title = await askStachelBoardTitle(context, heading: 'Umbenennen', action: 'SPEICHERN', initial: b.title);
    _dialogFor = null;
    if (title == null || title.isEmpty || title == b.title || !mounted) return;
    try {
      await _boards.renameBoard(b.id, title);
      if (mounted) _replace(b.withTitle(title));
    } on StachelException catch (e) {
      _fail(e);
    }
  }

  /// Duplizieren / Als Vorlage speichern: the copy appears in the list.
  Future<void> _copy(StachelBoardInfo b, {required bool template}) async {
    final admin = _admin;
    if (admin == null) return;
    try {
      final copy = await admin.duplicateBoard(b.id, template: template);
      if (!mounted) return;
      setState(() => _list = [copy, ...?_list]);
      if (template) _snack('„${copy.title}“ ist jetzt eine Vorlage.');
    } on StachelException catch (e) {
      _fail(e);
    }
  }

  /// A13: confirmation „In den Papierkorb“, then „Board gelöscht · RÜCKGÄNGIG“ for 8 s.
  Future<void> _delete(StachelBoardInfo b) async {
    final admin = _admin;
    if (admin == null) return;
    _dialogFor = b.id;
    _dialogDeletes = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Board löschen?'),
        content: Text(
          '„${b.title}“ kommt für alle in den Papierkorb. Dort lässt es sich $stachelTrashDays Tage lang '
          'wiederherstellen, danach wird es endgültig gelöscht.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ABBRECHEN')),
          FilledButton(
            key: const Key('stachelDeleteConfirm'),
            style: FilledButton.styleFrom(backgroundColor: Sk.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('IN DEN PAPIERKORB'),
          ),
        ],
      ),
    );
    _dialogFor = null;
    if (ok != true || !mounted) return;
    try {
      await admin.deleteBoard(b.id);
      if (!mounted) return;
      setState(
        () => _list = [
          for (final x in _list ?? const <StachelBoardInfo>[])
            if (x.id != b.id) x,
        ],
      );
      unawaited(_loadTrash());
      _snack(
        'Board gelöscht',
        key: const Key('stachelUndoDelete'),
        duration: stachelUndoDuration,
        action: SnackBarAction(label: 'RÜCKGÄNGIG', onPressed: () => unawaited(_undoDelete(b))),
      );
    } on StachelException catch (e) {
      _fail(e.code == 'forbidden' ? StachelException(e.code, stachelDeleteReason) : e);
    }
  }

  Future<void> _undoDelete(StachelBoardInfo b) async {
    try {
      await _admin?.restoreBoard(b.id);
    } on StachelException catch (e) {
      _fail(e);
    }
    if (mounted) unawaited(_load(quiet: true));
  }

  /// The native board; back here the list reloads quietly („Zuletzt geöffnet“ changed).
  Future<void> _openBoard(String id, {String? title, String? objectId}) async {
    if (!mounted) return;
    final info = _list?.where((b) => b.id == id).firstOrNull;
    final known = title ?? info?.title;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            widget.boardScreen?.call(id, known, objectId) ??
            StachelBoardScreen(
              client: widget.client,
              boardId: id,
              title: known,
              objectId: objectId,
              boardsApi: _boards is HttpStachelBoardsApi ? _boards : null,
              launcher: widget.launcher,
              template: info?.template,
            ),
      ),
    );
    if (mounted) unawaited(_load(quiet: true));
  }

  void _openPreview() => Navigator.of(
    context,
  ).push(MaterialPageRoute(builder: (_) => BoardDebugScreen(onOpenInBrowser: (_) => _openInBrowser())));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: skAppBar(
        'Stachel',
        actions: [
          ...widget.client.homeActions(context),
          // Melden und Blockieren: die Liste „Blockierte Personen“ (nur wenn die Konto-Seite der App sie nicht führt)
          if (_boards is HttpStachelBoardsApi && !widget.client.blockedPeopleInAccount)
            IconButton(
              key: const Key('stachelBlockedPeople'),
              tooltip: 'Blockierte Personen',
              icon: const Icon(Icons.block),
              onPressed: () => showStachelBlockedPeople(context, StachelModerationApi(_boards)),
            ),
          IconButton(
            key: const Key('stachelBrowser'),
            tooltip: 'Im Browser öffnen',
            icon: const Icon(Icons.open_in_browser),
            onPressed: _opening ? null : () => _openInBrowser(),
          ),
          if (widget.showNativePreview)
            IconButton(
              key: const Key('stachelNativePreview'),
              tooltip: 'Test-Boards (nur Test-Builds)',
              icon: const Icon(Icons.science_outlined),
              onPressed: _openPreview,
            ),
        ],
      ),
      body: SafeArea(top: false, child: _body()),
      floatingActionButton: _list == null || _error?.code == 'not_available'
          ? null
          : FloatingActionButton.extended(
              key: const Key('stachelNewBoard'),
              onPressed: () => _newBoard(),
              icon: const Icon(Icons.add),
              label: const Text('NEUES BOARD'),
            ),
    );
  }

  Widget _body() {
    if (_loading && _list == null) return const Center(child: CircularProgressIndicator());
    final error = _error;
    if (error != null && _list == null) {
      if (error.code == 'not_available') {
        return _NotAvailable(message: error.message, onBrowser: () => _openInBrowser());
      }
      return SkErrorView(message: error.message, onRetry: _load);
    }
    final all = _list ?? const <StachelBoardInfo>[];
    final q = _search.text.trim();
    final stale = _staleSince;
    final children = <Widget>[
      if (stale != null && error != null)
        StachelStatusBanner(
          key: const Key('stachelListOffline'),
          icon: Icons.cloud_off,
          text: error.code == 'network' ? 'Keine Verbindung – zeige gespeicherten Stand' : error.message,
          detail: 'Stand von ${stachelWhen(stale)}',
          action: TextButton(onPressed: _load, child: const Text('NEU LADEN')),
        )
      else if (error != null)
        StachelStatusBanner(
          key: const Key('stachelListStale'),
          icon: Icons.sync_problem,
          text: 'Liste gerade nicht aktuell: ${error.message}',
          action: TextButton(onPressed: _load, child: const Text('NOCHMAL VERSUCHEN')),
        ),
    ];
    if (all.isEmpty) {
      children.add(
        Padding(
          key: const Key('stachelEmpty'),
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 8),
          child: Column(
            children: [
              Icon(Icons.push_pin_outlined, size: 48, color: Sk.pink),
              const SizedBox(height: 12),
              const Text(
                'Noch keine Boards. Leg das erste an – zum Beispiel für die Festivalplanung.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                key: const Key('stachelFirstBoard'),
                onPressed: () => _newBoard(),
                icon: const Icon(Icons.add),
                label: const Text('ERSTES BOARD ANLEGEN'),
              ),
            ],
          ),
        ),
      );
    } else {
      final templates = _templates;
      final boards = filterBoards(
        [
          for (final b in all)
            if (!b.template && (q.isEmpty || boardMatches(b, q))) b,
        ],
        _shownFilter,
        _me?.key,
      );
      final visible = arrangeBoards(boards, _sort, _me?.key);
      final total = all.where((b) => !b.template).length;
      if (templates.isNotEmpty) children.add(_templatesSection(templates));
      children.addAll([
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            key: const Key('stachelSearch'),
            controller: _search,
            focusNode: _searchFocus,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Boards durchsuchen',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: q.isEmpty
                  ? null
                  : IconButton(tooltip: 'Suche löschen', icon: const Icon(Icons.close), onPressed: _search.clear),
            ),
          ),
        ),
        Padding(padding: const EdgeInsets.fromLTRB(16, 6, 16, 4), child: _sortBar()),
        if (widget.client.showsRoles) _filterBar(),
        // count for screen readers (web: role="status")
        if (q.isNotEmpty)
          Semantics(
            liveRegion: true,
            child: SizedBox(
              height: 0,
              child: Text('${visible.length} von $total Boards', key: const Key('stachelHitCount')),
            ),
          ),
      ]);
      if (visible.isEmpty && q.isEmpty && _shownFilter != StachelOwnerFilter.all) {
        children.add(
          SkEmpty(
            _shownFilter == StachelOwnerFilter.shared
                ? 'Noch hat niemand ein Board mit dir geteilt.'
                : 'Keine Boards unter „${_shownFilter.label}“.',
            key: const Key('stachelFilterEmpty'),
          ),
        );
      } else if (visible.isEmpty && q.isEmpty) {
        // only templates so far (the web's favorites filter exists in mode local only)
        children.add(const SkEmpty('Noch keine Boards – leg eins an oder starte mit einer Vorlage.'));
      } else if (visible.isEmpty) {
        children.add(
          Padding(
            key: const Key('stachelNoHit'),
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
            child: Column(
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'Kein Board passt zu „'),
                      TextSpan(
                        text: q,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      const TextSpan(text: '“.'),
                    ],
                  ),
                ),
                TextButton(
                  key: const Key('stachelClearSearch'),
                  onPressed: () {
                    _search.clear();
                    _searchFocus.requestFocus();
                  },
                  child: const Text('SUCHE LÖSCHEN'),
                ),
              ],
            ),
          ),
        );
      } else if (MediaQuery.sizeOf(context).width >= gridFrom) {
        // UX-Review P12: tablet and desktop show the boards as a grid of cards
        children.add(_grid([for (final b in visible) _tile(b, q)]));
      } else {
        for (final b in visible) {
          children.add(_tile(b, q));
        }
      }
    }
    final trash = _trash;
    final admin = _admin;
    if (trash != null && admin != null && _list != null) {
      children.add(
        StachelTrashSection(
          items: trash,
          open: _trashOpen,
          onToggle: _toggleTrash,
          api: admin,
          onChanged: () => _load(quiet: true),
          onError: _fail,
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 96), children: children),
    );
  }

  Widget _sortBar() => SegmentedButton<StachelSort>(
    key: const Key('stachelSort'),
    showSelectedIcon: false,
    style: SegmentedButton.styleFrom(
      visualDensity: VisualDensity.compact,
      padding: const EdgeInsets.symmetric(horizontal: 4),
    ),
    segments: [
      for (final s in StachelSort.values)
        ButtonSegment(
          value: s,
          tooltip: s.tooltip,
          label: Text(
            s.label,
            key: Key('stachelSort-${s.name}'),
            maxLines: 1,
            overflow: TextOverflow.fade,
            softWrap: false,
          ),
        ),
    ],
    selected: {_sort},
    onSelectionChanged: (s) => _chooseSort(s.first),
  );

  /// „Alle / Meine Boards / Mit mir geteilt / Favoriten“ (UX P15, audit R10; web `OwnerFilterBar`).
  Widget _filterBar() => SingleChildScrollView(
    key: const Key('stachelOwnerFilter'),
    scrollDirection: Axis.horizontal,
    padding: const EdgeInsets.fromLTRB(16, 2, 16, 4),
    child: Row(
      children: [
        for (final f in StachelOwnerFilter.values)
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: ChoiceChip(
              key: Key('stachelFilter-${f.name}'),
              label: Text(f.label),
              selected: _filter == f,
              showCheckmark: false,
              visualDensity: VisualDensity.compact,
              onSelected: (_) => _chooseFilter(f),
            ),
          ),
      ],
    ),
  );

  Widget _templatesSection(List<StachelBoardInfo> templates) => Column(
    key: const Key('stachelTemplates'),
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(padding: const EdgeInsets.fromLTRB(16, 18, 16, 0), child: SkHeading('Vorlagen ${templates.length}')),
      SizedBox(
        height: 172,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          children: [
            for (final t in templates)
              _TemplateCard(
                board: t,
                thumbnail: _boards.thumbnail(t),
                onUse: () => _newBoard(template: t),
                menu: _menu(t),
              ),
          ],
        ),
      ),
    ],
  );

  /// From this width the board list is a grid of cards (UX-Review P12: tablet, desktop).
  static const gridFrom = 600.0;

  /// Width of a card in the grid (at least; the columns share the row).
  static const gridCard = 340.0;

  /// The board tiles as cards in columns of at least [gridCard].
  Widget _grid(List<Widget> tiles) => LayoutBuilder(
    key: const Key('stachelBoardGrid'),
    builder: (context, c) {
      final cols = ((c.maxWidth - 16) / gridCard).floor().clamp(1, 6);
      return Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
        child: Column(
          children: [
            for (var i = 0; i < tiles.length; i += cols)
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var j = i; j < i + cols; j++)
                      Expanded(
                        child: j < tiles.length
                            ? Padding(
                                padding: const EdgeInsets.all(6),
                                child: Material(
                                  color: Sk.surface,
                                  clipBehavior: Clip.antiAlias,
                                  shape: RoundedRectangleBorder(
                                    side: BorderSide(color: Sk.ink.withValues(alpha: 0.25)),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Center(child: tiles[j]),
                                ),
                              )
                            : const SizedBox.shrink(),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );

  Widget _tile(StachelBoardInfo b, String q) => _BoardTile(
    board: b,
    query: q,
    meta: _sort == StachelSort.opened && b.openedAt != null
        ? 'Geöffnet ${relativeTime(b.openedAt!)}'
        : b.updatedAt == null
        ? ''
        : 'Geändert ${relativeTime(b.updatedAt!)}',
    offline: StachelOffline.instance.entry(b.id),
    thumbnail: _boards.thumbnail(b),
    onOpen: () => _openBoard(b.id, title: b.title),
    onStar: () => _toggleFavorite(b),
    menu: _menu(b),
    showRole: widget.client.showsRoles,
  );

  /// „Teilen …“ (instances with own accounts): the sharing sheet; afterwards the list reloads (left the board, roles).
  Future<void> _share(StachelBoardInfo b) async {
    final api = _sharing;
    if (api == null) return;
    await showStachelShareSheet(
      context,
      api: api,
      boardId: b.id,
      title: b.title,
      me: _me?.key,
      onChanged: () => unawaited(_load(quiet: true)),
      onLeft: () {
        setState(
          () => _list = [
            for (final x in _list ?? const <StachelBoardInfo>[])
              if (x.id != b.id) x,
          ],
        );
        _snack('Du hast „${b.title}“ verlassen.');
        unawaited(_load(quiet: true));
      },
      onLoginLost: _fail,
    );
  }

  /// The board menu „⋮“ (web `BoardMenu` + `boardActions`, app extras Browser/Link). With roles (instances with own
  /// accounts, `ROUTE_ROLES` in `server/src/access.ts`): „Umbenennen“ only with `edit`/`owner`, „Löschen“ only for the
  /// owner, „Teilen …“ for everyone with access (like the web's card menu).
  Widget _menu(StachelBoardInfo b) {
    final admin = _admin;
    final roles = widget.client.showsRoles;
    final canDelete = roles ? b.role == 'owner' : mayDeleteBoard(b, _me);
    final canRename = !roles || b.mayEdit;
    return PopupMenuButton<String>(
      key: Key('stachelMenu-${b.id}'),
      tooltip: 'Aktionen für „${b.title}“',
      onSelected: (v) => switch (v) {
        'rename' => _rename(b),
        'share' => _share(b),
        'duplicate' => _copy(b, template: false),
        'template' => _copy(b, template: true),
        'use' => _newBoard(template: b),
        'edit' => _openBoard(b.id, title: b.title),
        'browser' => _openInBrowser(board: b.id),
        'link' => _copyLink(b),
        'offline' => showStachelOfflineSheet(context, boardId: b.id, title: b.title),
        'delete' => _delete(b),
        _ => null,
      },
      itemBuilder: (_) => [
        if (canRename) _item(b, 'rename', Icons.drive_file_rename_outline, 'Umbenennen', key: 'stachelRename'),
        if (roles && _sharing != null)
          _item(b, 'share', Icons.person_add_alt_1_outlined, 'Teilen …', key: 'stachelShare'),
        if (admin != null && b.template) ...[
          _item(b, 'use', Icons.dashboard_customize_outlined, 'Board daraus anlegen', key: 'stachelUse'),
          _item(b, 'edit', Icons.edit_outlined, 'Vorlage bearbeiten', key: 'stachelEditTemplate'),
        ] else if (admin != null) ...[
          _item(b, 'duplicate', Icons.copy_outlined, 'Duplizieren', key: 'stachelDuplicate'),
          _item(b, 'template', Icons.dashboard_customize_outlined, 'Als Vorlage speichern', key: 'stachelSaveTemplate'),
        ],
        _item(b, 'browser', Icons.open_in_browser, 'Im Browser öffnen', key: 'stachelOpen'),
        _item(b, 'link', Icons.link, 'Link kopieren', key: 'stachelCopy'),
        PopupMenuItem(
          key: Key('stachelOffline-${b.id}'),
          value: 'offline',
          child: ListTile(
            leading: Icon(
              StachelOffline.instance.isPinned(b.id) ? Icons.offline_pin : Icons.download_for_offline_outlined,
            ),
            title: const Text('Offline verfügbar'),
            subtitle: Text(StachelOffline.instance.isPinned(b.id) ? 'An' : 'Aus'),
          ),
        ),
        if (admin != null)
          PopupMenuItem(
            key: Key('stachelDelete-${b.id}'),
            value: 'delete',
            enabled: canDelete,
            child: ListTile(
              leading: Icon(Icons.delete_outline, color: canDelete ? Sk.danger : null),
              title: Text('Löschen', style: TextStyle(color: canDelete ? Sk.danger : null)),
              subtitle: canDelete ? null : Text(roles ? stachelOwnerDeleteReason : stachelDeleteReason),
            ),
          ),
      ],
    );
  }

  static PopupMenuItem<String> _item(
    StachelBoardInfo b,
    String value,
    IconData icon,
    String label, {
    required String key,
  }) => PopupMenuItem(
    key: Key('$key-${b.id}'),
    value: value,
    child: ListTile(leading: Icon(icon), title: Text(label)),
  );
}

/// [text] with the search hit marked (web `Hit`).
TextSpan _hit(String text, String query, TextStyle? style) {
  final m = query.isEmpty ? null : findMatch(text, query);
  if (m == null) return TextSpan(text: text, style: style);
  return TextSpan(
    style: style,
    children: [
      TextSpan(text: text.substring(0, m.$1)),
      TextSpan(
        text: text.substring(m.$1, m.$2),
        style: TextStyle(backgroundColor: Sk.yellow, color: Sk.canvasInk),
      ),
      TextSpan(text: text.substring(m.$2)),
    ],
  );
}

final _placeholder = ColoredBox(
  color: Color(0xFFEDEBE4),
  child: Center(child: Icon(Icons.push_pin_outlined, color: Sk.grey, size: 20)),
);

Widget _thumb(ImageProvider? img) => img == null
    ? _placeholder
    : Image(
        image: img,
        fit: BoxFit.cover,
        gaplessPlayback: true,
        frameBuilder: (_, child, frame, sync) => sync || frame != null ? child : _placeholder,
        errorBuilder: (_, _, _) => _placeholder,
      );

class _BoardTile extends StatelessWidget {
  const _BoardTile({
    required this.board,
    required this.query,
    required this.meta,
    required this.thumbnail,
    required this.onOpen,
    required this.onStar,
    required this.menu,
    this.offline,
    this.showRole = false,
  });

  final StachelBoardInfo board;
  final String query;
  final String meta;

  /// Own role next to the title when it is not the owner (web `RoleTag`, instances with own accounts).
  final bool showRole;

  /// Kept „Offline verfügbar“ (N10): symbol and storage in the subtitle.
  final StachelOfflineEntry? offline;
  final ImageProvider? thumbnail;
  final VoidCallback onOpen;
  final VoidCallback onStar;
  final Widget menu;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context).textTheme;
    final by = board.createdByName;
    final role = showRole && board.role != null && board.role != 'owner' ? stachelRoleNames[board.role] : null;
    return ListTile(
      key: Key('stachelBoard-${board.id}'),
      onTap: onOpen,
      leading: Container(
        width: 60,
        height: 44,
        decoration: BoxDecoration(border: Border.all(color: Sk.ink, width: 2)),
        child: _thumb(thumbnail),
      ),
      title: Text.rich(
        TextSpan(
          children: [
            _hit(board.title, query, null),
            if (role != null)
              WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: StachelRoleTag(role, key: Key('stachelRole-${board.id}')),
                ),
              ),
          ],
        ),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: meta.isEmpty && by.isEmpty && offline == null
          ? null
          : Text.rich(
              TextSpan(
                children: [
                  if (offline case final off?) ...[
                    WidgetSpan(
                      alignment: PlaceholderAlignment.middle,
                      child: Icon(
                        Icons.offline_pin,
                        key: Key('stachelOfflineBadge-${board.id}'),
                        size: 14,
                        color: Sk.pink,
                      ),
                    ),
                    TextSpan(text: ' Offline · ${stachelBytes(off.bytes)}${meta.isEmpty && by.isEmpty ? '' : ' · '}'),
                  ],
                  TextSpan(text: meta),
                  if (by.isNotEmpty) ...[TextSpan(text: meta.isEmpty ? 'von ' : ' · von '), _hit(by, query, null)],
                ],
              ),
              key: Key('stachelMeta-${board.id}'),
              style: theme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            key: Key('stachelStar-${board.id}'),
            tooltip: board.favorite ? 'Stern entfernen' : 'Mit Stern markieren',
            icon: Icon(board.favorite ? Icons.star : Icons.star_border, color: board.favorite ? Sk.pink : Sk.grey),
            onPressed: onStar,
          ),
          menu,
        ],
      ),
    );
  }
}

/// A template card (web `TemplatesSection`): image, name, „von X · vor …“, „VERWENDEN“ opens „Board aus Vorlage“.
class _TemplateCard extends StatelessWidget {
  const _TemplateCard({required this.board, required this.thumbnail, required this.onUse, required this.menu});
  final StachelBoardInfo board;
  final ImageProvider? thumbnail;
  final VoidCallback onUse;
  final Widget menu;

  @override
  Widget build(BuildContext context) {
    final changed = board.updatedAt;
    return Container(
      key: Key('stachelTemplate-${board.id}'),
      width: 168,
      margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      decoration: BoxDecoration(
        border: Border.all(color: Sk.ink, width: 2),
        color: Sk.surface,
      ),
      child: InkWell(
        onTap: onUse,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(height: 70, child: _thumb(thumbnail)),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 0, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      board.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  SizedBox(width: 36, height: 30, child: menu),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                [
                  if (board.createdByName.isNotEmpty) 'von ${board.createdByName}',
                  if (changed != null) relativeTime(changed),
                ].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Sk.grey, fontSize: 12),
              ),
            ),
            const Spacer(),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
              child: Text(
                'VERWENDEN',
                key: Key('stachelUseTemplate-${board.id}'),
                style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w800, color: Sk.pink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Server without the native API yet (`app-session` missing): explain and offer the browser.
class _NotAvailable extends StatelessWidget {
  const _NotAvailable({required this.message, required this.onBrowser});
  final String message;
  final VoidCallback onBrowser;

  @override
  Widget build(BuildContext context) => ListView(
    key: const Key('stachelNotAvailable'),
    padding: const EdgeInsets.all(24),
    children: [
      const SizedBox(height: 40),
      Icon(Icons.push_pin_outlined, size: 56, color: Sk.pink),
      const SizedBox(height: 12),
      Text(message, textAlign: TextAlign.center),
      const SizedBox(height: 20),
      Center(
        child: FilledButton.icon(
          key: const Key('stachelNotAvailableBrowser'),
          onPressed: onBrowser,
          icon: const Icon(Icons.open_in_browser),
          label: const Text('STACHEL IM BROWSER ÖFFNEN'),
        ),
      ),
    ],
  );
}
