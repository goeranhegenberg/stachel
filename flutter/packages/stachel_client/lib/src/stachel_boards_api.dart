import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/painting.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'stachel_cache.dart';
import 'stachel_client_base.dart';
import 'stachel_secret_store.dart';

/// One entry of the Stachel inbox (contract §8.11): a new @mention in a comment or a card assigned to me.
class StachelInboxItem {
  const StachelInboxItem({
    required this.id,
    required this.type,
    required this.boardId,
    required this.boardTitle,
    this.objectId,
    this.threadId,
    this.by,
    required this.text,
    required this.at,
  });

  static StachelInboxItem? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String || j['boardId'] is! String) return null;
    final type = j['type'];
    if (type != 'mention' && type != 'assign') return null;
    String? s(Object? v) => v is String ? v : null;
    return StachelInboxItem(
      id: j['id'] as String,
      type: type as String,
      boardId: j['boardId'] as String,
      boardTitle: s(j['boardTitle']) ?? 'Board',
      objectId: s(j['objectId']),
      threadId: s(j['threadId']),
      by: s(j['by']),
      text: s(j['text']) ?? '',
      at: s(j['at']) ?? '',
    );
  }

  final String id;

  /// `mention` or `assign`.
  final String type;
  final String boardId;
  final String boardTitle;
  final String? objectId;
  final String? threadId;

  /// Who wrote/assigned (name; null = unknown).
  final String? by;
  final String text;
  final String at;
}

/// `GET /api/native/v1/inbox`: items plus the server time to ask from next time.
class StachelInboxPage {
  const StachelInboxPage(this.items, this.now);
  final List<StachelInboxItem> items;
  final String now;

  static StachelInboxPage fromJson(Object? j) {
    if (j is! Map || j['now'] is! String) throw const FormatException('inbox');
    return StachelInboxPage([
      for (final i in (j['items'] is List ? j['items'] as List : const [])) ?StachelInboxItem.fromJson(i),
    ], j['now'] as String);
  }
}

/// One board of the list (`BoardInfo` in `stachel/shared/protocol.ts`, contract §3 `GET /api/boards`).
class StachelBoardInfo {
  const StachelBoardInfo({
    required this.id,
    required this.title,
    this.createdBy = '',
    this.createdByName = '',
    this.updatedAt,
    this.openedAt,
    this.favorite = false,
    this.thumbnailAt,
    this.template = false,
    this.role,
  });

  /// Null for entries without string `id` (skipped).
  static StachelBoardInfo? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    String? str(String k) => j[k] is String ? j[k] as String : null;
    return StachelBoardInfo(
      id: j['id'] as String,
      title: str('title') ?? 'Unbenanntes Board',
      createdBy: str('createdBy') ?? '',
      createdByName: str('createdByName') ?? '',
      updatedAt: DateTime.tryParse(str('updatedAt') ?? ''),
      openedAt: DateTime.tryParse(str('openedAt') ?? ''),
      favorite: j['favorite'] == true,
      thumbnailAt: str('thumbnailAt'),
      template: j['template'] == true,
      role: stachelBoardRoles.contains(j['role']) ? j['role'] as String : null,
    );
  }

  final String id;
  final String title;

  /// User key of who created it (`createdBy`; „Von mir“, right to delete).
  final String createdBy;
  final String createdByName;
  final DateTime? updatedAt;

  /// When this person last opened the board (only for the asking person).
  final DateTime? openedAt;
  final bool favorite;

  /// Version of the preview image; null = none.
  final String? thumbnailAt;
  final bool template;

  /// Own role on the board (`owner`/`edit`/`comment`/`view`), only in instances with own accounts (contract §6,
  /// `BoardInfo.role`); null = not sent (mode org: everyone edits everything).
  final String? role;

  /// The role allows editing (rename …, `ROUTE_ROLES` in `server/src/access.ts`); true without a role.
  bool get mayEdit => role == null || role == 'edit' || role == 'owner';

  StachelBoardInfo withFavorite(bool f) => _copy(favorite: f);
  StachelBoardInfo withTitle(String t) => _copy(title: t);

  StachelBoardInfo _copy({String? title, bool? favorite}) => StachelBoardInfo(
    id: id,
    title: title ?? this.title,
    createdBy: createdBy,
    createdByName: createdByName,
    updatedAt: updatedAt,
    openedAt: openedAt,
    favorite: favorite ?? this.favorite,
    thumbnailAt: thumbnailAt,
    template: template,
    role: role,
  );
}

/// The roles on a board, highest first (`BoardRole` in `shared/protocol.ts`).
const stachelBoardRoles = ['owner', 'edit', 'comment', 'view'];

/// The roles that can be given (invite, change, link): all but `owner` (web `ShareRole`).
const stachelShareRoles = ['edit', 'comment', 'view'];

/// German names of the roles (web `ROLE_NAMES`).
const stachelRoleNames = {
  'owner': 'Besitzer:in',
  'edit': 'Kann bearbeiten',
  'comment': 'Kann kommentieren',
  'view': 'Kann ansehen',
};

/// One person with access in the sharing dialog (web `SharePerson`): [via] `owner`, `member` or `link`; [email] only
/// for who may manage.
class StachelSharePerson {
  const StachelSharePerson({
    required this.key,
    required this.name,
    this.email,
    required this.role,
    this.via = 'member',
  });

