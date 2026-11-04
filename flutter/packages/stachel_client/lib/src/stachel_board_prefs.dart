import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';

/// Device settings of the board UI (P4: minimap open, presentation in fullscreen, snap to grid …) – the web keeps
/// them in `localStorage`, the app in SharedPreferences under `stachel_board_pref:<key>`. Loaded once per app start.
const _prefix = 'stachel_board_pref:';
bool _loaded = false;

Future<void> loadStachelBoardPrefs() async {
  if (_loaded) return;
  _loaded = true;
  try {
    final prefs = await SharedPreferences.getInstance();
    // storage first, then the values: whoever listens to `BoardPrefs.changes` (UX P5 gesture introduction „once per
    // device“) sees both at once
    BoardPrefs.persist = (key, value) async {
      try {
        final p = await SharedPreferences.getInstance();
        value == null ? await p.remove('$_prefix$key') : await p.setString('$_prefix$key', value);
      } catch (_) {}
    };
    BoardPrefs.load({
      for (final k in prefs.getKeys())
        if (k.startsWith(_prefix) && prefs.getString(k) != null) k.substring(_prefix.length): prefs.getString(k)!,
    });
  } catch (_) {
    _loaded = false;
  }
}
