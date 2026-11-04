import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_board_images.dart';
import 'stachel_board_prefs.dart';
import 'stachel_boards_api.dart';
import 'stachel_clipboard.dart';
import 'stachel_cache.dart';
import 'stachel_chime.dart';
import 'stachel_documents.dart';
import 'stachel_moderation.dart';
import 'stachel_offline.dart';
import 'stachel_photos.dart';
import 'stachel_private.dart';
import 'stachel_share_target.dart';
import 'stachel_app_features.dart';
import 'stachel_board_admin.dart';
import 'stachel_board_tools.dart';
import 'stachel_board_widgets.dart';
import 'stachel_comments.dart';
import 'stachel_photo_flow.dart';
import 'stachel_share_flow.dart';
import 'stachel_share_sheet.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

/// App version for `hello.app` (server compares it with `minApp`, contract §8.2); set by the Flutter tool.
const _appVersion =
    '${String.fromEnvironment('FLUTTER_BUILD_NAME', defaultValue: '0.0.0')}'
    '+${String.fromEnvironment('FLUTTER_BUILD_NUMBER', defaultValue: '0')}';

/// A board, natively and live: [BoardView] over [NativeBoardSource] (`/native/v1`), images over [HttpBoardImages]
/// (memory + disk). E1 „Ansehen & dabei sein“, E2 „Bearbeiten“: tool bar (Auswahl · Notiz · Text · Form,
/// Rückgängig/Wiederholen), context bar over the selection, text in place, rename, changes during short network gaps
/// queued (contract §8.6, concept §3.5).
///
/// - Opens from the device cache right away when the board was open before („Stand von …“), then resumes live.
///   Offline it stays readable with „Keine Verbindung – zeige gespeicherten Stand“ and reconnects by itself.
/// - Others on the board: avatars in the app bar, their cursors/selections on the board; own viewport/selection go
///   out as presence (the web shows this person, not an AI).
/// - [objectId] (link `?o=`): centered and highlighted. Tapping an object selects it (context bar with „Link
///   kopieren“ and „Im Browser öffnen“, with rights also color, size, layer, delete …).
class StachelBoardScreen extends StatefulWidget {
  const StachelBoardScreen({
    super.key,
    required this.client,
    required this.boardId,
    this.title,
    this.objectId,
    this.boardsApi,
    this.source,
    this.images,
    this.cache,
    this.launcher = launchExternal,
    this.initialPhoto,
    this.initialShare,
    this.photoPicker,
    this.uploads,
    this.pendingStore,
    this.people,
    this.template,
    this.sharer = const StachelSharer(),
    this.otherBoard,
    this.documents,
  });

  /// PDF services of the board (P7: pdfrx, files/images REST, file picker, share); null = the real ones.
  final StachelDocuments? documents;

  /// The board is a template (hint „Vorlage“ next to the title, P6 B02); null = look it up.
  final bool? template;

  /// System share sheet for export and AI access (P6; tests pass a fake).
  final StachelSharer sharer;

  /// Screen of another board that replaces this one (copy, version copy, restored); null = a live board screen.
  final Widget Function(String boardId, String title)? otherBoard;

  /// A photo to put on the board right away (Team → NEU ANLEGEN → „Foto aufs Board“): uploaded and placed at a free
  /// spot in the middle of the view.
  final Uint8List? initialPhoto;

  /// Shared from another app (K13, `startStachelShare`): put on the board once it is live, like [initialPhoto].
  final StachelShared? initialShare;

  /// Camera/gallery; null = [ImagePickerPhotos].
  final StachelPhotoPicker? photoPicker;

  /// Waiting uploads (offline-safe); null = [FileStachelUploads].
  final StachelUploads? uploads;

  /// Unconfirmed own changes on the device; null = files under the app's support directory.
  final PendingStore? pendingStore;

  /// People for @mentions; null = `GET /api/users`.
  final Future<List<Person>> Function()? people;

  /// The app around (login, browser, board extras).
  final StachelClient client;
  final String boardId;
  final String? title;

  /// Object to center on (link `?o=<id>`).
  final String? objectId;

  /// Session token source; null = a new [HttpStachelBoardsApi].
  final HttpStachelBoardsApi? boardsApi;

  /// Transport; null = [NativeBoardSource] against `stachelBase` (tests pass a [FixtureBoardSource]).
  final BoardSource? source;
  final BoardImages? images;

  /// Offline cache; null = [StachelCache.boards] (files in the app's support directory).
  final BoardCache? cache;
  final ExternalLauncher launcher;

  @override
  State<StachelBoardScreen> createState() => _StachelBoardScreenState();
}

class _StachelBoardScreenState extends State<StachelBoardScreen> with WidgetsBindingObserver {
  late final HttpStachelBoardsApi _boards = widget.boardsApi ?? HttpStachelBoardsApi(widget.client);

  /// Melden und Blockieren (stachel_moderation.dart).
  late final StachelModerationApi _moderation = StachelModerationApi(_boards);
  late final BoardSource _source =
      widget.source ??
      NativeBoardSource(
        base: Uri.parse(_boards.base),
        board: widget.boardId,
        appVersion: _appVersion,
        client: widget.client.clientId,
        token: ({bool fresh = false}) async {
          try {
            return await _boards.sessionToken(fresh: fresh);
          } on StachelException catch (e) {
            if (e.needsLogin) {
              _lostCode = e.code;
              stopNativeSource('invalid_token');
            }
            rethrow;
          }
        },
      );
  late final BoardController _controller = BoardController(
    _source,
    boardId: widget.boardId,
    pendingStore: widget.pendingStore ?? FilePendingStore(() => StachelCache.tryDir('pending')),
  );
  late final BoardScene _scene = BoardScene(_controller.state);
  final _camera = CameraController();
  late final BoardEditor _editor = BoardEditor(controller: _controller, scene: _scene, camera: _camera)
    // double tap on a connector / frame title: the label / title dialog (web: edit in place)
    ..onEditField = (o) => o.type == 'frame' ? _renameFrame() : _editLabel();
  late final CollabLayer _collab = CollabLayer(controller: _controller, scene: _scene);