  static StachelSharePerson? fromJson(Object? j) {
    if (j is! Map || j['key'] is! String || !stachelBoardRoles.contains(j['role'])) return null;
    return StachelSharePerson(
      key: j['key'] as String,
      name: j['name'] is String ? j['name'] as String : '',
      email: j['email'] is String ? j['email'] as String : null,
      role: j['role'] as String,
      via: j['via'] is String ? j['via'] as String : 'member',
    );
  }

  final String key;
  final String name;
  final String? email;
  final String role;
  final String via;
}

/// An invitation to someone without an account yet (web `ShareInfo.invites`).
class StachelShareInvite {
  const StachelShareInvite(this.email, this.role);
  final String email;
  final String role;
}

/// State of the sharing dialog (`GET /api/boards/:id/share`, web `ShareInfo`, `server/src/access-routes.ts`).
class StachelShareInfo {
  const StachelShareInfo({
    required this.title,
    required this.role,
    this.canManage = false,
    this.people = const [],
    this.invites = const [],
    this.link,
    this.url = '',
  });

  /// Throws [StachelException] (`error`) for anything that is no sharing state.
  static StachelShareInfo fromJson(Object? j) {
    if (j is! Map || !stachelBoardRoles.contains(j['role'])) throw StachelException.forCode('error');
    final link = j['link'];
    return StachelShareInfo(
      title: j['title'] is String ? j['title'] as String : 'Board',
      role: j['role'] as String,
      canManage: j['canManage'] == true,
      people: [for (final p in (j['people'] is List ? j['people'] as List : const [])) ?StachelSharePerson.fromJson(p)],
      invites: [
        for (final i in (j['invites'] is List ? j['invites'] as List : const []))
          if (i is Map && i['email'] is String && stachelShareRoles.contains(i['role']))
            StachelShareInvite(i['email'] as String, i['role'] as String),
      ],
      link: stachelShareRoles.contains(link) ? link as String : null,
      url: j['url'] is String ? j['url'] as String : '',
    );
  }

  final String title;

  /// Own role on the board.
  final String role;

  /// May invite, change roles and the link (`owner`/`edit`); transferring the board needs `owner`.
  final bool canManage;
  final List<StachelSharePerson> people;
  final List<StachelShareInvite> invites;

  /// Role of the share link; null = off (only invited people).
  final String? link;

  /// Link to the board (`<PUBLIC_URL>/b/<id>`).
  final String url;
}

/// Sharing a board in instances with own accounts (contract §6, `docs/features/accounts.md`, web `accountApi`): each
/// answer is the dialog's new state. Throws [StachelException] with the server's German text.
abstract interface class StachelSharingApi {
  /// `GET /api/boards/:id/share`.
  Future<StachelShareInfo> shareInfo(String boardId);

  /// `POST /api/boards/:id/share {emails, role}`: people with an account get access at once, others an invitation.
  Future<StachelShareInfo> invite(String boardId, List<String> emails, String role);

  /// `PATCH /api/boards/:id/members/:key {role}`.
  Future<StachelShareInfo> setMemberRole(String boardId, String key, String role);

  /// `DELETE /api/boards/:id/members/:key`: removes someone, or leaves the board (own key) – then null.
  Future<StachelShareInfo?> removeMember(String boardId, String key);

  /// `DELETE /api/boards/:id/invites/:email`.
  Future<StachelShareInfo> removeInvite(String boardId, String email);

  /// `PUT /api/boards/:id/link {role}`; null = link off.
  Future<StachelShareInfo> setLink(String boardId, String? role);

  /// `POST /api/boards/:id/owner {key}` (owner only): [key] becomes owner, the old owner keeps „Kann bearbeiten“.
  Future<StachelShareInfo> transferOwner(String boardId, String key);
}

/// The board list as last loaded on this device (offline: shown with „Stand von …“).
class StachelBoardList {
  const StachelBoardList(this.boards, this.savedAt);
  final List<StachelBoardInfo> boards;
  final DateTime savedAt;
}

/// One change of the board list, live over SSE (`GET /api/boards/events`, contract §3): `created`, `renamed` (with
/// [title]/[titleSeq]), `deleted`, `restored`, `purged`, `updated`; [reconnected] after the stream came back (the
/// list may have missed changes → reload). Unknown types → reload as well.
class StachelBoardEvent {
  const StachelBoardEvent(this.type, {this.id, this.title, this.titleSeq, this.by, this.byKey});

  static const reconnected = StachelBoardEvent('reconnected');

  /// Null for anything that is no event object.
  static StachelBoardEvent? fromJson(Object? j) {
    if (j is! Map || j['type'] is! String) return null;
    return StachelBoardEvent(
      j['type'] as String,
      id: j['id'] is String ? j['id'] as String : null,
      title: j['title'] is String ? j['title'] as String : null,
      titleSeq: j['titleSeq'] is int ? j['titleSeq'] as int : null,
      by: j['by'] is String ? j['by'] as String : null,
      byKey: j['byKey'] is String ? j['byKey'] as String : null,
    );
  }

  final String type;
  final String? id;
  final String? title;
  final int? titleSeq;

  /// `deleted`/`restored`: who did it (name and user key).
  final String? by;
  final String? byKey;
}

/// `data:` payloads of a server-sent event stream (one per event, multi-line data joined with a line break); comments
/// (`: ping`), `event:`, `id:` and `retry:` are skipped.
Stream<String> sseData(Stream<String> lines) async* {
  final data = <String>[];
  await for (final raw in lines) {
    final line = raw.endsWith('\r') ? raw.substring(0, raw.length - 1) : raw;
    if (line.isEmpty) {
      if (data.isNotEmpty) yield data.join('\n');
      data.clear();
    } else if (line.startsWith('data:')) {
      data.add(line.substring(5).startsWith(' ') ? line.substring(6) : line.substring(5));
    }
  }
}

