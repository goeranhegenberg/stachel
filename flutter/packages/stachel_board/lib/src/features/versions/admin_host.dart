import 'dart:typed_data';

import '../../editor/registry/board_ui.dart';

/// Services of the app for the P6 entries (board management, audit §4 P6): copies and templates, version history,
/// export (share a file), the preview image and the AI access tokens. The app's [BoardHost] implements this
/// interface; entries look it up with [adminHost] and hide themselves when the host has none (tests, debug screen).
///
/// Every method throws on failure; [errorText] turns the error into the German text the web shows.
abstract interface class BoardAdminHost {
  /// Text of an error from one of the methods (server message, „Keine Verbindung …“).
  String errorText(Object error);

  /// The board is a template (B02/B16: hint „Vorlage“ next to the title).
  bool get isTemplate;

  /// Title of the board as shown (copies: „Titel (Stand 28.10., 14:20)“).
  String get boardTitle;

  // ---- copies (B10/B11, web `tools.boardDuplicate`/`tools.boardTemplate`) ----------------------------------------

  /// „Board duplizieren“: `POST /api/boards/:id/duplicate {}`; the host opens the copy.
  Future<void> duplicateBoard();

  /// „Als Vorlage speichern“: `POST …/duplicate {template:true}`.
  Future<void> saveAsTemplate();

  // ---- versions (N01–N06, contract §3 „Versionen“, §8.14) --------------------------------------------------------

  Future<List<BoardVersion>> listVersions();
  Future<BoardVersion> saveVersion(String name);

  /// Empty [name] = name removed.
  Future<BoardVersion> renameVersion(String id, String name);

  /// Restores for everyone; returns false when the board already had that state („Das Board hat schon den Stand …“).
  Future<bool> restoreVersion(String id);

  /// New board with the content of the version ([title] = „Titel (Stand …)“); the host opens it.
  Future<void> openVersionCopy(String id, String title);

  /// `GET /api/native/v1/boards/:id/versions/:vid/snapshot` as JSON (`{board, version, below, snapshot}`).
  Future<Map<String, Object?>> versionSnapshot(String id);

  // ---- export (N07/N08) and preview image (N09) ------------------------------------------------------------------

  /// Hands a file to the system share sheet („Teilen“ instead of the web's download).
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType);

  /// `PUT /api/boards/:id/thumbnail` (PNG/JPEG/WebP, at most 2048 px); returns the new `thumbnailAt`.
  Future<String?> uploadThumbnail(Uint8List bytes, String mimeType);

  // ---- AI access (B13, `/api/tokens`) ----------------------------------------------------------------------------

  Future<McpTokens> listTokens();

  /// New token (label empty = „KI-Assistent“ on the server): secret shown once.
  Future<McpNewToken> createToken(String label);
  Future<void> revokeToken(String id);

  /// System share sheet with text (token + setup, instead of the web's „Kopieren“).
  Future<void> shareText(String text, {String? subject});

  /// Copies [text] to the clipboard.
  Future<void> copyText(String text);
}

/// The [BoardAdminHost] of [ui] (null: hide the P6 entries).
BoardAdminHost? adminHost(BoardUi ui) => ui.host is BoardAdminHost ? ui.host as BoardAdminHost : null;

/// Someone in a version (`BoardVersionPerson`).
class VersionPerson {
  const VersionPerson(this.key, this.name);
  final String key;
  final String name;

  static VersionPerson? fromJson(Object? j) =>
      j is Map && j['key'] is String && j['name'] is String ? VersionPerson(j['key'] as String, j['name'] as String) : null;
}

/// One version of a board (`BoardVersionInfo`, contract §3).
class BoardVersion {
  const BoardVersion({
    required this.id,
    required this.createdAt,
    required this.kind,
    this.name,
    this.people = const [],
    this.by,
    this.restoredFrom,
    this.objects = 0,
  });

  /// Null when [j] is no version.
  static BoardVersion? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    final at = DateTime.tryParse(j['createdAt'] is String ? j['createdAt'] as String : '');
    if (at == null) return null;
    final name = j['name'];
    return BoardVersion(
      id: j['id'] as String,
      createdAt: at,
      kind: j['kind'] is String ? j['kind'] as String : 'auto',
      name: name is String && name.isNotEmpty ? name : null,
      people: [for (final p in (j['people'] is List ? j['people'] as List : const [])) ?VersionPerson.fromJson(p)],
      by: VersionPerson.fromJson(j['by']),
      restoredFrom: DateTime.tryParse(j['restoredFrom'] is String ? j['restoredFrom'] as String : ''),
      objects: j['objects'] is num ? (j['objects'] as num).toInt() : 0,
    );
  }

  final String id;
  final DateTime createdAt;

  /// `auto` · `manual` („Version speichern“) · `backup` (before restoring) · `restored`.
  final String kind;
  final String? name;

  /// Who changed the board since the previous version.
  final List<VersionPerson> people;

  /// Who saved / restored.
  final VersionPerson? by;
  final DateTime? restoredFrom;
  final int objects;
}

/// One AI access token (`GET /api/tokens`).
class McpToken {
  const McpToken({
    required this.id,
    required this.label,
    this.hint = '',
    this.createdAt,
    this.lastUsedAt,
    this.expiresAt,
  });

  static McpToken? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    DateTime? t(String k) => DateTime.tryParse(j[k] is String ? j[k] as String : '');
    return McpToken(
      id: j['id'] as String,
      label: j['label'] is String ? j['label'] as String : 'KI-Assistent',
      hint: j['hint'] is String ? j['hint'] as String : '',
      createdAt: t('createdAt'),
      lastUsedAt: t('lastUsedAt'),
      expiresAt: t('expiresAt'),
    );
  }

  final String id;
  final String label;

  /// Last 4 characters of the secret („…a1b2“).
  final String hint;
  final DateTime? createdAt;
  final DateTime? lastUsedAt;

  /// The server deletes a token unused for 12 months (`expiresAt` = last use or creation + 365 days, legal CR-9).
  final DateTime? expiresAt;
}

/// The tokens of the asking person plus the MCP address of the server.
class McpTokens {
  const McpTokens(this.tokens, this.mcpUrl);
  final List<McpToken> tokens;
  final String mcpUrl;
}

/// A new token: [secret] (`stk_…`) is shown only once.
class McpNewToken {
  const McpNewToken({required this.token, required this.secret, required this.mcpUrl});
  final McpToken token;
  final String secret;
  final String mcpUrl;
}
