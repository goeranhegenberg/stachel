// Test helpers of the package: a [StachelClient] of an instance with own accounts (`showsRoles`), a fake Stachel server
// (board list with roles, sharing routes of `server/src/access-routes.ts`) over `MockClient`, and the HTTP API without
// live events and preview images.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

/// The app around the shared screens: the Stachel app against an instance with own accounts (or, with
/// [showsRoles] false, like a host app in mode org).
class TestStachelClient extends StachelClient {
  TestStachelClient(this.httpClient, {this.showsRoles = true});

  @override
  final http.Client httpClient;

  @override
  final bool showsRoles;

  @override
  String get base => 'https://stachel.test';

  @override
  String get appName => 'Stachel-App';

  @override
  String? get clientId => 'stachel';

  @override
  String? get loginKey => 'flo@test.de';

  @override
  Future<String> newSession(String base) async => 'sts_test';

  /// Messages of [loginLost].
  final lost = <String?>[];

  @override
  void loginLost(BuildContext context, {String? message}) => lost.add(message);

  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {}

  @override
  BoardRegistry get registry => stachelBoardRegistry;
}

/// [HttpStachelBoardsApi] without the SSE stream (tests push [live]) and without preview images.
class TestBoardsApi extends HttpStachelBoardsApi {
  TestBoardsApi(super.client);

  final live = StreamController<StachelBoardEvent>.broadcast(sync: true);

  @override
  Stream<StachelBoardEvent> events({
    Duration retry = const Duration(seconds: 3),
    Duration silence = const Duration(seconds: 70),
  }) => live.stream;

  @override
  ImageProvider? thumbnail(StachelBoardInfo board) => null;
}

/// One request the fake server got.
typedef SeenRequest = ({String method, String path, Object? body, bool write});

/// Stachel of an instance with own accounts: me = `u:flo` (Flo), boards with roles, the sharing state of every board
/// like `shareInfo` in `server/src/access-routes.ts`.
class FakeStachelServer {
  FakeStachelServer({this.myRole = 'owner'});

  /// Own role in the sharing dialog (every board answers with the sharing state of `b1`).
  String myRole;
  final requests = <SeenRequest>[];

  List<Map<String, Object?>> boards = [
    {'id': 'b1', 'title': 'Festival', 'createdBy': 'u:flo', 'createdByName': 'Flo', 'role': 'owner'},
    {'id': 'b2', 'title': 'Bühne', 'createdBy': 'u:mara', 'createdByName': 'Mara', 'role': 'edit'},
    {'id': 'b3', 'title': 'Deko', 'createdBy': 'u:mara', 'createdByName': 'Mara', 'role': 'comment'},
    {'id': 'b4', 'title': 'Kasse', 'createdBy': 'u:jo', 'createdByName': 'Jo', 'role': 'view'},
  ];

  /// People of `b1` (besides the owner Flo or whoever owns it now).
  List<Map<String, Object?>> people = [
    {'key': 'u:flo', 'name': 'Flo', 'email': 'flo@test.de', 'role': 'owner', 'via': 'owner'},
    {'key': 'u:mara', 'name': 'Mara', 'email': 'mara@test.de', 'role': 'edit', 'via': 'member'},
    {'key': 'u:jo', 'name': 'Jo', 'email': 'jo@test.de', 'role': 'view', 'via': 'link'},
  ];
  List<Map<String, Object?>> invites = [
    {'email': 'neu@test.de', 'role': 'comment'},
  ];
  String? link = 'view';

  bool get _manage => myRole == 'owner' || myRole == 'edit';

  Map<String, Object?> share() => {
    'ok': true,
    'title': 'Festival',
    'role': myRole,
    'canManage': _manage,
    'people': [
      for (final p in people) {...p, 'email': _manage ? p['email'] : null},
    ],
    'invites': _manage ? invites : const [],
    'link': link,
    'url': 'https://stachel.test/b/b1',
  };

  Iterable<SeenRequest> calls(String method, String path) =>
      requests.where((r) => r.method == method && r.path == path);

  late final http.Client client = MockClient((req) async {
    final path = req.url.path;
    final body = req.body.isEmpty ? null : jsonDecode(req.body);
    requests.add((method: req.method, path: path, body: body, write: req.headers['X-Stachel'] == '1'));
    if (req.headers['Authorization'] != 'Bearer sts_test') return json({'ok': false, 'error': 'invalid_token'}, 401);
    if (path == '/api/boards' && req.method == 'GET') return json({'ok': true, 'boards': boards});
    if (path == '/api/auth/me') {
      return json({
        'ok': true,
        'user': {'key': 'u:flo', 'name': 'Flo'},
      });
    }
    if (path == '/api/trash') return json({'ok': true, 'boards': []});
    if (path == '/api/users') return json({'ok': true, 'users': []});
    final m = RegExp(r'^/api/boards/[^/]+/(share|members/([^/]+)|invites/([^/]+)|link|owner)$').firstMatch(path);
    if (m == null) return json({'ok': false, 'error': 'not_found', 'message': 'Gibt es nicht.'}, 404);
    final what = m.group(1)!;
    final b = body is Map ? body : const {};
    if (what == 'share' && req.method == 'GET') return json(share());
    if (!_manage && !(what.startsWith('members/') && req.method == 'DELETE')) {
      return json({
        'ok': false,
        'error': 'no_permission',
        'message': 'Teilen dürfen nur Besitzer:in und wer bearbeiten darf.',
      }, 403);
    }
    if (what == 'share') {
      final emails = (b['emails'] as List).cast<String>();
      final bad = emails.where((e) => !e.contains('@'));
      if (bad.isNotEmpty) {
        return json({
          'ok': false,
          'error': 'invalid_email',
          'message': 'Diese Adresse stimmt nicht: ${bad.first}',
        }, 400);
      }
      for (final e in emails) {
        if (e == 'lena@test.de') {
          people.add({'key': 'u:lena', 'name': 'Lena', 'email': e, 'role': b['role'], 'via': 'member'});
        } else {
          invites = [
            for (final i in invites)
              if (i['email'] != e) i,
            {'email': e, 'role': b['role']},
          ];
        }
      }
      return json(share());
    }
    final key = m.group(2);
    if (key != null) {
      final k = Uri.decodeComponent(key);
      if (req.method == 'DELETE') {
        people.removeWhere((p) => p['key'] == k);
        if (k == 'u:flo') return json({'ok': true, 'left': true});
        return json(share());
      }
      for (final p in people) {
        if (p['key'] == k) p['role'] = b['role'];
      }
      return json(share());
    }
    final email = m.group(3);
    if (email != null) {
      invites.removeWhere((i) => i['email'] == Uri.decodeComponent(email));
      return json(share());
    }
    if (what == 'link') {
      link = b['role'] as String?;
      return json(share());
    }
    // owner
    for (final p in people) {
      if (p['key'] == b['key']) {
        p['role'] = 'owner';
        p['via'] = 'owner';
      } else if (p['role'] == 'owner') {
        p['role'] = 'edit';
        p['via'] = 'member';
      }
    }
    myRole = 'edit';
    return json(share());
  });
}