/// Board list of Stachel for the app. Throws [StachelException].
abstract class StachelBoardsApi {
  /// All boards of the team (last changed first, like the server sends them).
  Future<List<StachelBoardInfo>> boards();

  /// Star for the asking person (`PUT`/`DELETE /api/boards/:id/favorite`).
  Future<void> setFavorite(String id, bool favorite);

  /// New board (`POST /api/boards {title}`, contract §8.3); empty title = „Unbenanntes Board“ on the server.
  Future<StachelBoardInfo> createBoard(String title);

  /// Renames a board (`PATCH /api/boards/:id {title}`); the board and the list get `board.renamed` live.
  Future<void> renameBoard(String id, String title);

  /// Preview image of [board] (null = none).
  ImageProvider? thumbnail(StachelBoardInfo board);

  /// The list as last loaded on this device (null = never).
  Future<StachelBoardList?> cachedBoards();

  /// Live changes of the list; reconnects by itself, error [StachelException] only when the login is gone.
  Stream<StachelBoardEvent> events();
}

/// A board in the trash (`TrashedBoardInfo`, contract §3 „Papierkorb“).
class StachelTrashedBoard {
  const StachelTrashedBoard({
    required this.board,
    required this.deletedAt,
    this.deletedByName = '',
    required this.purgeAt,
    this.canManage = false,
  });

  static StachelTrashedBoard? fromJson(Object? j) {
    final b = StachelBoardInfo.fromJson(j);
    if (b == null || j is! Map) return null;
    final deleted = DateTime.tryParse(j['deletedAt'] is String ? j['deletedAt'] as String : '');
    if (deleted == null) return null;
    final purge = DateTime.tryParse(j['purgeAt'] is String ? j['purgeAt'] as String : '');
    return StachelTrashedBoard(
      board: b,
      deletedAt: deleted,
      deletedByName: j['deletedByName'] is String ? j['deletedByName'] as String : '',
      purgeAt: purge ?? deleted.add(const Duration(days: stachelTrashDays)),
      canManage: j['canManage'] == true,
    );
  }

  final StachelBoardInfo board;
  final DateTime deletedAt;
  final String deletedByName;

  /// From here the server deletes it for good.
  final DateTime purgeAt;

  /// The asking person may restore and delete for good (creator, who deleted it, Orga).
  final bool canManage;

  String get id => board.id;
  String get title => board.title;
}

/// Days a board stays in the trash (`TRASH_DAYS`).
const stachelTrashDays = 30;

/// The signed-in person as Stachel sees it (`GET /api/auth/me`).
class StachelUser {
  const StachelUser(this.key, this.name, {this.isOrga = false});
  final String key;
  final String name;
  final bool isOrga;
}

/// Managing boards from the app like the web overview and board menu (audit P6): copies and templates, trash,
/// versions, preview image, AI access tokens. Separate from [StachelBoardsApi] so fakes of the plain list keep
/// working; [HttpStachelBoardsApi] implements both. Throws [StachelException].
abstract interface class StachelBoardAdminApi {
  /// Who is signed in (key for „Von mir“ and the right to delete).
  Future<StachelUser> me();

  /// `POST /api/boards/:id/duplicate {title?, template?}`: „Titel (Kopie)“ or a template.
  Future<StachelBoardInfo> duplicateBoard(String id, {String? title, bool template = false});

  /// `DELETE /api/boards/:id` → trash.
  Future<void> deleteBoard(String id);

  Future<List<StachelTrashedBoard>> trash();

  /// One board in the trash (null = not in the trash / unknown).
  Future<StachelTrashedBoard?> trashInfo(String id);
  Future<StachelBoardInfo> restoreBoard(String id);
  Future<void> purgeBoard(String id);

  /// „Papierkorb leeren“: everything the person may delete; returns how many.
  Future<int> emptyTrash();

  /// Preview image of a trashed board (null = none).
  ImageProvider? trashThumbnail(StachelTrashedBoard board);

  // versions (contract §3 „Versionen“, §8.14) – raw JSON, the board package parses it
  Future<List<Object?>> versions(String boardId);
  Future<Object?> saveVersion(String boardId, String name);
  Future<Object?> renameVersion(String boardId, String versionId, String name);

  /// Returns whether the board changed.
  Future<bool> restoreVersion(String boardId, String versionId);
  Future<StachelBoardInfo> copyVersion(String boardId, String versionId, String title);
  Future<Map<String, Object?>> versionSnapshot(String boardId, String versionId);

  /// `PUT /api/boards/:id/thumbnail`; returns `thumbnailAt`.
  Future<String?> uploadThumbnail(String boardId, Uint8List bytes, String mimeType);

  // AI access (`/api/tokens`)
  Future<Map<String, Object?>> tokens();
  Future<Map<String, Object?>> createToken(String label);
  Future<void> revokeToken(String id);

  // own templates (`/api/templates`, contract §3 „Eigene Vorlagen“, Q2) – raw JSON, the board package parses it
  Future<List<Object?>> ownTemplates();
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects);
  Future<void> deleteOwnTemplate(String id);

  /// Templates of the instance (`GET /api/templates/instance`, contract §3 „Vorlagen der Instanz“) – raw JSON
  /// `{ok, category, templates}`, the board package parses it.
  Future<Object?> instanceTemplates();
}

