import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_overview.dart';
import 'stachel_board_widgets.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

// Board management from the open board (audit P6): the app's side of the package's `BoardAdminHost` – copies and
// templates, versions, export/share, preview image, AI access – plus the board-screen parts of P6: the hint
// „Vorlage“ next to the title (B02/B16) and the trash notice with „Wiederherstellen“ (B08).

/// Shares files and text (tests replace it).
class StachelSharer {
  const StachelSharer();

  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async {
    final dir = await getTemporaryDirectory();
    final safe = fileName.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
    final path = '${dir.path}${Platform.pathSeparator}$safe';
    await File(path).writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(path, mimeType: mimeType, name: safe)],
        subject: safe,
      ),
    );
  }

  Future<void> shareText(String text, {String? subject}) =>
      SharePlus.instance.share(ShareParams(text: text, subject: subject));
}

/// The [BoardAdminHost] services of one board screen over [HttpStachelBoardsApi]/[StachelBoardAdminApi].
class StachelBoardAdmin implements BoardAdminHost {
  StachelBoardAdmin({
    required this.api,
    required this.boardId,
    required String Function() title,
    required this.openBoard,
    bool? template,
    this.sharer = const StachelSharer(),
  }) : _title = title,
       template = ValueNotifier(template ?? false) {
    // a board link (`/b/<id>`) does not say whether it is a template: look it up once
    if (template == null) unawaited(_lookUpTemplate());
  }

  final StachelBoardAdminApi api;
  final String boardId;
  final String Function() _title;

  /// Opens another board in place of this one (copy, version copy).
  final Future<void> Function(String id, String title) openBoard;
  final StachelSharer sharer;

  /// B02/B16: this board is a template (hint next to the title).
  final ValueNotifier<bool> template;

  Future<void> _lookUpTemplate() async {
    final a = api;
    if (a is! StachelBoardsApi) return;
    try {
      final list = await (a as StachelBoardsApi).boards();
      template.value = list.where((b) => b.id == boardId).firstOrNull?.template ?? false;
    } catch (_) {}
  }

  void dispose() => template.dispose();

  @override
  String errorText(Object error) => switch (error) {
    StachelException(:final message) => message,
    _ => 'Das hat nicht geklappt. Bitte versuch es noch einmal.',
  };

  @override
  bool get isTemplate => template.value;

  @override
  String get boardTitle => _title();

  @override
  Future<void> duplicateBoard() async {
    final copy = await api.duplicateBoard(boardId);
    await openBoard(copy.id, copy.title);
  }

  @override
  Future<void> saveAsTemplate() => api.duplicateBoard(boardId, template: true);

  @override
  Future<List<BoardVersion>> listVersions() async => [
    for (final v in await api.versions(boardId)) ?BoardVersion.fromJson(v),
  ];

  @override
  Future<BoardVersion> saveVersion(String name) async =>
      BoardVersion.fromJson(await api.saveVersion(boardId, name)) ?? (throw StachelException.forCode('error'));

  @override
  Future<BoardVersion> renameVersion(String id, String name) async =>
      BoardVersion.fromJson(await api.renameVersion(boardId, id, name)) ?? (throw StachelException.forCode('error'));

  @override
  Future<bool> restoreVersion(String id) => api.restoreVersion(boardId, id);

  @override
  Future<void> openVersionCopy(String id, String title) async {
    final copy = await api.copyVersion(boardId, id, title);
    await openBoard(copy.id, copy.title);
  }

