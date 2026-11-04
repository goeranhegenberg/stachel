import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import 'admin_host.dart';
import 'format.dart';
import 'version_preview.dart';

/// Id of the version history sheet (web: sidebar tab `versions.history`).
const versionsSheet = 'versions.list';

/// The version shown read-only and its content (`snapshot` of contract §8.14).
class VersionPreview {
  const VersionPreview(this.version, this.snapshot, this.seq);
  final BoardVersion version;
  final Map<String, Object?> snapshot;

  /// Changes with every preview opened (the preview screen builds a new board for it).
  final int seq;
}

/// State of the version history of one board screen (web `features/versions/state.ts`): the list (kept while the
/// screen lives, shown at once when the sheet opens again), the version being loaded, the preview. The live board
/// stays connected underneath the preview route – nothing of the preview goes to the server.
class VersionsSession extends ChangeNotifier {
  VersionsSession._(this.ui);

  static final _sessions = Expando<VersionsSession>();

  /// The session of [ui] (one per board screen).
  static VersionsSession of(BoardUi ui) => _sessions[ui] ??= VersionsSession._(ui);

  final BoardUi ui;
  BoardAdminHost? get host => adminHost(ui);

  List<BoardVersion>? list;
  String error = '';

  /// Version whose content is loading (entry shows „ · lädt …“).
  String? loadingId;
  final preview = ValueNotifier<VersionPreview?>(null);
  Route<Object?>? _route;
  int _seq = 0;

  void _changed() => notifyListeners();

  void _toast(String text) => ui.hints.show(text);

  String _errorText(Object e) => host?.errorText(e) ?? '$e';

  /// Loads the list again (sheet: on open and every 30 s).
  Future<void> reload() async {
    final h = host;
    if (h == null) return;
    try {
      list = await h.listVersions();
      error = '';
    } catch (e) {
      error = _errorText(e);
    }
    _changed();
  }

  /// Shows [v] read-only: loads its content, then ([onLoaded], e.g. close the list sheet) opens or replaces the
  /// preview route on [navigator].
  Future<void> openPreview(NavigatorState navigator, BoardVersion v, {VoidCallback? onLoaded}) async {
    final h = host;
    if (h == null) return;
    final my = ++_seq;
    loadingId = v.id;
    _changed();
    Map<String, Object?> snap;
    try {
      snap = await h.versionSnapshot(v.id);
    } catch (e) {
      if (my == _seq) _toast(_errorText(e));
      return;
    } finally {
      if (my == _seq) {
        loadingId = null;
        _changed();
      }
    }
    if (my != _seq) return; // another version picked meanwhile
    onLoaded?.call();
    preview.value = VersionPreview(v, snap, my);
    _changed();
    if (_route == null || !_route!.isActive) {
      final route = MaterialPageRoute<Object?>(builder: (_) => VersionPreviewScreen(session: this));
      _route = route;
      navigator.push(route).whenComplete(() {
        if (identical(_route, route)) {
          _route = null;
          _seq++;
          preview.value = null;
          _changed();
        }
      });
    }
  }

  /// Back to the current state (closes the preview route).
  void closePreview() {
    _seq++;
    loadingId = null;
    final r = _route;
    _route = null;
    preview.value = null;
    if (r != null && r.isActive) {
      final nav = r.navigator;
      if (r.isCurrent) {
        nav?.pop();
      } else {
        nav?.removeRoute(r);
      }
    }
    _changed();
  }

  /// Confirmed restore (web `restoreVersion`): live board for everyone to the version's state, preview closes.
  Future<bool> restore(BoardVersion v) async {
    final h = host;
    if (h == null) return false;
    try {
      final changed = await h.restoreVersion(v.id);
      final when = whenLabel(v.createdAt);
      final toast = changed
          ? 'Stand von $when wiederhergestellt – alle sehen ihn jetzt. Der vorige Stand ist als Version gesichert.'
          : 'Das Board hat schon den Stand von $when.';
      if (preview.value != null) closePreview();
      _toast(toast);
      await reload();
      return true;
    } catch (e) {
      _toast(_errorText(e));
      return false;
    }
  }

  /// New board with the version's content, opened by the host (web `copyVersion`).
  Future<void> copy(BoardVersion v) async {
    final h = host;
    if (h == null) return;
    final title = h.boardTitle.trim();
    final full = title.isEmpty ? '' : '$title (Stand ${stamp(v.createdAt)})';
    closePreview();
    try {
      await h.openVersionCopy(v.id, full.length > 120 ? full.substring(0, 120) : full);
    } catch (e) {
      _toast(_errorText(e));
    }
  }

  /// „Version speichern“: null on failure (the error is shown).
  Future<BoardVersion?> save(String name) async {
    final h = host;
    if (h == null) return null;
    try {
      final v = await h.saveVersion(name);
      _toast('Version „${v.name ?? name}“ gespeichert.');
      await reload();
      return v;
    } catch (e) {
      _toast(_errorText(e));
      return null;
    }
  }

  /// Names [v] (empty = name removed); list and preview bar follow.
  Future<bool> rename(BoardVersion v, String name) async {
    final h = host;
    if (h == null) return false;
    try {
      final next = await h.renameVersion(v.id, name);
      final l = list;
      if (l != null) list = [for (final x in l) x.id == next.id ? next : x];
      final pv = preview.value;
      if (pv != null && pv.version.id == next.id) preview.value = VersionPreview(next, pv.snapshot, pv.seq);
      _changed();
      return true;
    } catch (e) {
      _toast(_errorText(e));
      return false;
    }
  }
}

/// Confirmation before restoring (web `PreviewLayer` dialog); restores on „Wiederherstellen“.
Future<void> confirmRestore(BuildContext context, VersionsSession session, BoardVersion v) async {
  final theme = session.ui.theme;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('stachelVersionRestoreDialog'),
      title: Text('Stand von ${whenLabel(v.createdAt)} wiederherstellen?'),
      content: Text(
        'Das Board springt für alle sofort auf diesen Stand${v.name != null ? ' („${v.name}“)' : ''}. Der aktuelle '
        'Stand wird vorher als Version gesichert – du kannst also jederzeit zurück.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Abbrechen')),
        FilledButton(
          key: const Key('stachelVersionRestoreConfirm'),
          style: FilledButton.styleFrom(backgroundColor: theme.accent),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('Wiederherstellen'),
        ),
      ],
    ),
  );
  if (ok == true) await session.restore(v);
}
