import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:stachel_board/stachel_board.dart';

import 'stachel_app_features.dart';
import 'stachel_boards_api.dart';
import 'stachel_board_widgets.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

// Melden und Blockieren (Google Play UGC, DSA Art. 16; docs/features/moderation.md, Vertrag §6 „Melden und
// Blockieren“): „Melden …“ an Objekt, Kommentar, Board und Person, „Person blockieren“ / „Blockierung aufheben“ und die
// Liste „Blockierte Personen“. Jede App (Stachel-App, Host-Apps) bekommt es über [registerStachelModeration].

/// Gründe einer Meldung (Server `shared/moderation.ts` REPORT_REASONS) mit ihren Texten.
const stachelReportReasons = <(String, String)>[
  ('illegal', 'Rechtswidriger Inhalt'),
  ('harassment', 'Belästigung, Hass oder Bedrohung'),
  ('spam', 'Spam oder Betrug'),
  ('privacy', 'Persönliche Daten ohne Erlaubnis'),
  ('copyright', 'Urheberrecht oder Marke verletzt'),
  ('other', 'Etwas anderes'),
];

/// Bei diesen Gründen braucht die Meldung eine Begründung (≥ [stachelReportTextMin] Zeichen).
const stachelReportTextRequired = {'illegal', 'other'};
const stachelReportTextMin = 10;
const stachelReportTextMax = 2000;

/// Eine blockierte Person (`GET /api/blocks`).
class StachelBlockedPerson {
  const StachelBlockedPerson({required this.key, required this.name, this.at});
  final String key;
  final String name;
  final String? at;

  static StachelBlockedPerson? fromJson(Object? j) {
    if (j is! Map || j['key'] is! String) return null;
    final name = j['name'];
    return StachelBlockedPerson(
      key: j['key'] as String,
      name: name is String && name.isNotEmpty ? name : 'Unbekannt',
      at: j['at'] is String ? j['at'] as String : null,
    );
  }
}

/// Moderations-Sperre eines Boards (`GET /api/boards/:id/moderation`).
class StachelBoardLock {
  const StachelBoardLock({required this.mode, this.reason});
  final String mode;
  final String? reason;
}

/// Melden und Blockieren über die App-Sitzung von [boards] (Bearer sts_…, schreibend mit `X-Stachel: 1`). Merkt sich
/// die zuletzt geladene Liste der Blockierten ([blockedKeys]) für die Menüs.
class StachelModerationApi extends ChangeNotifier {
  StachelModerationApi(this.boards);

  final HttpStachelBoardsApi boards;
  Set<String>? _blocked;
  Future<void>? _loading;

  static const _timeout = Duration(seconds: 20);

  /// Stachel-Instanz (Host) für Texte („Betreiber:innen von stachel.intsode.com“).
  String get instance => Uri.tryParse(boards.base)?.host ?? boards.base;

  /// Zuletzt bekannte blockierte Personen; null = noch nicht geladen.
  Set<String>? get blockedKeys => _blocked;

  bool isBlocked(String key) => _blocked?.contains(key) ?? false;