  @override
  Future<Map<String, Object?>> versionSnapshot(String id) => api.versionSnapshot(boardId, id);

  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) =>
      sharer.shareFile(bytes, fileName, mimeType);


  @override
  Future<McpTokens> listTokens() async {
    final j = await api.tokens();
    final list = j['tokens'];
    return McpTokens([
      for (final t in (list is List ? list : const [])) ?McpToken.fromJson(t),
    ], j['mcpUrl'] is String ? j['mcpUrl'] as String : '');
  }

  @override
  Future<McpNewToken> createToken(String label) async {
    final j = await api.createToken(label);
    final token = McpToken.fromJson(j['token']);
    final secret = j['secret'];
    if (token == null || secret is! String) throw StachelException.forCode('error');
    return McpNewToken(token: token, secret: secret, mcpUrl: j['mcpUrl'] is String ? j['mcpUrl'] as String : '');
  }

  @override
  Future<void> revokeToken(String id) => api.revokeToken(id);

  // Q2: own templates (gallery „Meine Vorlagen“, „Auswahl als Vorlage speichern …“)
  Future<List<Object?>> listOwnTemplates() => api.ownTemplates();
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects) =>
      api.saveOwnTemplate(name, objects);
  Future<void> deleteOwnTemplate(String id) => api.deleteOwnTemplate(id);

  /// Templates of the instance (gallery, category of the instance).
  Future<Object?> instanceTemplates() => api.instanceTemplates();

  @override
  Future<void> shareText(String text, {String? subject}) => sharer.shareText(text, subject: subject);

  @override
  Future<void> copyText(String text) => Clipboard.setData(ClipboardData(text: text));
}

/// The board host of the screen forwards the P6 services (and Q2's own templates, the instance's templates) to [admin].
mixin StachelAdminHost on BoardHost implements BoardAdminHost, OwnTemplatesHost, InstanceTemplatesHost {
  StachelBoardAdmin get admin;

  @override
  String errorText(Object error) => admin.errorText(error);
  @override
  bool get isTemplate => admin.isTemplate;
  @override
  String get boardTitle => admin.boardTitle;
  @override
  Future<void> duplicateBoard() => admin.duplicateBoard();
  @override
  Future<void> saveAsTemplate() => admin.saveAsTemplate();
  @override
  Future<List<BoardVersion>> listVersions() => admin.listVersions();
  @override
  Future<BoardVersion> saveVersion(String name) => admin.saveVersion(name);
  @override
  Future<BoardVersion> renameVersion(String id, String name) => admin.renameVersion(id, name);
  @override
  Future<bool> restoreVersion(String id) => admin.restoreVersion(id);
  @override
  Future<void> openVersionCopy(String id, String title) => admin.openVersionCopy(id, title);
  @override
  Future<Map<String, Object?>> versionSnapshot(String id) => admin.versionSnapshot(id);
  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) =>
      admin.shareFile(bytes, fileName, mimeType);
  @override
  Future<McpTokens> listTokens() => admin.listTokens();
  @override
  Future<McpNewToken> createToken(String label) => admin.createToken(label);
  @override
  Future<void> revokeToken(String id) => admin.revokeToken(id);
  @override
  Future<void> shareText(String text, {String? subject}) => admin.shareText(text, subject: subject);
  @override
  Future<void> copyText(String text) => admin.copyText(text);
  @override
  Future<List<Object?>> listOwnTemplates() => admin.listOwnTemplates();
  @override
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects) =>
      admin.saveOwnTemplate(name, objects);
  @override
  Future<void> deleteOwnTemplate(String id) => admin.deleteOwnTemplate(id);
  @override
  Future<Object?> instanceTemplates() => admin.instanceTemplates();
}

/// B02/B16: title of the board with the hint „Vorlage“ for templates; tapping it renames (B01: the web edits the title
/// inline, the phone opens the dialog).
class StachelBoardTitle extends StatelessWidget {
  const StachelBoardTitle({super.key, required this.title, required this.template, this.onTap});
  final String title;
  final ValueListenable<bool> template;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: template,
    builder: (context, isTemplate, _) => InkWell(
      key: const Key('stachelBoardTitleTap'),
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (isTemplate) ...[
            const SizedBox(width: 8),
            Container(
              key: const Key('stachelTemplateBadge'),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Sk.yellow,
                border: Border.all(color: Sk.canvasInk, width: 1.5),
              ),
              child: Text(
                'VORLAGE',
                style: TextStyle(fontFamily: Sk.cond, fontSize: 12, fontWeight: FontWeight.w800, color: Sk.canvasInk),
              ),
            ),
          ],
        ],
      ),
    ),
  );
}