  /// Registries + host services of this board (F2): tool bar, context bar, menus, sheets, overlays, hints.
  late final BoardUi _ui = BoardUi(
    editor: _editor,
    registry: widget.client.registry,
    host: _Host(this),
    theme: stachelBoardTheme,
    viewKey: _viewKey,
  );
  StreamSubscription<String>? _hintSub;

  /// Board management services of the package's P6 entries (copies, versions, export, preview image, AI access).
  late final StachelBoardAdmin _admin = StachelBoardAdmin(
    api: _boards,
    boardId: widget.boardId,
    title: () => _title ?? '',
    template: widget.template,
    sharer: widget.sharer,
    openBoard: _openOther,
  );
  late final StachelUploads _uploads = widget.uploads ?? FileStachelUploads.instance;
  late final StachelDocuments _documents =
      widget.documents ??
      StachelDocuments(api: _boards, boardId: widget.boardId, client: widget.client.httpClient, sharer: widget.sharer);
  List<Person> _people = const [];
  bool _peopleLoaded = false;
  bool _uploading = false;
  bool _wasLive = false;
  StreamSubscription<BoardNotice>? _notices;
  late final BoardCache _cache = widget.cache ?? StachelCache.boards;
  late final BoardImages _images =
      widget.images ??
      HttpBoardImages(
        base: _boards.base,
        token: () => _boards.sessionToken(),
        client: widget.client.httpClient,
        disk: StachelCache.tryDir('images'),
        pinned: StachelCache.tryDir('offline/images'),
      );
  final _viewKey = GlobalKey<BoardViewState>();
  bool _starting = true;
  Timer? _saveTimer;
  int _savedVersion = -1;
  bool _leftForLogin = false;

  /// Why the login is gone (`invalid_token` of a host app, `session_expired` of the Stachel app): its text.
  String _lostCode = 'invalid_token';

  @override
  void initState() {
    super.initState();
    StachelClipboard.install(); // D21: text/html with the objects on Android
    WidgetsBinding.instance.addObserver(this);
    _controller.addListener(_changed);
    _editor.addListener(_editorChanged);
    _notices = _controller.notices.listen(_notice);
    _hintSub = _ui.hints.messages.listen(_snack);
    // connection lost/back after the web's delays (B06), running web actions (O04)
    _ui.hints.addListener(_editorChanged);
    unawaited(_start());
    unawaited(loadStachelBoardPrefs());
    // N10: board menu „Offline verfügbar“ (state + refreshes with this board's session)
    StachelOffline.instance.attach(_boards, widget.client.httpClient);
    unawaited(StachelOffline.instance.load());
  }