/// The app's Stachel session token (`sts_…`, contract §8.1), kept across app starts so opening the board list does not
/// create a new 30-day session every time. Bound to the login ([StachelClient.loginKey]) it was made with (another login = not used).
/// Kept in [secrets] (Android Keystore / iOS Keychain), not in SharedPreferences; a token stored there by an older
/// version is moved over on the first read.
class StachelSession {
  StachelSession._();

  static const _key = 'stachel_app_session_v1';

  /// Where the token is kept. Under `flutter test` there are no plugins (and a platform call from a widget test's fake
  /// async zone would never be answered), so tests keep it in memory; they may put another store here.
  static StachelSecretStore secrets = Platform.environment.containsKey('FLUTTER_TEST')
      ? StachelMemorySecretStore()
      : StachelPlatformSecretStore();

  /// Where the Stachel inbox check keeps its `since` (`StachelInboxCheck`).
  static const inboxSinceKey = 'stachel_inbox_since_v1';
  static String? _memToken;
  static String? _memFor;

  static String _owner(String loginKey) => sha256.convert(utf8.encode(loginKey)).toString().substring(0, 24);

  /// Short hash of the login ([StachelClient.loginKey]; device data of one login is not shown to another).
  static String ownerOf(String loginKey) => _owner(loginKey);

  /// The stored entry `{for, token}` (secure storage; moves one left in SharedPreferences by an older version).
  static Future<Map?> _entry() async {
    try {
      var raw = await secrets.read(_key);
      raw ??= await _migrate();
      final j = raw == null ? null : jsonDecode(raw);
      return j is Map && j['token'] is String ? j : null;
    } catch (_) {
      return null;
    }
  }

  /// Older versions kept the token in plain SharedPreferences: move it into [secrets] and delete it there.
  static Future<String?> _migrate() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    await secrets.write(_key, raw);
    await prefs.remove(_key);
    return raw;
  }

  static Future<void> _removeLegacy() async {
    try {
      await (await SharedPreferences.getInstance()).remove(_key);
    } catch (_) {}
  }

  /// Stored token for [loginKey], null if none or made for another login.
  static Future<String?> load(String loginKey) async {
    final owner = _owner(loginKey);
    if (_memFor == owner && _memToken != null) return _memToken;
    final j = await _entry();
    if (j != null && j['for'] == owner) {
      _memFor = owner;
      return _memToken = j['token'] as String;
    }
    return null;
  }

  static Future<void> save(String loginKey, String token) async {
    _memFor = _owner(loginKey);
    _memToken = token;
    await secrets.write(_key, jsonEncode({'for': _memFor, 'token': token}));
    await _removeLegacy();
  }

  static Future<String?> _stored() async {
    if (_memToken != null) return _memToken;
    return (await _entry())?['token'] as String?;
  }

  static Future<void> clear() async {
    _memToken = null;
    _memFor = null;
    try {
      await secrets.delete(_key);
    } catch (_) {}
    await _removeLegacy();
  }

  /// Logout: ends the Stachel session on the server (`DELETE /api/auth/app-session`, best effort), forgets it and
  /// deletes the boards, images and the list kept on this device.
  static Future<void> signedOut(http.Client client, {required String base}) async {
    final token = await _stored();
    await clear();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(HttpStachelBoardsApi.listKey);
      await prefs.remove(inboxSinceKey);
    } catch (_) {}
    await StachelCache.clearAll();
    if (token == null) return;
    try {
      final b = base.trim().endsWith('/') ? base.trim().substring(0, base.trim().length - 1) : base.trim();
      await client
          .delete(Uri.parse('$b/api/auth/app-session'), headers: {'Authorization': 'Bearer $token', 'X-Stachel': '1'})
          .timeout(const Duration(seconds: 5));
    } catch (_) {}
  }
}

/// [StachelBoardsApi] over HTTP with the app's own Stachel session (contract §8.1): the session comes from the app
/// ([StachelClient.newSession], e.g. `POST /api/auth/app-session` with the host app's org token → `sts_…`) and is kept per
/// login ([StachelSession]); then `Authorization: Bearer sts_…` (plus `X-Stachel: 1` when writing). A 401 fetches a
/// new session once. A server without `app-session` (404) → `not_available`.
///
/// Contract §8.1/§8.3; keep this class the only place that knows these endpoints. [base] overrides the client's.
class HttpStachelBoardsApi implements StachelBoardsApi, StachelBoardAdminApi, StachelSharingApi {
  HttpStachelBoardsApi(this.client, {String? base, bool release = kReleaseMode})
    : _base = stachelTrimBase(base ?? client.base),
      _release = release;

  /// The app around (login, HTTP client).
  final StachelClient client;
  final String _base;

  http.Client get _http => client.httpClient;

  /// Stachel origin this API talks to.
  String get base => _base;
  final bool _release;
  String? _token;
  Future<String>? _pending;

  static const _timeout = Duration(seconds: 20);

  /// The `sts_…` token for the WebSocket (§8.4); [fresh] after a 4401. Throws [StachelException].
  Future<String> sessionToken({bool fresh = false}) => _session(fresh: fresh);

  Future<String> _session({bool fresh = false}) {
    if (fresh) {
      _token = null;
      _pending = null;
    }
    final t = _token;
    if (t != null) return Future.value(t);
    return _pending ??= _storedOrNew(fresh).whenComplete(() => _pending = null);
  }

  Future<String> _storedOrNew(bool fresh) async {
    final login = client.loginKey;
    if (!fresh && login != null) {
      final stored = await StachelSession.load(login);
      if (stored != null) return _token = stored;
    }
    return _newSession();
  }

