/// Instances of the Stachel app (concept `docs/stachel_app_konzept.md` §3).
class StachelConfig {
  StachelConfig._();

  /// Standard instance with own accounts (mode `local`). `--dart-define=STACHEL_BASE=http://10.0.2.2:8690` for the
  /// sandbox (plain http only in debug builds).
  static const accountsBase = String.fromEnvironment('STACHEL_BASE', defaultValue: 'https://stachel.intsode.com');

  /// Instances in mode `org` offered under „Bei einer Organisation anmelden“ (comma separated,
  /// `--dart-define=STACHEL_ORG_INSTANCES=https://board.example.org`); default none – the person types the address, the
  /// app remembers the ones used before.
  static const orgInstancesDefine = String.fromEnvironment('STACHEL_ORG_INSTANCES');

  static List<String> get orgInstances => [for (final s in orgInstancesDefine.split(',')) ?normalizeInstance(s)];

  /// `x.y.z+build` of this app (set by the Flutter tool).
  static const appVersion =
      '${String.fromEnvironment('FLUTTER_BUILD_NAME', defaultValue: '0.0.0')}'
      '+${String.fromEnvironment('FLUTTER_BUILD_NUMBER', defaultValue: '0')}';
}

/// The origin of a Stachel instance typed by a person (`board.example.org`, `https://board.example.org/app/?b=x`):
/// `https://` when no scheme is given, only http(s), no user info; path, query and fragment are dropped. Null = no
/// address.
String? normalizeInstance(String input) {
  var t = input.trim();
  if (t.isEmpty) return null;
  if (!t.contains('://')) t = 'https://$t';
  final u = Uri.tryParse(t);
  if (u == null || u.host.isEmpty || u.userInfo.isNotEmpty) return null;
  final scheme = u.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  if (!RegExp(r'^[a-z0-9.-]+$').hasMatch(u.host.toLowerCase())) return null;
  final port = u.hasPort && u.port != (scheme == 'https' ? 443 : 80) ? ':${u.port}' : '';
  return '$scheme://${u.host.toLowerCase()}$port';
}