  /// Cached state first (a local file, decoded in the background), then connect – with resume from the cached
  /// revision.
  Future<void> _start() async {
    try {
      final cached = await _cache.load(widget.boardId);
      // saved again once the server confirmed it (new „Stand von …“ even without changes)
      if (cached != null && mounted) _controller.restore(cached);
    } catch (_) {}
    if (!mounted) return;
    setState(() => _starting = false);
    await _controller.start();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final s = _source;
      if (s is NativeBoardSource) s.reconnectNow();
    } else if (state == AppLifecycleState.paused) {
      _saveNow();
      // the app may be killed in the background: unconfirmed changes stay on the device (sent on the next open)
      unawaited(_controller.persistPending());
    }
  }

  // ---- people (@mentions) ------------------------------------------------------------------------------------------

  Future<void> _loadPeople() async {
    if (_peopleLoaded) return;
    _peopleLoaded = true;
    try {
      final list = widget.people != null
          ? await widget.people!()
          : [for (final u in await _boards.users()) Person(u.key, u.name)];
      if (mounted) setState(() => _people = list);
    } catch (_) {
      _peopleLoaded = false; // offline: next time
    }
  }

  List<Person> get _mentionPeople => _editor.mentionPeople(_people);

  // ---- comments ----------------------------------------------------------------------------------------------------

  Future<void> _openThread(String id) async {
    await _loadPeople();
    if (!mounted) return;
    // web: the open thread's pin shows whatever the filter (a done one from the list, pins off)
    setState(() => _collab.openThread = id);
    final rescue = await showStachelThread(
      context,
      editor: _editor,
      threadId: id,
      people: _mentionPeople,
      onShowObject: () => _showThread(id),
      onReport: (t, m) => showStachelReportSheet(
        context,
        api: _moderation,
        target: StachelReportTarget(
          boardId: widget.boardId,
          commentId: t.id,
          messageId: m.id,
          label: 'Kommentar von ${m.name.isEmpty ? 'Unbekannt' : m.name}',
        ),
      ),
    );
    if (mounted && _collab.openThread == id) setState(() => _collab.openThread = null);
    if (rescue == null || !mounted) return;
    // web `rescueDraft`: the reply stays as a new comment at the same place and goes to the clipboard as well
    var copied = true;
    try {
      await Clipboard.setData(ClipboardData(text: rescue.draft));
    } catch (_) {
      copied = false;
    }
    if (!mounted) return;
    _snack(
      'Der Kommentar wurde gelöscht. Deine Antwort bleibt als neuer Kommentar offen'
      '${copied ? ' und liegt in der Zwischenablage' : ''}.',
    );
    final nid = await newStachelComment(context, _editor, rescue.at, _mentionPeople, initial: rescue.draft);
    if (nid != null && mounted) _snack('Kommentar gespeichert.');
  }

  /// Camera on the thread's pin (its object, or the point).
  void _showThread(String id) {
    final t = _editor.threads.where((x) => x.id == id).firstOrNull;
    if (t == null) return;
    final o = t.objectId == null ? null : _controller.state[t.objectId!];
    if (o != null) {
      _viewKey.currentState?.focusObject(o.id);
    } else {
      final size = _viewKey.currentContext?.size;
      if (size != null) {
        _camera.value = Camera.fit(
          Rect.fromCenter(center: t.position((i) => _controller.state[i]), width: 300, height: 300),
          size,
        );
      }
    }
  }

  Future<void> _newComment(CommentAnchor at) async {
    _editor.tool = BoardTool.select;
    await _loadPeople();
    if (!mounted) return;
    final id = await newStachelComment(context, _editor, at, _mentionPeople);
    if (id != null && mounted) _snack('Kommentar gespeichert.');
  }

  /// Comment on the selected object (context bar): pinned at its top right corner.
  Future<void> _commentOnSelection() async {
    final o = _editor.single;
    if (o == null) return;
    await _newComment(CommentAnchor(o.x + o.w, o.y, objectId: o.id, dx: o.w, dy: 0));
  }

  void _togglePins() => setState(() => _collab.showPins = !_collab.showPins);

  /// „Hier kommentieren“ (long press on the empty board): free at that point.
  Future<void> _commentAt(Offset world) => _newComment(CommentAnchor(world.dx, world.dy));

  Future<void> _commentList() async {
    await _loadPeople();
    if (!mounted) return;
    await showStachelCommentList(
      context,
      editor: _editor,
      people: _mentionPeople,
      // web: the panel's filter also picks the pins on the board („Erledigt“ shows the done ones)
      filter: _collab.filter,
      onFilter: (f) => setState(() => _collab.filter = f),
      onOpen: (t) {
        _showThread(t.id);
        unawaited(_openThread(t.id));
      },
    );
  }

  /// Unread mentions of me, newest first (for „Du wurdest erwähnt“ and the comment counter).
  List<(CommentThread, CommentMessage)> get _unreadMentions {
    final me = _controller.user?.key;
    if (me == null) return const [];
    return unreadMentions(_collab.threads, me, readStateOf(_controller.state.ext, me));
  }

  // ---- frames, connector label -------------------------------------------------------------------------------------

  /// Frame list of the package (P4: preview, reorder, present).
  Future<void> _frameList() async => _ui.openRegisteredSheet(context, framesListSheet);

  Future<void> _renameFrame() async {
    final f = _editor.single;
    if (f == null || f.type != 'frame') return;
    final title = await askStachelBoardTitle(
      context,
      heading: 'Rahmen benennen',
      action: 'SPEICHERN',
      initial: f.title ?? '',
    );
    if (title != null && mounted) _editor.renameFrame(f.id, title);
  }

  Future<void> _editLabel() async {
    final c = _editor.single;
    if (c == null || c.type != 'connector') return;
    final ctl = TextEditingController(text: c.displayText);
    final v = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Beschriftung'),
        content: TextField(
          key: const Key('stachelLabelField'),
          controller: ctl,
          autofocus: true,
          maxLines: 3,
          minLines: 1,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('ABBRECHEN')),
          FilledButton(
            key: const Key('stachelLabelSave'),
            onPressed: () => Navigator.of(ctx).pop(ctl.text),
            child: const Text('SPEICHERN'),
          ),
        ],
      ),
    );
    // the dialog still fades out with the field: the controller is left to the GC
    if (v != null && mounted) _editor.setLabel(_controller.state[c.id] ?? c, v.trim());
  }

  /// Writing in a mind node (plain text).
  bool get _mindEditing {
    final id = _editor.editingId;
    return id != null && _controller.state[id]?.type == 'mindnode';
  }

  // ---- images (E3): pick, prepare, upload with progress, offline-safe -------------------------------------------

  final _memUploads = <String, Uint8List>{};
  final _inMemory = <String, StachelUpload>{};
  bool _initialPhotoDone = false;
  bool _initialShareDone = false;

  Future<void> _pickImage([StachelPhotoSource? preset]) async {
    final source = preset ?? await askPhotoSource(context);
    if (source == null || !mounted) return;
    final picker = widget.photoPicker ?? ImagePickerPhotos();
    List<Uint8List> photos;
    try {
      // gallery: several at once like the web's file dialog (K01)
      photos = source == StachelPhotoSource.camera ? [?await picker.pick(source)] : await picker.pickMany();
    } catch (_) {
      _snack(
        source == StachelPhotoSource.camera
            ? 'Die Kamera ließ sich nicht öffnen.'
            : 'Die Galerie ließ sich nicht öffnen.',
      );
      return;
    }
    for (final (i, bytes) in photos.indexed) {
      if (!mounted) return;
      await addPhoto(bytes, offset: 32.0 * i);
    }
  }

  /// World center of what is shown.
  Offset _viewCenter() {
    final size = _viewKey.currentContext?.size ?? const Size(400, 600);
    return _camera.value.toWorld(size.center(Offset.zero));
  }

  /// Puts a photo onto the board: placeholder at a free spot in the middle of the view right away (for everyone:
  /// „… lädt hoch“), upload with progress, then the image object. Without a connection it waits (also across leaving
  /// the board / an app kill) and goes on later. [around] (P7: „Einfügen“ of a copied image) or [center] (X: a
  /// shared image): a board point instead of the middle of the view.
  ///
  /// Like the web's `addImages`: centered at [around] or the middle of the view, the n-th of several [offset] 32·n
  /// further (overlapping is fine, like in the browser); a shared image ([center], App-Extra) looks for a free spot.
  Future<void> addPhoto(Uint8List bytes, {Offset? around, Offset? center, double offset = 0}) async {
    final photo = await preparePhoto(bytes);
    if (!mounted) return;
    if (photo == null) return _snack('Das Bild lässt sich nicht lesen.');
    if (photo.bytes.length > 15 * 1024 * 1024) return _snack('Das Bild ist größer als 15 MB.');
    final size = boardImageSize(photo.width.toDouble(), photo.height.toDouble());
    final at = center != null
        ? freeSpot(_scene, center, size)
        : (around ?? _viewCenter()) - Offset(size.width / 2, size.height / 2) + Offset(offset, offset);
    final entry = StachelUpload(
      key: 'up_${BoardController.newId()}',
      board: widget.boardId,
      file: '',
      mime: photo.mime,
      width: photo.width,
      height: photo.height,
      x: at.dx,
      y: at.dy,
      w: size.width,
      h: size.height,
      color: photo.color,
      createdAt: DateTime.now(),
    );
    final stored = await _uploads.add(entry, photo.bytes);
    if (stored == null) {
      _inMemory[entry.key] = entry;
      _memUploads[entry.key] = photo.bytes;
    }
    // show where it lands
    final rect = Rect.fromLTWH(at.dx, at.dy, size.width, size.height);
    final view = _viewKey.currentContext?.size;
    if (view != null && !(Offset.zero & view).contains(_camera.value.toScreen(rect.center))) {
      _camera.value = Camera.fit(rect, view, padding: const FitPadding.all(48), maxZoomFit: 1);
    }
    _showPlaceholder(stored ?? entry);
    unawaited(_pumpUploads());
  }

  void _showPlaceholder(StachelUpload e, {double progress = 0, bool? waiting}) {
    if (!mounted) return; // the board was left meanwhile (the controller is gone)
    final list = [..._controller.uploads.value]..removeWhere((u) => u.key == e.key);
    final live = _source.connection.value == BoardConnection.live;
    list.add(
      BoardUpload(
        key: e.key,
        rect: Rect.fromLTWH(e.x, e.y, e.w, e.h),
        color: e.color,
        progress: progress,
        waiting: waiting ?? !live,
      ),
    );
    _controller.uploads.value = list;
  }

  void _dropPlaceholder(String key) {
    if (!mounted) return;
    _controller.uploads.value = [
      for (final u in _controller.uploads.value)
        if (u.key != key) u,
    ];
  }

  /// Works through the waiting uploads of this board (one after another) while live and editable.
  Future<void> _pumpUploads() async {
    if (_uploading || !mounted) return;
    _uploading = true;
    try {
      for (;;) {
        final queue = [...await _uploads.of(widget.boardId), ..._inMemory.values]
          ..sort((a, b) => a.createdAt.compareTo(b.createdAt));
        if (!mounted || queue.isEmpty) return;
        for (final e in queue) {
          _showPlaceholder(e, waiting: !_controller.canEdit || _source.connection.value != BoardConnection.live);
        }
        if (_source.connection.value != BoardConnection.live || !_controller.canEdit) return; // later (connection back)
        final e = queue.first;
        var current = e;
        if (current.imageId == null) {
          final bytes = _memUploads[e.key] ?? await _uploads.bytesOf(e);
          if (bytes == null) {
            await _forget(e);
            continue;
          }
          try {
            final img = await _boards.uploadImage(
              widget.boardId,
              bytes,
              mime: e.mime,
              onProgress: (p) {
                if (mounted) _showPlaceholder(e, progress: p, waiting: false);
              },
            );
            current = e.withImage(img.id);
            if (_inMemory.containsKey(e.key)) {
              _inMemory[e.key] = current;
            } else {
              await _uploads.update(current);
            }
          } on StachelException catch (err) {
            if (!mounted) return;
            if (err.code == 'network' || err.code == 'rate_limited') {
              _showPlaceholder(e, waiting: true);
              return; // stays queued; next try when the connection is back
            }
            await _forget(e);
            _snack(
              err.code == 'too_large'
                  ? 'Das Bild ist zu groß.'
                  : 'Das Bild konnte nicht hochgeladen werden: ${err.message}',
            );
            continue;
          }
        }
        if (!mounted) return;
        final id = _editor.insertImage(
          imageId: current.imageId!,
          width: current.width.toDouble(),
          height: current.height.toDouble(),
          color: current.color,
          topLeft: Offset(current.x, current.y),
        );
        if (id == null) return; // editing paused meanwhile: next time (the image is uploaded already)
        // the create op is in the (persisted) queue now: the upload entry can go
        await _controller.persistPending();
        await _forget(current);
      }
    } finally {
      _uploading = false;
    }
  }

  Future<void> _forget(StachelUpload e) async {
    _dropPlaceholder(e.key);
    _memUploads.remove(e.key);
    if (_inMemory.remove(e.key) == null) await _uploads.remove(e);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _saveTimer?.cancel();
    _saveNow();
    unawaited(_controller.persistPending());
    _controller.removeListener(_changed);
    _editor.removeListener(_editorChanged);
    unawaited(_notices?.cancel());
    unawaited(_hintSub?.cancel());
    _ui.dispose();
    _admin.dispose();
    _editor.dispose();
    _controller.dispose();
    final images = _images;
    if (widget.images == null && images is HttpBoardImages) images.dispose();
    _camera.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    if (_source.closeReason == 'invalid_token') {
      if (_leftForLogin) return;
      _leftForLogin = true;
      widget.client.loginLost(context, message: StachelException.forCode(_lostCode).message);
      return;
    }
    _scheduleSave();
    // live with the server's state (first time or connection back): waiting uploads go on
    final live = _source.connection.value == BoardConnection.live && _controller.loaded && !_controller.fromCache;
    if (live && !_wasLive) unawaited(_pumpUploads());
    _wasLive = live;
    final photo = widget.initialPhoto;
    if (photo != null && !_initialPhotoDone && _controller.loaded && !_controller.fromCache) {
      _initialPhotoDone = true;
      // after the first placement of the camera (fit all): the photo goes to the middle of the board
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(addPhoto(photo));
      });
    }
    final share = widget.initialShare;
    if (share != null && !_initialShareDone && _controller.loaded && !_controller.fromCache) {
      _initialShareDone = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        unawaited(placeStachelShare(context, _ui, share, center: _viewCenter(), addPhoto: addPhoto, message: _snack));
      });
    }
    setState(() {});
  }

  /// Keeps the confirmed state for offline use: soon after it first arrives, then a few seconds after changes stop.
  void _scheduleSave() {
    if (_controller.fromCache || _source.connection.value != BoardConnection.live) return;
    if (_controller.state.version == _savedVersion) return;
    _saveTimer?.cancel();
    _saveTimer = Timer(Duration(seconds: _savedVersion < 0 ? 1 : 4), _saveNow);
  }

  void _saveNow() {
    final entry = _controller.toCache(widget.boardId);
    if (entry == null || _controller.state.version == _savedVersion) return;
    _savedVersion = _controller.state.version;
    unawaited(_cache.save(entry));
  }

  void _editorChanged() {
    if (mounted) setState(() {});
  }

  /// Rejected or merged: a short hint (a rejected change is already rolled back).
  void _notice(BoardNotice n) {
    if (!mounted) return;
    switch (n.kind) {
      case 'conflict':
        _snack('Die Notiz wurde gleichzeitig geändert – dein Stand gilt, bitte kurz prüfen.');
      case 'rejected':
        _snack(switch (n.error) {
          'forbidden' when _controller.role == 'comment' => 'Du darfst auf diesem Board nur kommentieren.',
          'forbidden' => 'Du darfst dieses Board nur ansehen.',
          'rate_limited' => 'Zu viele Änderungen auf einmal – bitte kurz warten.',
          _ => 'Änderung nicht übernommen${n.message == null ? '' : ': ${n.message}'}',
        });
      default:
        break;
    }
  }

  void _snack(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _openInBrowser({String? objectId}) async {
    try {
      await widget.client.openInBrowser(board: widget.boardId, object: objectId, launcher: widget.launcher);
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) return widget.client.loginLost(context, message: e.message);
      _snack(e.message);
    }
  }

  Future<void> _copyLink({String? objectId}) async {
    await Clipboard.setData(
      ClipboardData(
        text: stachelBoardUrl(widget.boardId, objectId: objectId, base: _boards.base),
      ),
    );
    if (mounted) _snack(objectId == null ? 'Link zum Board kopiert.' : 'Link zum Objekt kopiert.');
  }

  Future<void> _rename() async {
    final title = await askStachelBoardTitle(
      context,
      heading: 'Board umbenennen',
      action: 'UMBENENNEN',
      initial: _title ?? '',
    );
    if (title == null || title.isEmpty || title == _title || !mounted) return;
    try {
      await _boards.renameBoard(widget.boardId, title);
      // the new title comes live (`board.renamed`)
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) return widget.client.loginLost(context, message: e.message);
      _snack(e.message);
    }
  }

  /// „Teilen …“ (instances with own accounts): the sharing sheet; leaving the board there closes it.
  Future<void> _share() async {
    await showStachelShareSheet(
      context,
      api: _boards,
      boardId: widget.boardId,
      title: _title,
      me: _controller.user?.key,
      moderation: _moderation,
      sharer: widget.sharer,
      onLeft: () {
        if (mounted) Navigator.of(context).maybePop();
      },
      onLoginLost: (e) => widget.client.loginLost(context, message: e.message),
    );
  }

  /// P6: another board (copy, copy of a version) or this one afresh (restored from the trash) replaces this screen.
  Future<void> _openOther(String id, String title) async {
    if (!mounted) return;
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) =>
            widget.otherBoard?.call(id, title) ??
            StachelBoardScreen(
              client: widget.client,
              boardId: id,
              title: title,
              boardsApi: widget.boardsApi,
              launcher: widget.launcher,
              sharer: widget.sharer,
            ),
      ),
    );
  }

  void _retry() {
    final s = _source;
    if (s is NativeBoardSource) s.reconnectNow();
  }

  String? get _title => _controller.title ?? widget.title;

  /// Back while writing ends the writing. Changes still waiting for the connection stay on the device (E3) and go
  /// out the next time the board is open – leaving loses nothing, a hint says so.
  void _back() {
    if (_editor.editingId != null) {
      _viewKey.currentState?.finishEditing();
      return;
    }
    if (_editor.tool != BoardTool.select) {
      _editor.tool = BoardTool.select;
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _editor.editingId == null && _editor.tool == BoardTool.select,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          _back();
          return;
        }
        final waiting = _controller.queuedCount + _controller.uploads.value.length;
        if (waiting > 0) {
          final messenger = ScaffoldMessenger.maybeOf(context);
          messenger?.showSnackBar(
            SnackBar(
              key: const Key('stachelLeftWaiting'),
              content: Text(
                '${waiting == 1 ? 'Eine Änderung wartet' : '$waiting Änderungen warten'} auf die Verbindung – '
                'sie werden gesendet, sobald du das Board wieder öffnest.',
              ),
            ),
          );
        }
      },
      child: _scaffold(),
    );
  }

  /// The look [_ui] was built with (light/dark).
  late bool _uiDark = Sk.dark;

  /// Presenting or UI hidden (P4): no title bar, tool bar or context bar.
  bool get _chromeHidden => BoardViewPrefs.of(_ui).chromeHidden.value;

  Widget _scaffold() => ValueListenableBuilder<bool>(
    valueListenable: BoardViewPrefs.of(_ui).chromeHidden,
    builder: (context, hidden, _) => _scaffoldWith(hidden: hidden),
  );

  Widget _scaffoldWith({required bool hidden}) {
    // UX-Review P14: the system switched between light and dark – the board UI takes the new colors
    if (_uiDark != Sk.dark) {
      _uiDark = Sk.dark;
      _ui.theme = stachelBoardTheme;
    }
    return Scaffold(
      appBar: hidden
          ? null
          : AppBar(
              // UX-Review P1: the title keeps ≥ 60 % of the width – undo/redo sit in the tool bar, „Alles zeigen“ in
              // the zoom pill and the board's long-press menu, the avatars are a tight stack
              leadingWidth: 48,
              titleSpacing: 0,
              title: StachelBoardTitle(
                title: _title ?? 'Board',
                template: _admin.template,
                onTap: _controller.mayEdit && _controller.loaded ? _rename : null,
              ),
              actions: [
                // web ShareBar: „Nur ansehen“ / „Kommentieren“ when the role does not allow editing
                if (_controller.loaded && !_controller.mayEdit) StachelRoleBadge(role: _controller.role, compact: true),
                // P5 (B03): avatars with status; tap = the list „Auf dem Board“ (follow, „Alle zu mir holen“)
                CollabPresenceBar(ui: _ui, compact: true),
                IconButton(
                  key: const Key('stachelBoardMenu'),
                  tooltip: 'Mehr',
                  icon: const Icon(Icons.more_vert),
                  onPressed: () => showBoardMenu(context, _ui, MenuTarget.board, MenuAt(_viewCenter())),
                ),
              ],
              bottom: PreferredSize(preferredSize: const Size.fromHeight(5), child: Sk.stripe(height: 5)),
            ),
      body: BoardUiScope(ui: _ui, child: _starting ? const SizedBox.shrink() : _body()),
    );
  }

  Widget _body() {
    final c = _controller;
    final connection = _source.connection.value;
    final reason = _source.closeReason;
    if (!c.loaded) {
      if (connection == BoardConnection.closed && reason != null) return _closedPage(reason);
      if (connection == BoardConnection.offline) {
        return StachelStatePage(
          key: const Key('stachelBoardOffline'),
          icon: Icons.cloud_off,
          title: 'Keine Verbindung',
          text:
              'Dieses Board ist noch nicht auf dem Handy gespeichert. Sobald das Netz wieder da ist, lädt es von '
              'selbst.',
          actions: [FilledButton(onPressed: _retry, child: const Text('ERNEUT VERSUCHEN'))],
        );
      }
      return const StachelBoardLoading(key: Key('stachelBoardLoading'));
    }
    final banner = _banner();
    final editing = _editor.editingId != null;
    final hidden = _chromeHidden;
    final showTools = c.mayEdit && !editing && !hidden;
    // role `comment`: one button instead of the tool bar (web ReadOnlyGuard „Kommentar hinzufügen“)
    final showCommentBar = !c.mayEdit && c.mayComment && !editing && !hidden;
    final hint = hidden ? null : activeToolHint(_ui);
    final mentions = c.loaded && !editing && !hidden && c.mayComment
        ? _unreadMentions
        : const <(CommentThread, CommentMessage)>[];
    // `view` cannot mark mentions read (the server rejects every op): no notice that would never go away
    final mention = mentions.isEmpty ? null : mentions.first.$1.id;
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              Positioned.fill(
                child: BoardView(
                  key: _viewKey,
                  controller: c,
                  editor: _editor,
                  images: _images,
                  fonts: BoardFonts(regular: Sk.body, condensed: Sk.cond),
                  initialFocus: widget.objectId,
                  onFocusMissing: () => _snack('Das verlinkte Objekt gibt es auf diesem Board nicht mehr.'),
                  onLongPress: (world) => showBoardMenu(context, _ui, MenuTarget.canvas, MenuAt(world)),
                  onObjectMenu: (world, id) =>
                      showBoardMenu(context, _ui, MenuTarget.object, MenuAt(world, objectId: id)),
                  collab: _collab,
                  onComment: (id) => unawaited(_openThread(id)),
                  onCommentAt: (at) => unawaited(_newComment(at)),
                ),
              ),
              // overlays of the packages (voting, timer, laser … – F2 registry) and the hint pills
              Positioned.fill(child: BoardOverlays(ui: _ui)),
              Positioned.fill(
                // the web hides the empty board's hint for `view`/`comment` (it invites to create)
                child: BoardStatusHints(ui: _ui, showEmpty: !editing && hint == null && c.mayEdit),
              ),
              // UX-Review P2: banner, search, vote/timer, mention and status pills stack on top instead of covering
              // each other (BoardTopSlot)
              if (banner != null)
                Positioned.fill(
                  child: BoardTopSlot(
                    ui: _ui,
                    order: BoardTopSlot.bannerOrder,
                    gap: 0,
                    side: 0,
                    stretch: true,
                    child: banner,
                  ),
                ),
              if (mention != null)
                Positioned.fill(
                  child: BoardTopSlot(
                    ui: _ui,
                    order: BoardTopSlot.mentionOrder,
                    child: StachelMentionChip(
                      mentions: mentions,
                      onOpen: () {
                        _showThread(mention);
                        unawaited(_openThread(mention));
                      },
                      onClose: _editor.markMentionsRead,
                    ),
                  ),
                ),
              if (hint != null)
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 10,
                  child: Center(
                    child: Container(
                      key: const Key('stachelToolHint'),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      // over the board, which stays light: the dark ink also in the dark look
                      decoration: BoxDecoration(color: Sk.canvasInk, borderRadius: BorderRadius.circular(6)),
                      child: Text(hint, style: const TextStyle(color: Colors.white, fontSize: 13)),
                    ),
                  ),
                )
              // no context bar for `view`/`comment` (web: hidden there; the object menu keeps link, browser, comment)
              else if (!editing && !hidden && c.mayEdit && _editor.selection.value.isNotEmpty)
                Positioned(left: 8, right: 8, bottom: 8, child: _contextBar()),
            ],
          ),
        ),
        if (editing)
          StachelEditBar(
            writer: _editor.writerOf(_editor.editingId!, fullName: true),
            onDone: () => _viewKey.currentState?.finishEditing(),
            // mind nodes are plain text: no format bar, but Unterthema / Gleiche Ebene
            editor: _mindEditing ? null : _editor,
            extra: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // UX-A1 (P1): Rückgängig/Wiederholen also while writing (web C20: ends the writing first)
                StachelUndoRedo(
                  controller: _controller,
                  enabled: _editor.editable,
                  beforeHistory: () => _viewKey.currentState?.finishEditing(),
                ),
                _mindEditing ? MindEditActions(ui: _ui) : NextNoteButton(ui: _ui, compact: true),
              ],
            ),
          )
        else if (showTools)
          BoardToolbar(
            ui: _ui,
            enabled: _editor.editable,
            // UX-Review P1: Rückgängig/Wiederholen under the thumb
            history: true,
            beforeHistory: () => _viewKey.currentState?.finishEditing(),
          )
        else if (showCommentBar)
          _commentBar(),
      ],
    );
  }

  /// Role `comment`: „Kommentar hinzufügen“ switches the comment tool on and off (web `share-commentbar`).
  Widget _commentBar() {
    final active = _editor.tool == BoardTool.comment;
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: Center(
          child: FilledButton.icon(
            key: const Key('stachelCommentTool'),
            style: FilledButton.styleFrom(
              backgroundColor: active ? Sk.pink : Sk.ink,
              foregroundColor: active ? Colors.white : Sk.surface,
            ),
            onPressed: _editor.commentable ? () => _editor.tool = active ? BoardTool.select : BoardTool.comment : null,
            icon: Icon(active ? Icons.touch_app_outlined : Icons.add_comment_outlined),
            label: Text(active ? 'Kommentieren: auf das Board tippen' : 'Kommentar hinzufügen'),
          ),
        ),
      ),
    );
  }

  Widget _contextBar() => BoardContextBar(ui: _ui);

  /// Banner over a shown board; null = live and fine.
  Widget? _banner() {
    final c = _controller;
    final deletedBy = c.deletedBy;
    if (deletedBy != null) return _trashNotice(deletedBy);
    final stale = c.staleSince;
    final when = stale == null ? null : 'Stand von ${stachelWhen(stale)}';
    return switch (_source.connection.value) {
      BoardConnection.live => null,
      BoardConnection.connecting =>
        c.fromCache
            ? StachelStatusBanner(
                key: const Key('stachelBoardBanner'),
                icon: Icons.history,
                color: Sk.surface,
                text: when ?? 'Gespeicherter Stand',
                detail: 'Wird aktualisiert …',
              )
            : null,
      BoardConnection.offline when c.fromCache || !_ui.hints.everLive || _ui.hints.connectionLost => StachelStatusBanner(
        key: const Key('stachelBoardBanner'),
        icon: Icons.cloud_off,
        text: c.queuedCount > 0
            ? 'Keine Verbindung – ${c.queuedCount == 1 ? 'eine Änderung wartet' : '${c.queuedCount} Änderungen warten'}'
            : 'Keine Verbindung – zeige gespeicherten Stand',
        detail: [
          ?when,
          if (c.mayEdit && !c.canEdit && !c.fromCache) 'Bearbeiten pausiert',
          'verbinde neu …',
        ].join(' · '),
        action: TextButton(onPressed: _retry, child: const Text('JETZT')),
      ),
      BoardConnection.offline => null,
      BoardConnection.closed => switch (_source.closeReason) {
        null => null,
        final r => StachelStatusBanner(
          key: const Key('stachelBoardBanner'),
          icon: Icons.error_outline,
          color: Sk.danger,
          text: _closedText(r),
          detail: when,
        ),
      },
    };
  }

  /// P6 B08: in the trash while open – details and „Wiederherstellen“ (then the board opens afresh).
  Widget _trashNotice(String deletedBy) => StachelTrashNotice(
    api: _boards,
    boardId: widget.boardId,
    deletedBy: deletedBy,
    events: _boards.events(),
    onReopen: () => _openOther(widget.boardId, _title ?? ''),
  );

  String _closedText(String reason) => switch (reason) {
    'unknown_board' => 'Dieses Board gibt es nicht (mehr).',
    'board_deleted' => 'Dieses Board liegt im Papierkorb.',
    'no_access' => 'Du hast keinen Zugriff auf dieses Board.',
    'upgrade_required' => 'Bitte die ${widget.client.appName} aktualisieren.',
    'not_logged_in' || 'invalid_token' => 'Stachel hat die Anmeldung nicht angenommen.',
    final r => 'Verbindung beendet ($r).',
  };

  Widget _closedPage(String reason) => reason == 'board_deleted'
      ? Column(
          key: const Key('stachelBoardClosed'),
          children: [
            _trashNotice(''),
            const Spacer(),
            OutlinedButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('ZURÜCK')),
            const SizedBox(height: 24),
          ],
        )
      : StachelStatePage(
          key: const Key('stachelBoardClosed'),
          icon: reason == 'upgrade_required' ? Icons.system_update : Icons.push_pin_outlined,
          title: switch (reason) {
            'unknown_board' => 'Board nicht gefunden',
            'board_deleted' => 'Im Papierkorb',
            'upgrade_required' => 'Update nötig',
            _ => 'Board nicht verfügbar',
          },
          text: _closedText(reason),
          actions: [
            OutlinedButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('ZURÜCK')),
            if (reason != 'upgrade_required' && reason != 'unknown_board')
              FilledButton(onPressed: _openInBrowser, child: const Text('IM BROWSER ÖFFNEN')),
          ],
        );
}