/// B08: the board lies in the trash while it is open – who deleted it when, how long it stays, and „WIEDERHERSTELLEN“
/// for those who may (web `TrashNotice`); live: restored by someone else → „Board ist wieder da“ with „BOARD ÖFFNEN“,
/// deleted for good → „gibt es nicht mehr“. [onReopen] opens the board afresh (the web reloads the page).
class StachelTrashNotice extends StatefulWidget {
  const StachelTrashNotice({
    super.key,
    required this.api,
    required this.boardId,
    required this.deletedBy,
    required this.onReopen,
    this.events,
  });

  final StachelBoardAdminApi api;
  final String boardId;

  /// Name of who deleted it while it was open ('' = unknown).
  final String deletedBy;
  final VoidCallback onReopen;

  /// Live overview events (SSE); null = none.
  final Stream<StachelBoardEvent>? events;

  @override
  State<StachelTrashNotice> createState() => _StachelTrashNoticeState();
}

class _StachelTrashNoticeState extends State<StachelTrashNotice> {
  StachelTrashedBoard? _info;
  bool _loaded = false;
  bool _busy = false;
  String? _error;
  String? _restoredBy;
  bool _restored = false;
  bool _gone = false;
  StreamSubscription<StachelBoardEvent>? _sub;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _sub = widget.events?.listen((e) {
      if (e.id != widget.boardId || !mounted) return;
      if (e.type == 'restored') {
        setState(() {
          _restored = true;
          _restoredBy = e.by;
        });
      } else if (e.type == 'purged') {
        setState(() => _gone = true);
      }
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final info = await widget.api.trashInfo(widget.boardId);
      if (mounted) {
        setState(() {
          _info = info;
          _loaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _restore() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.restoreBoard(widget.boardId);
      if (mounted) widget.onReopen();
    } on StachelException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.code == 'forbidden' ? stachelManageReason : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_restored) {
      final by = _restoredBy;
      return StachelStatusBanner(
        key: const Key('stachelBoardRestored'),
        icon: Icons.restore,
        color: Sk.surface,
        text: 'Board ist wieder da',
        detail: by != null && by.isNotEmpty
            ? '$by hat das Board wiederhergestellt.'
            : 'Das Board wurde wiederhergestellt.',
        action: TextButton(onPressed: widget.onReopen, child: const Text('BOARD ÖFFNEN')),
      );
    }
    final by = widget.deletedBy;
    final heading = by.isEmpty
        ? 'Dieses Board liegt im Papierkorb'
        : 'Board wurde von $by in den Papierkorb verschoben';
    final info = _info;
    if (_gone || (_loaded && info == null)) {
      return StachelStatusBanner(
        key: const Key('stachelBoardBanner'),
        icon: Icons.delete_forever_outlined,
        color: Sk.danger,
        text: by.isEmpty ? 'Board nicht verfügbar' : 'Board wurde von $by gelöscht',
        detail: 'Hier ist nichts mehr zu bearbeiten. Deine anderen Boards findest du in der Übersicht.',
      );
    }
    final detail = info == null
        ? 'Einen Moment …'
        : [
            '„${info.title}“ wurde am ${fullDate(info.deletedAt)} von '
                '${info.deletedByName.isEmpty ? 'jemandem' : info.deletedByName} gelöscht. ${trashPurgeText(info.purgeAt)}.',
            info.canManage
                ? 'Du kannst es wiederherstellen – mit allen Inhalten, Bildern und Kommentaren.'
                : 'Wiederherstellen kann, wer es angelegt oder gelöscht hat, oder die Orga.',
            ?_error,
          ].join('\n');
    return StachelStatusBanner(
      key: const Key('stachelBoardBanner'),
      icon: Icons.delete_outline,
      color: Sk.danger,
      text: heading,
      detail: detail,
      action: info != null && info.canManage
          ? TextButton(
              key: const Key('stachelBoardRestore'),
              // readable on the red banner
              style: TextButton.styleFrom(foregroundColor: Colors.white, backgroundColor: Sk.canvasInk),
              onPressed: _busy ? null : _restore,
              child: Text(_busy ? 'STELLE WIEDER HER …' : 'WIEDERHERSTELLEN'),
            )
          : null,
    );
  }
}