  /// Liste einmal im Hintergrund laden (Menüs zeigen danach „Blockierung aufheben“).
  void loadBlockedOnce() {
    if (_blocked != null || _loading != null) return;
    _loading = blocked().then((_) {}, onError: (_) {}).whenComplete(() => _loading = null);
  }

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
    if (res.statusCode == 401 && !retried) return _send(method, path, body: body, retried: true);
    Object? j;
    try {
      j = jsonDecode(res.body);
    } catch (_) {}
    if (res.statusCode >= 200 && res.statusCode < 300 && j is Map) return j.cast<String, Object?>();
    final code = j is Map && j['error'] is String ? j['error'] as String : null;
    final message = j is Map && j['message'] is String ? j['message'] as String : null;
    throw stachelErrorFrom(status: res.statusCode, code: code, message: message);
  }

  /// `POST /api/reports`; liefert die Nummer der Meldung (`R-…`).
  Future<({String id, bool mailed})> report({
    required String boardId,
    String? objectId,
    String? commentId,
    String? messageId,
    String? userKey,
    required String reason,
    String text = '',
  }) async {
    final j = await _send(
      'POST',
      '/api/reports',
      body: {
        'boardId': boardId,
        'objectId': ?objectId,
        'commentId': ?commentId,
        'messageId': ?messageId,
        'userKey': ?userKey,
        'reason': reason,
        if (text.trim().isNotEmpty) 'text': text.trim(),
      },
    );
    final r = j['report'];
    final id = r is Map && r['id'] is String ? r['id'] as String : '';
    return (id: id, mailed: j['mailed'] == true);
  }

  List<StachelBlockedPerson> _list(Map<String, Object?> j) {
    final raw = j['blocked'];
    final list = [
      if (raw is List)
        for (final b in raw) ?StachelBlockedPerson.fromJson(b),
    ];
    _blocked = {for (final b in list) b.key};
    notifyListeners();
    return list;
  }

  /// `GET /api/blocks`
  Future<List<StachelBlockedPerson>> blocked() async => _list(await _send('GET', '/api/blocks'));

  /// `PUT /api/blocks/:key`
  Future<List<StachelBlockedPerson>> block(String key) async =>
      _list(await _send('PUT', '/api/blocks/${Uri.encodeComponent(key)}'));

  /// `DELETE /api/blocks/:key`
  Future<List<StachelBlockedPerson>> unblock(String key) async =>
      _list(await _send('DELETE', '/api/blocks/${Uri.encodeComponent(key)}'));

  /// `GET /api/boards/:id/moderation` – null = nicht gesperrt.
  Future<StachelBoardLock?> boardLock(String boardId) async {
    final l = (await _send('GET', '/api/boards/${Uri.encodeComponent(boardId)}/moderation'))['lock'];
    if (l is! Map || l['mode'] is! String) return null;
    return StachelBoardLock(mode: l['mode'] as String, reason: l['reason'] is String ? l['reason'] as String : null);
  }
}

/// Was gemeldet wird.
class StachelReportTarget {
  const StachelReportTarget({
    required this.boardId,
    required this.label,
    this.objectId,
    this.commentId,
    this.messageId,
    this.userKey,
  });

  final String boardId;

  /// Für die Überschrift: „Board „Festival““, „Objekt“, „Kommentar von Mara“, „Mara“.
  final String label;
  final String? objectId;
  final String? commentId;
  final String? messageId;
  final String? userKey;
}

/// „Melden …“: Grund, Begründung, Senden; danach „Danke, deine Meldung ist eingegangen (Nr. R-…)“ als Hinweis.
/// Liefert die Nummer der Meldung (null = abgebrochen).
Future<String?> showStachelReportSheet(
  BuildContext context, {
  required StachelModerationApi api,
  required StachelReportTarget target,
}) async {
  final id = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StachelReportSheet(api: api, target: target),
  );
  if (id != null && context.mounted) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        key: const Key('stachelReportDone'),
        content: Text('Danke, deine Meldung ist eingegangen${id.isEmpty ? '' : ' (Nr. $id)'}.'),
      ),
    );
  }
  return id;
}

/// Inhalt von [showStachelReportSheet].
class StachelReportSheet extends StatefulWidget {
  const StachelReportSheet({super.key, required this.api, required this.target});
  final StachelModerationApi api;
  final StachelReportTarget target;

  @override
  State<StachelReportSheet> createState() => _StachelReportSheetState();
}

class _StachelReportSheetState extends State<StachelReportSheet> {
  final _text = TextEditingController();
  String? _reason;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  String? _check() {
    final r = _reason;
    if (r == null) return 'Bitte wähle einen Grund.';
    final t = _text.text.trim();
    if (stachelReportTextRequired.contains(r) && t.length < stachelReportTextMin) {
      return 'Bitte beschreibe kurz, was nicht in Ordnung ist (mindestens $stachelReportTextMin Zeichen).';
    }
    if (t.length > stachelReportTextMax) return 'Höchstens $stachelReportTextMax Zeichen.';
    return null;
  }