/// German name of an object for the selection panel: kind, plus the first line of its text (type registry).
String objectLabel(BoardObject o) => describeObject(stachelBoardRegistry, o);

/// Look of the board UI in the app's style ([Sk]: ink, accent, condensed font, [SkPanel]); in the dark look the bars
/// and sheets are dark, things on the board keep [Sk.canvasInk] (UX-Review P14).
BoardUiTheme get stachelBoardTheme => BoardUiTheme(
  ink: Sk.ink,
  accent: Sk.pink,
  accentDark: Sk.pinkDark,
  grey: Sk.grey,
  danger: Sk.danger,
  surface: Sk.surface,
  canvasInk: Sk.canvasInk,
  condensedFont: Sk.cond,
  panel: ({Key? key, required Widget child, EdgeInsetsGeometry padding = const EdgeInsets.all(12)}) =>
      SkPanel(key: key, padding: padding, child: child),
);

/// The host services of the board screen for the registry entries (F2).
class _Host extends StachelAppHost
    with StachelAdminHost, StachelDocumentsHost, StachelClientHost, StachelModerationHost, StachelPrivateHost {
  _Host(this.s);
  final _StachelBoardScreenState s;

  @override
  HttpStachelBoardsApi get privateApi => s._boards;

  @override
  StachelBoardAdmin get admin => s._admin;
  @override
  StachelDocuments get documents => s._documents;
  @override
  Future<void> addPhotoAt(Uint8List bytes, Offset at) => s.addPhoto(bytes, around: at);
  @override
  StachelClient get client => s.widget.client;
  @override
  String get boardTitle => s._title ?? 'Board';
  @override
  String get stachelBase => s._boards.base;
  @override
  StachelModerationApi get moderation => s._moderation;
  @override
  String? get myKey => s._controller.user?.key;

  @override
  String get boardId => s.widget.boardId;
  @override
  Future<void> copyLink({String? objectId}) => s._copyLink(objectId: objectId);
  @override
  Future<void> openInBrowser({String? objectId}) => s._openInBrowser(objectId: objectId);
  @override
  void showMessage(String text) => s._snack(text);
  @override
  Future<void> pickImage({StachelPhotoSource? source}) => s._pickImage(source);
  @override
  Future<void> commentOnSelection() => s._commentOnSelection();
  @override
  Future<void> commentAt(Offset world) => s._commentAt(world);
  @override
  Future<void> editConnectorLabel() => s._editLabel();
  @override
  Future<void> renameFrame() => s._renameFrame();
  @override
  Future<void> showFrames() => s._frameList();
  @override
  Future<void> showComments() => s._commentList();
  @override
  void togglePins() => s._togglePins();
  @override
  bool get pinsShown => s._collab.showPins;
  @override
  int get openThreads => s._collab.threads.where((t) => !t.resolved).length;
  @override
  int get unreadMentions => s._unreadMentions.length;
  @override
  Future<void> renameBoard() => s._rename();
  @override
  Future<void> shareBoard() => s._share();
  // P2: small settings on the device (recently used emoji, like the web's localStorage)
  @override
  Future<String?> readSetting(String key) async => (await SharedPreferences.getInstance()).getString(key);
  @override
  Future<void> writeSetting(String key, String value) async =>
      (await SharedPreferences.getInstance()).setString(key, value);
  // P5: names for „von Mara“ (web /api/users), the timer's three tones like the web
  @override
  Future<List<Person>> people() async {
    await s._loadPeople();
    return s._people;
  }

  @override
  Future<void> playChime() => playStachelChime();
}