  Future<String> _newSession() async {
    if (client.loginKey == null) throw StachelException.forCode('invalid_token');
    if (!stachelBaseMaySendToken(_base, release: _release)) throw StachelException.forCode('error');
    final token = await client.newSession(_base);
    final login = client.loginKey;
    if (login != null) await StachelSession.save(login, token);
    return _token = token;
  }

  Future<http.Response> _send(
    String method,
    String path, {
    bool write = false,
    bool retried = false,
    Object? body,
  }) async {
    final token = await _session();
    final req = http.Request(method, Uri.parse('$_base$path'))
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
      res = await http.Response.fromStream(await _http.send(req).timeout(_timeout)).timeout(_timeout);
    } catch (_) {
      throw StachelException.forCode('network');
    }
    if (res.statusCode == 401 && !retried) {
      await _session(fresh: true);
      return _send(method, path, write: write, retried: true, body: body);
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return res;
    String? code, message;
    try {
      final b = jsonDecode(res.body);
      if (b is Map) {
        code = b['error'] is String ? b['error'] as String : null;
        message = b['message'] is String ? b['message'] as String : null;
      }
    } catch (_) {}
    throw stachelErrorFrom(status: res.statusCode, code: code, message: message);
  }

  @override
  Future<List<StachelBoardInfo>> boards() async {
    final res = await _send('GET', '/api/boards');
    final Object? j;
    try {
      j = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      throw StachelException.forCode('error');
    }
    final list = j is Map ? j['boards'] : null;
    if (list is! List) throw StachelException.forCode('error');
    await _saveList(list);
    return [for (final b in list) ?StachelBoardInfo.fromJson(b)];
  }

  /// SharedPreferences key of the list kept for offline use.
  static const listKey = 'stachel_boards_cache_v1';

