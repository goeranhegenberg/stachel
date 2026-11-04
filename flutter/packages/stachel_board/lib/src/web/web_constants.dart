import 'dart:convert';

import 'web_constants.g.dart';

/// The web app's constants (contract §8.13, parity audit §3.3) from `web_constants.g.dart`: palettes, font sizes,
/// shape catalog, stickers/emoji/icons, templates, card status, timeline/mind map values, reactions, timer presets,
/// frame formats. Packages read what they need by path (`WebConstants.instance.strings('colors.sticky')`) instead of
/// copying values; a new key in the web needs no change here. Regenerate with `dart run tool/gen_web_constants.dart`.
class WebConstants {
  WebConstants._(this.raw);

  static WebConstants? _instance;

  /// The bundled constants (parsed on first use).
  static WebConstants get instance => _instance ??= WebConstants._(jsonDecode(webConstantsJson) as Map<String, Object?>);

  /// Everything as decoded JSON.
  final Map<String, Object?> raw;

  int get version => (raw['version'] as num?)?.toInt() ?? 0;

  /// The value at a dotted [path] (`colors.sticky`, `timeline.layout.rowH`); null if missing.
  Object? value(String path) {
    Object? v = raw;
    for (final k in path.split('.')) {
      if (v is Map) {
        v = v[k];
      } else if (v is List) {
        final i = int.tryParse(k);
        v = i == null || i < 0 || i >= v.length ? null : v[i];
      } else {
        return null;
      }
    }
    return v;
  }

  /// A list of strings at [path] (empty if missing).
  List<String> strings(String path) => [
    for (final s in (value(path) is List ? value(path) as List : const []))
      if (s is String) s,
  ];

  /// A list of numbers at [path] (empty if missing).
  List<double> numbers(String path) => [
    for (final n in (value(path) is List ? value(path) as List : const []))
      if (n is num) n.toDouble(),
  ];

  /// A list of objects at [path] (empty if missing).
  List<Map<String, Object?>> maps(String path) => [
    for (final m in (value(path) is List ? value(path) as List : const []))
      if (m is Map) m.cast<String, Object?>(),
  ];

  /// A number at [path] (null if missing).
  double? number(String path) => value(path) is num ? (value(path) as num).toDouble() : null;

  /// A string at [path] (null if missing).
  String? string(String path) => value(path) is String ? value(path) as String : null;
}
