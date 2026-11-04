import 'package:flutter/foundation.dart';
import 'package:stachel_client/stachel_client.dart';

/// Links that open the Stachel app (Android App Links / iOS Universal Links on the instance with own accounts, contract
/// §6): `/b/<board>[?o=<object>]` (also `/?b=<board>`), `/verify/<token>`, `/reset/<token>` – each also under the web
/// app's path (`STACHEL_BASE_PATH`, e.g. `/app/b/<board>`, `/app/?b=<board>`; server `site.ts`). Only links of exactly
/// [base] count (scheme, host, port, no user info).
sealed class AppLink {
  const AppLink();
}

class BoardAppLink extends AppLink {
  const BoardAppLink(this.boardId, [this.objectId]);
  final String boardId;
  final String? objectId;
  @override
  bool operator ==(Object other) => other is BoardAppLink && other.boardId == boardId && other.objectId == objectId;
  @override
  int get hashCode => Object.hash(boardId, objectId);
}

class VerifyAppLink extends AppLink {
  const VerifyAppLink(this.token);
  final String token;
  @override
  bool operator ==(Object other) => other is VerifyAppLink && other.token == token;
  @override
  int get hashCode => token.hashCode;
}

class ResetAppLink extends AppLink {
  const ResetAppLink(this.token);
  final String token;
  @override
  bool operator ==(Object other) => other is ResetAppLink && other.token == token;
  @override
  int get hashCode => token.hashCode;
}

/// Mail tokens: base64url, 20–100 characters (server `accounts.ts`).
final _token = RegExp(r'^[A-Za-z0-9_-]{20,100}$');

/// First path segment of the web app on the server (`STACHEL_BASE_PATH`); links work with and without it.
const webAppPath = 'app';

/// The app link in [uri] for the instance [base], null for anything else.
AppLink? appLinkFrom(Uri uri, String base) {
  if (!stachelUrlMatches(uri, base)) return null;
  var segs = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segs.isNotEmpty && segs.first == webAppPath) segs = segs.sublist(1);
  if (segs.length == 2 && segs[0] == 'b') {
    return stachelBoardIdPattern.hasMatch(segs[1]) ? BoardAppLink(segs[1], _objectOf(uri)) : null;
  }
  if (segs.length == 2 && segs[0] == 'verify') return _token.hasMatch(segs[1]) ? VerifyAppLink(segs[1]) : null;
  if (segs.length == 2 && segs[0] == 'reset') return _token.hasMatch(segs[1]) ? ResetAppLink(segs[1]) : null;
  if (segs.isEmpty) {
    final q = uri.queryParametersAll;
    String? one(String k) => q[k] != null && q[k]!.length == 1 ? q[k]!.single : null;
    final v = one('verify'), r = one('reset'), b = one('b');
    if (v != null) return _token.hasMatch(v) ? VerifyAppLink(v) : null;
    if (r != null) return _token.hasMatch(r) ? ResetAppLink(r) : null;
    if (b != null && !q.containsKey('offline')) {
      return stachelBoardIdPattern.hasMatch(b) ? BoardAppLink(b, _objectOf(uri)) : null;
    }
  }
  return null;
}

/// The link pasted by a person (from the mail): the same rules as [appLinkFrom], surrounding text ignored.
AppLink? appLinkFromText(String text, String base) {
  for (final m in RegExp(r'https?://\S+').allMatches(text)) {
    final uri = Uri.tryParse(m.group(0)!.replaceAll(RegExp(r'[>)\].,;]+$'), ''));
    final link = uri == null ? null : appLinkFrom(uri, base);
    if (link != null) return link;
  }
  return null;
}

String? _objectOf(Uri uri) {
  final o = uri.queryParametersAll['o'];
  return o != null && o.length == 1 && stachelBoardIdPattern.hasMatch(o.single) ? o.single : null;
}

/// Own URL scheme of the desktop apps (Windows registry / MSIX protocol, Linux `x-scheme-handler`).
const desktopScheme = 'stachel';

/// Incoming links; the root screen takes them from [pending].
class StachelAppLinks {
  StachelAppLinks(this.base);
  final String base;
  final pending = ValueNotifier<AppLink?>(null);

  /// True if [uri] was a link of this app. Desktop also takes `stachel://<host>/<path>` (URL protocol registered by the
  /// installers, docs/release/desktop.md) – the same link as `https://<host>/<path>`.
  bool handle(Uri uri) {
    if (uri.scheme == desktopScheme) uri = uri.replace(scheme: Uri.parse(base).scheme);
    final link = appLinkFrom(uri, base);
    if (link == null) return false;
    pending.value = link;
    return true;
  }

  AppLink? take() {
    final l = pending.value;
    pending.value = null;
    return l;
  }
}