  Future<void> _saveList(List<Object?> list) async {
    final login = client.loginKey;
    if (login == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        listKey,
        jsonEncode({
          'for': StachelSession.ownerOf(login),
          'at': DateTime.now().toUtc().toIso8601String(),
          'boards': list,
        }),
      );
    } catch (_) {}
  }

  @override
  Future<StachelBoardList?> cachedBoards() async {
    final login = client.loginKey;
    if (login == null) return null;
    try {
      final raw = (await SharedPreferences.getInstance()).getString(listKey);
      final j = raw == null ? null : jsonDecode(raw);
      if (j is! Map || j['for'] != StachelSession.ownerOf(login) || j['boards'] is! List) return null;
      final at = DateTime.tryParse(j['at'] is String ? j['at'] as String : '');
      if (at == null) return null;
      return StachelBoardList([for (final b in j['boards'] as List) ?StachelBoardInfo.fromJson(b)], at.toLocal());
    } catch (_) {
      return null;
    }
  }

  /// SSE `GET /api/boards/events` with the Stachel token; reconnects after [retry] (and when nothing came for
  /// [silence] – the server beats every 25 s); a 401 gets a new session.
  @override
  Stream<StachelBoardEvent> events({
    Duration retry = const Duration(seconds: 3),
    Duration silence = const Duration(seconds: 70),
  }) {
    late final StreamController<StachelBoardEvent> out;
    var stopped = false;
    StreamSubscription<String>? sub;
    Completer<void>? done;
    Timer? pause;

    /// Waits [d] unless the stream is cancelled first.
    Future<void> wait(Duration d) {
      final c = done = Completer<void>();
      pause = Timer(d, () {
        if (!c.isCompleted) c.complete();
      });
      return c.future;
    }

    Future<void> loop() async {
      var connectedBefore = false;
      var fresh = false;
      while (!stopped) {
        var renewed = false;
        try {
          final token = await _session(fresh: fresh);
          fresh = false;
          final req = http.Request('GET', Uri.parse('$_base/api/boards/events'))
            ..followRedirects = false
            ..headers.addAll({'Authorization': 'Bearer $token', 'Accept': 'text/event-stream'});
          final res = await _http.send(req).timeout(_timeout);
          if (res.statusCode == 401) {
            fresh = renewed = true;
            unawaited(res.stream.drain<void>().catchError((_) {}));
          } else if (res.statusCode == 200) {
            if (connectedBefore && !stopped) out.add(StachelBoardEvent.reconnected);
            connectedBefore = true;
            final d = done = Completer<void>();
            sub = sseData(res.stream.transform(utf8.decoder).transform(const LineSplitter()))
                .timeout(silence)
                .listen(
                  (data) {
                    try {
                      final e = StachelBoardEvent.fromJson(jsonDecode(data));
                      if (e != null && !stopped) out.add(e);
                    } catch (_) {}
                  },
                  onError: (_) {
                    if (!d.isCompleted) d.complete();
                  },
                  onDone: () {
                    if (!d.isCompleted) d.complete();
                  },
                  cancelOnError: true,
                );
            await d.future;
            await sub?.cancel();
            sub = null;
          } else {
            unawaited(res.stream.drain<void>().catchError((_) {}));
          }
        } on StachelException catch (e) {
          if (e.needsLogin) {
            if (!stopped) out.addError(e);
            return;
          }
        } catch (_) {
          // network: try again
        }
        if (!stopped && !renewed) await wait(retry);
      }
    }

    out = StreamController<StachelBoardEvent>(
      onListen: () => unawaited(loop()),
      onCancel: () async {
        stopped = true;
        pause?.cancel();
        final d = done;
        if (d != null && !d.isCompleted) d.complete();
        await sub?.cancel();
      },
    );
    return out.stream;
  }

  @override
  Future<void> setFavorite(String id, bool favorite) =>
      _send(favorite ? 'PUT' : 'DELETE', '/api/boards/${Uri.encodeComponent(id)}/favorite', write: true);

  @override
  Future<StachelBoardInfo> createBoard(String title) async {
    final res = await _send('POST', '/api/boards', write: true, body: {'title': title.trim()});
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      final b = j is Map ? StachelBoardInfo.fromJson(j['board']) : null;
      if (b != null) return b;
    } catch (_) {}
    throw StachelException.forCode('error');
  }

  @override
  Future<void> renameBoard(String id, String title) =>
      _send('PATCH', '/api/boards/${Uri.encodeComponent(id)}', write: true, body: {'title': title.trim()});

  /// Everyone who ever signed in to Stachel (`GET /api/users`, for @mentions), as key → name.
  Future<List<({String key, String name})>> users() async {
    final res = await _send('GET', '/api/users');
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      final list = j is Map && j['users'] is List ? j['users'] as List : const [];
      return [
        for (final u in list)
          if (u is Map && u['key'] is String && u['name'] is String)
            (key: u['key'] as String, name: u['name'] as String),
      ];
    } catch (_) {
      throw StachelException.forCode('error');
    }
  }

  /// New @mentions and card assignments since [since] (contract §8.11, server time ISO); without: the last 7 days.
  /// Only with a stored session (the background check never creates one): null when there is none.
  Future<StachelInboxPage?> inbox({String? since, bool onlyStored = false}) async {
    if (onlyStored) {
      final login = client.loginKey;
      if (login == null || await StachelSession.load(login) == null) return null;
    }
    final q = since == null ? '' : '?since=${Uri.encodeQueryComponent(since)}';
    final res = await _send('GET', '/api/native/v1/inbox$q');
    try {
      return StachelInboxPage.fromJson(jsonDecode(utf8.decode(res.bodyBytes)));
    } catch (_) {
      throw StachelException.forCode('error');
    }
  }

  /// Uploads an image to [boardId] (`POST /api/boards/:id/images`, multipart field `file`) with progress (0…1).
  /// Returns `(id, width, height)`. Errors: [StachelException] (`network` while offline, `too_large`, …).
  Future<({String id, int width, int height})> uploadImage(
    String boardId,
    Uint8List bytes, {
    required String mime,
    String name = 'foto',
    void Function(double progress)? onProgress,
    bool retried = false,
  }) async {
    final token = await _session();
    final boundary = 'stachel-${DateTime.now().microsecondsSinceEpoch}';
    final ext = switch (mime) {
      'image/png' => 'png',
      'image/webp' => 'webp',
      'image/gif' => 'gif',
      _ => 'jpg',
    };
    final head = utf8.encode(
      '--$boundary\r\nContent-Disposition: form-data; name="file"; filename="$name.$ext"\r\nContent-Type: $mime\r\n\r\n',
    );
    final tail = utf8.encode('\r\n--$boundary--\r\n');
    final total = head.length + bytes.length + tail.length;
    final req = http.StreamedRequest('POST', Uri.parse('$_base/api/boards/${Uri.encodeComponent(boardId)}/images'))
      ..followRedirects = false
      ..contentLength = total
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        'X-Stachel': '1',
        'Content-Type': 'multipart/form-data; boundary=$boundary',
      });
    final http.Response res;
    try {
      final sending = _http.send(req).timeout(const Duration(seconds: 120));
      var sent = 0;
      void add(List<int> chunk) {
        req.sink.add(chunk);
        sent += chunk.length;
        onProgress?.call(sent / total);
      }

      add(head);
      const step = 64 * 1024;
      for (var i = 0; i < bytes.length; i += step) {
        add(Uint8List.sublistView(bytes, i, i + step > bytes.length ? bytes.length : i + step));
        // let the progress show (and the request stream drain) between chunks
        await Future<void>.delayed(Duration.zero);
      }
      add(tail);
      unawaited(req.sink.close());
      res = await http.Response.fromStream(await sending).timeout(_timeout);
    } catch (_) {
      throw StachelException.forCode('network');
    }
    if (res.statusCode == 401 && !retried) {
      await _session(fresh: true);
      return uploadImage(boardId, bytes, mime: mime, name: name, onProgress: onProgress, retried: true);
    }
    final Object? j;
    try {
      j = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      throw StachelException.forCode(res.statusCode >= 500 ? 'network' : 'error');
    }
    if (res.statusCode == 201 && j is Map && j['image'] is Map) {
      final img = j['image'] as Map;
      final id = img['id'], w = img['width'], h = img['height'];
      if (id is String && w is num && h is num) return (id: id, width: w.toInt(), height: h.toInt());
    }
    final code = j is Map && j['error'] is String ? j['error'] as String : null;
    final message = j is Map && j['message'] is String ? j['message'] as String : null;
    throw stachelErrorFrom(status: res.statusCode, code: code, message: message);
  }

  Map<String, Object?> _body(http.Response res) {
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map) return j.cast<String, Object?>();
    } catch (_) {}
    throw StachelException.forCode('error');
  }

  static String _id(String id) => Uri.encodeComponent(id);

  StachelUser? _me;

  @override
  Future<StachelUser> me() async {
    final known = _me;
    if (known != null) return known;
    final u = _body(await _send('GET', '/api/auth/me'))['user'];
    if (u is! Map || u['key'] is! String) throw StachelException.forCode('error');
    return _me = StachelUser(
      u['key'] as String,
      u['name'] is String ? u['name'] as String : '',
      isOrga: u['isOrga'] == true,
    );
  }

  StachelBoardInfo _board(http.Response res) =>
      StachelBoardInfo.fromJson(_body(res)['board']) ?? (throw StachelException.forCode('error'));

  @override
  Future<StachelBoardInfo> duplicateBoard(String id, {String? title, bool template = false}) async => _board(
    await _send(
      'POST',
      '/api/boards/${_id(id)}/duplicate',
      write: true,
      body: {if (title != null) 'title': title.trim(), if (template) 'template': true},
    ),
  );

  @override
  Future<void> deleteBoard(String id) => _send('DELETE', '/api/boards/${_id(id)}', write: true);

  @override
  Future<List<StachelTrashedBoard>> trash() async {
    final list = _body(await _send('GET', '/api/trash'))['boards'];
    if (list is! List) throw StachelException.forCode('error');
    return [for (final b in list) ?StachelTrashedBoard.fromJson(b)];
  }

  @override
  Future<StachelTrashedBoard?> trashInfo(String id) async {
    try {
      return StachelTrashedBoard.fromJson(_body(await _send('GET', '/api/trash/${_id(id)}'))['board']);
    } on StachelException catch (e) {
      if (e.code == 'not_found') return null;
      rethrow;
    }
  }

  @override
  Future<StachelBoardInfo> restoreBoard(String id) async =>
      _board(await _send('POST', '/api/trash/${_id(id)}/restore', write: true));

  @override
  Future<void> purgeBoard(String id) => _send('DELETE', '/api/trash/${_id(id)}', write: true);

  @override
  Future<int> emptyTrash() async {
    final n = _body(await _send('DELETE', '/api/trash', write: true))['purged'];
    return n is num ? n.toInt() : 0;
  }

  @override
  ImageProvider? trashThumbnail(StachelTrashedBoard board) {
    final v = board.board.thumbnailAt;
    if (v == null) return null;
    return StachelThumbnail(
      url: '$_base/api/trash/${_id(board.id)}/thumbnail?v=${Uri.encodeQueryComponent(v)}',
      boardId: board.id,
      version: v,
      token: () => _session(),
      client: _http,
      disk: StachelCache.tryDir('thumbs'),
    );
  }

  String _versions(String boardId) => '/api/boards/${_id(boardId)}/versions';

  @override
  Future<List<Object?>> versions(String boardId) async {
    final list = _body(await _send('GET', _versions(boardId)))['versions'];
    if (list is! List) throw StachelException.forCode('error');
    return list;
  }

  @override
  Future<Object?> saveVersion(String boardId, String name) async =>
      _body(await _send('POST', _versions(boardId), write: true, body: {'name': name}))['version'];

  @override
  Future<Object?> renameVersion(String boardId, String versionId, String name) async => _body(
    await _send('PATCH', '${_versions(boardId)}/${_id(versionId)}', write: true, body: {'name': name}),
  )['version'];

  @override
  Future<bool> restoreVersion(String boardId, String versionId) async =>
      _body(await _send('POST', '${_versions(boardId)}/${_id(versionId)}/restore', write: true))['changed'] == true;

  @override
  Future<StachelBoardInfo> copyVersion(String boardId, String versionId, String title) async =>
      _board(await _send('POST', '${_versions(boardId)}/${_id(versionId)}/copy', write: true, body: {'title': title}));

  @override
  Future<Map<String, Object?>> versionSnapshot(String boardId, String versionId) async =>
      _body(await _send('GET', '/api/native/v1/boards/${_id(boardId)}/versions/${_id(versionId)}/snapshot'));

  /// Private mode (docs/features/private.md §4): `POST /api/boards/:id/private` with [body] (`{action, anonymous?,
  /// ownReveal?, countdown?}`, rights `edit`) → the new `state` (`{on:false}` when off). Throws [StachelException]
  /// with the server's text (`already_running`, `not_running`, `not_facilitator`, `own_reveal_off`).
  Future<Map<String, Object?>> privateMode(String boardId, Map<String, Object?> body) async {
    final s = _body(await _send('POST', '/api/boards/${_id(boardId)}/private', write: true, body: body))['state'];
    return s is Map ? s.cast<String, Object?>() : const {'on': false};
  }

  @override
  Future<String?> uploadThumbnail(String boardId, Uint8List bytes, String mimeType) =>
      _putThumbnail(boardId, bytes, mimeType, retried: false);

  Future<String?> _putThumbnail(String boardId, Uint8List bytes, String mimeType, {required bool retried}) async {
    final token = await _session();
    final http.Response res;
    try {
      res = await _http
          .put(
            Uri.parse('$_base/api/boards/${_id(boardId)}/thumbnail'),
            headers: {
              'Authorization': 'Bearer $token',
              'X-Stachel': '1',
              'Content-Type': mimeType,
              'Accept': 'application/json',
            },
            body: bytes,
          )
          .timeout(_timeout);
    } catch (_) {
      throw StachelException.forCode('network');
    }
    if (res.statusCode == 401 && !retried) {
      await _session(fresh: true);
      return _putThumbnail(boardId, bytes, mimeType, retried: true);
    }
    if (res.statusCode != 200) throw StachelException.forCode(res.statusCode >= 500 ? 'network' : 'error');
    final at = _body(res)['thumbnailAt'];
    return at is String ? at : null;
  }

  @override
  Future<Map<String, Object?>> tokens() async => _body(await _send('GET', '/api/tokens'));

  @override
  Future<Map<String, Object?>> createToken(String label) async =>
      _body(await _send('POST', '/api/tokens', write: true, body: {'label': label.trim()}));

  @override
  Future<void> revokeToken(String id) => _send('DELETE', '/api/tokens/${_id(id)}', write: true);

  @override
  Future<List<Object?>> ownTemplates() async {
    final list = _body(await _send('GET', '/api/templates'))['templates'];
    return list is List ? list : const [];
  }

  @override
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects) async =>
      _body(await _send('POST', '/api/templates', write: true, body: {'name': name, 'objects': objects}))['template'];

  @override
  Future<void> deleteOwnTemplate(String id) => _send('DELETE', '/api/templates/${_id(id)}', write: true);

  @override
  Future<Object?> instanceTemplates() async => _body(await _send('GET', '/api/templates/instance'));

  // sharing (contract §6, only in instances with own accounts)

  String _boardPath(String boardId) => '/api/boards/${_id(boardId)}';

  StachelShareInfo _share(http.Response res) => StachelShareInfo.fromJson(_body(res));

  @override
  Future<StachelShareInfo> shareInfo(String boardId) async =>
      _share(await _send('GET', '${_boardPath(boardId)}/share'));

  @override
  Future<StachelShareInfo> invite(String boardId, List<String> emails, String role) async =>
      _share(await _send('POST', '${_boardPath(boardId)}/share', write: true, body: {'emails': emails, 'role': role}));

  @override
  Future<StachelShareInfo> setMemberRole(String boardId, String key, String role) async =>
      _share(await _send('PATCH', '${_boardPath(boardId)}/members/${_id(key)}', write: true, body: {'role': role}));

  @override
  Future<StachelShareInfo?> removeMember(String boardId, String key) async {
    final j = _body(await _send('DELETE', '${_boardPath(boardId)}/members/${_id(key)}', write: true));
    return j['left'] == true ? null : StachelShareInfo.fromJson(j);
  }

  @override
  Future<StachelShareInfo> removeInvite(String boardId, String email) async =>
      _share(await _send('DELETE', '${_boardPath(boardId)}/invites/${_id(email)}', write: true));

  @override
  Future<StachelShareInfo> setLink(String boardId, String? role) async =>
      _share(await _send('PUT', '${_boardPath(boardId)}/link', write: true, body: {'role': role}));

  @override
  Future<StachelShareInfo> transferOwner(String boardId, String key) async =>
      _share(await _send('POST', '${_boardPath(boardId)}/owner', write: true, body: {'key': key}));

  @override
  ImageProvider? thumbnail(StachelBoardInfo board) {
    final v = board.thumbnailAt;
    if (v == null) return null;
    return StachelThumbnail(
      url: '$_base/api/boards/${Uri.encodeComponent(board.id)}/thumbnail?v=${Uri.encodeQueryComponent(v)}',
      boardId: board.id,
      version: v,
      token: () => _session(),
      client: _http,
      disk: StachelCache.tryDir('thumbs'),
    );
  }
}