  Future<void> _send() async {
    final problem = _check();
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final t = widget.target;
    try {
      final r = await widget.api.report(
        boardId: t.boardId,
        objectId: t.objectId,
        commentId: t.commentId,
        messageId: t.messageId,
        userKey: t.userKey,
        reason: _reason!,
        text: _text.text,
      );
      if (mounted) Navigator.of(context).pop(r.id);
    } on StachelException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final required = stachelReportTextRequired.contains(_reason);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          key: const Key('stachelReportSheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'MELDEN: ${widget.target.label.toUpperCase()}',
              style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w700, fontSize: 18),
            ),
            const SizedBox(height: 4),
            Text(
              'Die Meldung geht an die Betreiber:innen von ${widget.api.instance}. '
              'Missbrauch von Meldungen kann zur Sperre führen.',
              style: TextStyle(color: Sk.grey, fontSize: 13),
            ),
            const SizedBox(height: 8),
            RadioGroup<String>(
              groupValue: _reason,
              onChanged: (v) => _busy ? null : setState(() => _reason = v),
              child: Column(
                children: [
                  for (final (value, label) in stachelReportReasons)
                    RadioListTile<String>(
                      key: Key('stachelReportReason-$value'),
                      value: value,
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(label),
                    ),
                ],
              ),
            ),
            TextField(
              key: const Key('stachelReportText'),
              controller: _text,
              enabled: !_busy,
              minLines: 2,
              maxLines: 5,
              maxLength: stachelReportTextMax,
              decoration: InputDecoration(
                labelText: required ? 'Was ist nicht in Ordnung? (Pflicht)' : 'Was ist nicht in Ordnung? (freiwillig)',
                border: const OutlineInputBorder(),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  key: const Key('stachelReportError'),
                  style: TextStyle(color: Sk.danger),
                ),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('stachelReportSend'),
                  onPressed: _busy ? null : _send,
                  child: const Text('MELDEN'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

void _snack(BuildContext context, String text) =>
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(text)));

/// „`<Name>` blockieren?“ → `PUT /api/blocks/:key`. True = blockiert.
Future<bool> confirmStachelBlock(
  BuildContext context, {
  required StachelModerationApi api,
  required String key,
  required String name,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      key: const Key('stachelBlockDialog'),
      title: Text('$name blockieren?'),
      content: Text(
        'Einladungen und @Erwähnungen von $name erreichen dich dann nicht mehr. $name erfährt davon nichts.',
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('ABBRECHEN')),
        FilledButton(
          key: const Key('stachelBlockConfirm'),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('BLOCKIEREN'),
        ),
      ],
    ),
  );
  if (ok != true) return false;
  try {
    await api.block(key);
    if (context.mounted) _snack(context, '$name ist blockiert.');
    return true;
  } on StachelException catch (e) {
    if (context.mounted) _snack(context, e.message);
    return false;
  }
}

/// „Blockierung aufheben“ → `DELETE /api/blocks/:key`. True = aufgehoben.
Future<bool> unblockStachelPerson(
  BuildContext context, {
  required StachelModerationApi api,
  required String key,
  required String name,
}) async {
  try {
    await api.unblock(key);
    if (context.mounted) _snack(context, 'Blockierung von $name aufgehoben.');
    return true;
  } on StachelException catch (e) {
    if (context.mounted) _snack(context, e.message);
    return false;
  }
}

/// Eine Zeile „Person melden …“ / „Person blockieren“ / „Blockierung aufheben“.
typedef StachelPersonAction = ({
  String key,
  String label,
  IconData icon,
  bool danger,
  Future<void> Function(BuildContext) run,
});

/// „Person melden …“ und „Person blockieren“ / „Blockierung aufheben“ für [key] auf [boardId] (Personenlisten).
List<StachelPersonAction> stachelPersonActions(
  StachelModerationApi api, {
  required String boardId,
  required String key,
  required String name,
}) {
  api.loadBlockedOnce();
  return [
    (
      key: 'stachelPersonReport',
      label: 'Person melden …',
      icon: Icons.flag_outlined,
      danger: false,
      run: (context) => showStachelReportSheet(
        context,
        api: api,
        target: StachelReportTarget(boardId: boardId, userKey: key, label: name),
      ),
    ),
    api.isBlocked(key)
        ? (
            key: 'stachelPersonUnblock',
            label: 'Blockierung aufheben',
            icon: Icons.lock_open_outlined,
            danger: false,
            run: (context) => unblockStachelPerson(context, api: api, key: key, name: name),
          )
        : (
            key: 'stachelPersonBlock',
            label: 'Person blockieren',
            icon: Icons.block,
            danger: true,
            run: (context) => confirmStachelBlock(context, api: api, key: key, name: name),
          ),
  ];
}

/// „Blockierte Personen“ als eigene Seite.
Future<void> showStachelBlockedPeople(BuildContext context, StachelModerationApi api) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => StachelBlockedPeopleScreen(api: api)));

/// Liste der blockierten Personen mit „Blockierung aufheben“.
class StachelBlockedPeopleScreen extends StatefulWidget {
  const StachelBlockedPeopleScreen({super.key, required this.api});
  final StachelModerationApi api;

