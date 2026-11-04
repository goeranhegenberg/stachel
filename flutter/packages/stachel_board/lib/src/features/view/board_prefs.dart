import 'package:flutter/foundation.dart';

/// Small per-device settings of the board UI the web keeps in `localStorage` (minimap open, presentation in
/// fullscreen, last frame format …). The package has no storage of its own: values live in memory and go to
/// [persist] (the app writes them to SharedPreferences and hands them back with [load] at start).
class BoardPrefs {
  BoardPrefs._();

  static final _values = <String, String>{};

  /// Called for every change (null = removed); the app stores the value.
  static void Function(String key, String? value)? persist;

  /// Bumped on every change (widgets listen to it).
  static final changes = ValueNotifier<int>(0);

  /// Takes stored values (app start).
  static void load(Map<String, String> values) {
    _values
      ..clear()
      ..addAll(values);
    changes.value++;
  }

  static String? get(String key) => _values[key];

  static void set(String key, String? value) {
    if (_values[key] == value) return;
    if (value == null) {
      _values.remove(key);
    } else {
      _values[key] = value;
    }
    persist?.call(key, value);
    changes.value++;
  }

  /// All stored values (for the app's storage).
  static Map<String, String> get all => Map.unmodifiable(_values);

  /// Keys (prefixed like the web's `localStorage` keys).
  static const minimap = 'stachel.minimap';
  static const presentFullscreen = 'stachel.structure.presentFullscreen';
  static const framePreset = 'stachel.tool.frame.preset';
}