/// Preview image of a board, kept on disk per version (`thumbnailAt`; the server sends a versioned thumbnail
/// `immutable`): the list shows previews offline and does not download them on every start. A new version replaces
/// the old file. Fetched with `Authorization: Bearer sts_…` (contract §8.3).
class StachelThumbnail extends ImageProvider<StachelThumbnail> {
  const StachelThumbnail({
    required this.url,
    required this.boardId,
    required this.version,
    required this.token,
    required this.client,
    this.disk,
  });

  final String url;
  final String boardId;
  final String version;
  final Future<String> Function() token;
  final http.Client client;
  final Future<Directory?>? disk;

  @override
  Future<StachelThumbnail> obtainKey(ImageConfiguration configuration) => SynchronousFuture(this);

  @override
  ImageStreamCompleter loadImage(StachelThumbnail key, ImageDecoderCallback decode) =>
      MultiFrameImageStreamCompleter(codec: _load(decode), scale: 1, debugLabel: 'stachel-thumb-$boardId');

  String get _boardPart => boardId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '');

  /// `thumb_<hash of board + version>_<board>.img`
  String get fileName =>
      'thumb_${sha256.convert(utf8.encode('$boardId|$version')).toString().substring(0, 24)}_$_boardPart.img';

  Future<ui.Codec> _load(ImageDecoderCallback decode) async {
    Directory? dir;
    try {
      dir = await disk;
    } catch (_) {}
    final file = dir == null ? null : File('${dir.path}/$fileName');
    Uint8List? bytes;
    try {
      if (file != null && await file.exists()) bytes = await file.readAsBytes();
    } catch (_) {}
    if (bytes == null) {
      final res = await client
          .get(Uri.parse(url), headers: {'Authorization': 'Bearer ${await token()}'})
          .timeout(const Duration(seconds: 20));
      if (res.statusCode != 200 || res.bodyBytes.isEmpty) throw StateError('Vorschaubild ${res.statusCode}');
      bytes = res.bodyBytes;
      if (file != null && dir != null) await _store(dir, file, bytes);
    }
    return decode(await ui.ImmutableBuffer.fromUint8List(bytes));
  }

  /// Writes the new version and removes older versions of this board.
  Future<void> _store(Directory dir, File file, Uint8List bytes) async {
    try {
      await file.writeAsBytes(bytes);
      final suffix = '_$_boardPart.img';
      await for (final e in dir.list()) {
        final name = e.uri.pathSegments.last;
        if (e is File && name.endsWith(suffix) && name != fileName) await e.delete();
      }
    } catch (_) {}
  }

  @override
  bool operator ==(Object other) =>
      other is StachelThumbnail && other.url == url && other.boardId == boardId && other.version == version;

  @override
  int get hashCode => Object.hash(url, boardId, version);
}