  @override
  State<StachelBlockedPeopleScreen> createState() => _StachelBlockedPeopleScreenState();
}

class _StachelBlockedPeopleScreenState extends State<StachelBlockedPeopleScreen> {
  List<StachelBlockedPerson>? _list;
  String? _error;
  final _busy = <String>{};

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final l = await widget.api.blocked();
      if (mounted) {
        setState(() {
          _list = l;
          _error = null;
        });
      }
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _unblock(StachelBlockedPerson p) async {
    setState(() => _busy.add(p.key));
    try {
      final l = await widget.api.unblock(p.key);
      if (!mounted) return;
      setState(() => _list = l);
      _snack(context, 'Blockierung von ${p.name} aufgehoben.');
    } on StachelException catch (e) {
      if (mounted) _snack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy.remove(p.key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    final Widget body;
    if (_error != null && list == null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, key: const Key('stachelBlockedError'), textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('NOCHMAL VERSUCHEN')),
            ],
          ),
        ),
      );
    } else if (list == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = ListView(
        key: const Key('stachelBlockedList'),
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Einladungen und @Erwähnungen dieser Personen erreichen dich nicht. Sie erfahren davon nichts. Blockieren '
            'kannst du in der Personenliste eines Boards.',
            style: TextStyle(color: Sk.grey, fontSize: 13),
          ),
          const SizedBox(height: 12),
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('Du hast niemanden blockiert.', key: const Key('stachelBlockedEmpty')),
            )
          else
            for (final p in list)
              ListTile(
                key: Key('stachelBlocked-${p.key}'),
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  radius: 17,
                  backgroundColor: Sk.grey,
                  child: Text(peerInitials(p.name), style: const TextStyle(fontSize: 12, color: Colors.white)),
                ),
                title: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                trailing: TextButton(
                  key: Key('stachelUnblock-${p.key}'),
                  onPressed: _busy.contains(p.key) ? null : () => _unblock(p),
                  child: const Text('BLOCKIERUNG AUFHEBEN'),
                ),
              ),
        ],
      );
    }
    return Scaffold(
      appBar: skAppBar('Blockierte Personen'),
      body: SafeArea(top: false, child: body),
    );
  }
}

/// Board-Bildschirm mit Melden/Blockieren (der Bildschirm des Pakets bietet es an).
mixin StachelModerationHost on BoardHost {
  StachelModerationApi get moderation;

  /// Eigener Schlüssel (sich selbst meldet und blockiert man nicht).
  String? get myKey;

  @override
  List<MenuEntry> personActions(String key, String name) => key.isEmpty || key == myKey
      ? const []
      : [
          for (final a in stachelPersonActions(moderation, boardId: boardId, key: key, name: name))
            MenuEntry(key: a.key, label: a.label, icon: a.icon, danger: a.danger, onSelect: (c, _) => a.run(c)),
        ];
}

StachelModerationHost? _modHost(BoardUi ui) =>
    ui.host is StachelModerationHost ? ui.host as StachelModerationHost : null;

/// „Melden …“ im Objekt-Menü und „Board melden …“ im Board-Menü (beide Apps, an [registerStachelAppFeatures]).
BoardRegistry registerStachelModeration(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'moderation.report',
      on: MenuTarget.object,
      order: 98,
      entry: (ui, at) {
        final h = _modHost(ui);
        final id = at.objectId ?? ui.editor.single?.id;
        if (h == null || id == null) return null;
        return MenuEntry(
          key: 'stachelMenuReport',
          label: 'Melden …',
          icon: Icons.flag_outlined,
          sep: true,
          onSelect: (context, ui) => showStachelReportSheet(
            context,
            api: h.moderation,
            target: StachelReportTarget(boardId: h.boardId, objectId: id, label: 'Objekt'),
          ),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'moderation.reportBoard',
      on: MenuTarget.board,
      order: 99,
      section: MenuSection.more,
      entry: (ui, at) {
        final h = _modHost(ui);
        if (h == null) return null;
        final title = h is StachelClientHost ? (h as StachelClientHost).boardTitle : null;
        return MenuEntry(
          key: 'stachelBoardReport',
          label: 'Board melden …',
          icon: Icons.flag_outlined,
          sep: true,
          onSelect: (context, ui) => showStachelReportSheet(
            context,
            api: h.moderation,
            target: StachelReportTarget(boardId: h.boardId, label: title == null ? 'Board' : 'Board „$title“'),
          ),
        );
      },
    ),
  );
  return r;
}
