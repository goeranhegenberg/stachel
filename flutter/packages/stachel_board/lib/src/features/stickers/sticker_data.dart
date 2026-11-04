import 'dart:convert';

import '../../web/web_constants.dart';
import '../shapes/catalog.dart';

// Stamps, emoji and icons of the web (`features/shapes/stamps.tsx`, `emoji.ts`, `iconSet.ts`) from the web constants
// (audit §3.3), placing them like `stickers.tsx` (`objectFor`) and the recently used emoji (`recentEmoji`).

/// A stamp (round badge, glyph from the web's SVG in a 64 grid).
class StampDef {
  const StampDef(this.id, this.label, this.bg, this.ink, this.glyph);
  final String id;
  final String label;
  final String bg;
  final String ink;

  /// SVG nodes `[tag, attrs, children?]` (path, text, g).
  final List<Object?> glyph;
}

class EmojiEntry {
  const EmojiEntry(this.ch, this.keys, this.group);
  final String ch;
  final String keys;
  final String group;
}

class EmojiGroup {
  const EmojiGroup(this.id, this.label, this.items);
  final String id;
  final String label;
  final List<EmojiEntry> items;
}

class IconEntry {
  const IconEntry(this.name, this.label, this.keys, this.group, this.node);
  final String name;
  final String label;
  final String keys;
  final String group;

  /// lucide drawing `[[tag, attrs], …]` (24 grid) – stored in the object as `iconNode`.
  final List<Object?> node;
}

/// Sizes of new stickers (web `STAMP_SIZE`, `EMOJI_SIZE`, `ICON_SIZE`).
double get stampSize => WebConstants.instance.number('stickers.sizes.stamp') ?? 72;
double get emojiSize => WebConstants.instance.number('stickers.sizes.emoji') ?? 96;
double get iconSize => WebConstants.instance.number('stickers.sizes.icon') ?? 64;

final List<StampDef> stamps = [
  for (final s in WebConstants.instance.maps('stickers.stamps'))
    StampDef(
      s['id'] as String,
      s['label'] as String,
      s['bg'] as String,
      s['ink'] as String,
      (s['glyph'] as List?) ?? const [],
    ),
];

StampDef? stampById(String? id) => stamps.where((s) => s.id == id).firstOrNull;

final List<EmojiGroup> emojiGroups = [
  for (final g in WebConstants.instance.maps('stickers.emojiGroups'))
    EmojiGroup(g['id'] as String, g['label'] as String, [
      for (final e in (g['items'] as List).cast<Map<String, Object?>>())
        EmojiEntry(e['ch'] as String, e['keys'] as String, e['group'] as String),
    ]),
];

/// Every emoji once (the same sign in several groups: keys merged, like the web's `ALL_EMOJI`).
final List<EmojiEntry> allEmoji = () {
  final seen = <String, EmojiEntry>{};
  for (final g in emojiGroups) {
    for (final e in g.items) {
      final prev = seen[e.ch];
      seen[e.ch] = prev == null ? e : EmojiEntry(e.ch, '${prev.keys} ${e.keys}', prev.group);
    }
  }
  return seen.values.toList();
}();

/// Emoji matching [q] (web `searchEmoji`; the library shows at most 160).
List<EmojiEntry> searchEmoji(String q) => [
  for (final e in allEmoji)
    if (searchMatches(q, [e.keys])) e,
];

final List<IconEntry> icons = [
  for (final i in WebConstants.instance.maps('stickers.icons'))
    IconEntry(
      i['name'] as String,
      i['label'] as String,
      (i['keys'] as String?) ?? '',
      i['group'] as String,
      (i['node'] as List?) ?? const [],
    ),
];

/// Icon groups in the web's order.
List<String> get iconGroups => WebConstants.instance.strings('stickers.iconGroups');

// ---- what the sticker tool places (web `PlaceItem`) -------------------------------------------------------------------

/// A stamp, an emoji or an icon (the sticker tool's current item).
sealed class PlaceItem {
  const PlaceItem();

  /// Widget key suffix and equality: `stamp-like`, `emoji-👍`, `icon-star`.
  String get key;

  @override
  bool operator ==(Object other) => other is PlaceItem && other.key == key;
  @override
  int get hashCode => key.hashCode;
}

class StampItem extends PlaceItem {
  const StampItem(this.id);
  final String id;
  @override
  String get key => 'stamp-$id';
}

class EmojiItem extends PlaceItem {
  const EmojiItem(this.ch);
  final String ch;
  @override
  String get key => 'emoji-$ch';
}

class IconItem extends PlaceItem {
  IconItem(this.icon);
  final IconEntry icon;
  @override
  String get key => 'icon-${icon.name}';
}

double _round(double v) => (v + 0.5).floorToDouble();

/// The new object for [item] centered at ([x], [y]) (web `objectFor`).
Map<String, Object?> stickerObjectFor(PlaceItem item, double x, double y) {
  switch (item) {
    case StampItem(:final id):
      final s = stampSize;
      return {'type': 'sticker', 'stamp': id, 'x': _round(x - s / 2), 'y': _round(y - s / 2), 'w': s, 'h': s};
    case EmojiItem(:final ch):
      final s = emojiSize;
      return {'type': 'sticker', 'emoji': ch, 'x': _round(x - s / 2), 'y': _round(y - s / 2), 'w': s, 'h': s};
    case IconItem(:final icon):
      final s = iconSize;
      return {
        'type': 'icon',
        'icon': icon.name,
        'iconNode': icon.node,
        'color': '#0a0a0a',
        'x': _round(x - s / 2),
        'y': _round(y - s / 2),
        'w': s,
        'h': s,
      };
  }
}

// ---- recently used emoji (web `recentEmoji`/`rememberEmoji`: 12, per device) ----------------------------------------

/// The web's start list when nothing was used yet (`DEFAULT_RECENT` in `emoji.ts`).
const defaultRecentEmoji = ['👍', '❤️', '🎉', '✅', '🔥', '🌵'];

/// Key of the setting on the device (`BoardHost.readSetting`; the web's `localStorage` key).
const recentEmojiSetting = 'stachel.shapes.recentEmoji';

/// Recently used emoji of this device (loaded once from the host's settings, see [RecentEmoji.load]).
class RecentEmoji {
  RecentEmoji._();

  static List<String>? _list;
  static bool _loading = false;

  static List<String> get list => _list ?? defaultRecentEmoji;

  /// Loads the list from the device once (no-op afterwards); [read] is the host's `readSetting`.
  static Future<void> load(Future<String?> Function(String key) read) async {
    if (_list != null || _loading) return;
    _loading = true;
    try {
      final raw = await read(recentEmojiSetting);
      final v = raw == null ? null : parseList(raw);
      _list ??= v;
    } catch (_) {
      // nothing stored or unreadable: the default list
    } finally {
      _loading = false;
    }
  }

  /// Puts [ch] first (12 at most) and stores the list with [write].
  static void remember(String ch, Future<void> Function(String key, String value) write) {
    _list = [ch, ...list.where((x) => x != ch)].take(12).toList();
    write(recentEmojiSetting, jsonEncode(_list)).catchError((_) {});
  }

  /// The stored JSON list of strings (null if it is something else).
  static List<String>? parseList(String raw) {
    final v = jsonDecode(raw);
    return v is List && v.every((x) => x is String) ? v.cast<String>().take(12).toList() : null;
  }

  /// Tests: forget what was loaded/used.
  static void resetForTest() {
    _list = null;
    _loading = false;
  }
}