/// „Board wird geladen …“; after 5 s without the server the web's explanation underneath (web `ConnectionNotice`).
class StachelBoardLoading extends StatefulWidget {
  const StachelBoardLoading({super.key, this.slowAfter = const Duration(seconds: 5)});
  final Duration slowAfter;

  @override
  State<StachelBoardLoading> createState() => _StachelBoardLoadingState();
}

class _StachelBoardLoadingState extends State<StachelBoardLoading> {
  late final Timer _timer = Timer(widget.slowAfter, () {
    if (mounted) setState(() => _slow = true);
  });
  bool _slow = false;

  @override
  void initState() {
    super.initState();
    _timer;
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 12),
        const Text('Board wird geladen …'),
        if (_slow)
          Padding(
            padding: EdgeInsets.fromLTRB(24, 6, 24, 0),
            child: Text(
              'Der Server antwortet noch nicht. Wir versuchen es weiter.',
              key: Key('stachelBoardSlow'),
              textAlign: TextAlign.center,
              style: TextStyle(color: Sk.grey),
            ),
          ),
      ],
    ),
  );
}

/// „Jonas: „Kannst du …““ of the web's mention notice: everyone who mentioned me, the newest message (≤ 60 characters).
String mentionQuote(List<(CommentThread, CommentMessage)> unread) {
  if (unread.isEmpty) return '';
  final from = <String>[];
  for (final (_, m) in unread) {
    if (!from.contains(m.name)) from.add(m.name);
  }
  final who = from.length == 1 ? from.first : '${from.sublist(0, from.length - 1).join(', ')} und ${from.last}';
  final t = unread.first.$2.text;
  return '$who: „${t.length > 60 ? '${t.substring(0, 59)}…' : t}“';
}

/// „Du wurdest erwähnt“ (web `MentionNotice`) as a slim chip in the stack on top (UX-Review P2): @, who and what
/// (≤ 60 characters), ANSEHEN, ✕. After [collapseAfter] it shrinks to „@ 1“ (tap = open the thread), so it does not
/// keep covering the board; a new mention shows the whole chip again.
class StachelMentionChip extends StatefulWidget {
  const StachelMentionChip({
    super.key,
    required this.mentions,
    required this.onOpen,
    required this.onClose,
    this.collapseAfter = const Duration(seconds: 8),
  });

  final List<(CommentThread, CommentMessage)> mentions;
  final VoidCallback onOpen;
  final VoidCallback onClose;
  final Duration collapseAfter;

  @override
  State<StachelMentionChip> createState() => _StachelMentionChipState();
}

class _StachelMentionChipState extends State<StachelMentionChip> {
  Timer? _timer;
  bool _small = false;
  String? _newest;

  @override
  void initState() {
    super.initState();
    _restart();
  }

  @override
  void didUpdateWidget(StachelMentionChip old) {
    super.didUpdateWidget(old);
    if (_key != _newest) _restart();
  }

  String get _key => widget.mentions.isEmpty ? '' : widget.mentions.first.$2.id;

  void _restart() {
    _newest = _key;
    _small = false;
    _timer?.cancel();
    _timer = Timer(widget.collapseAfter, () {
      if (mounted) setState(() => _small = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.mentions.length;
    const white = TextStyle(color: Colors.white, fontWeight: FontWeight.w700);
    if (_small) {
      return Tooltip(
        message: n == 1 ? 'Du wurdest erwähnt' : 'Du wurdest $n× erwähnt',
        child: Material(
          key: const Key('stachelMentioned'),
          color: Sk.pink,
          shape: const StadiumBorder(),
          child: InkWell(
            key: const Key('stachelMentionedSmall'),
            customBorder: const StadiumBorder(),
            onTap: widget.onOpen,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Text('@ $n', style: white),
            ),
          ),
        ),
      );
    }
    return Material(
      key: const Key('stachelMentioned'),
      color: Sk.pink,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: widget.onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 0, 0),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                '@',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16),
              ),
              const SizedBox(width: 8),
              // web MentionNotice: who and what (≤ 60), how often, Ansehen, ✕
              Flexible(
                child: Text(
                  '${n == 1 ? '' : '$n× · '}${mentionQuote(widget.mentions)}',
                  key: const Key('stachelMentionedQuote'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
              const SizedBox(width: 8),
              const Text('ANSEHEN', style: white),
              IconButton(
                key: const Key('stachelMentionedClose'),
                tooltip: 'Hinweis schließen',
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close, color: Colors.white, size: 18),
                onPressed: widget.onClose,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
