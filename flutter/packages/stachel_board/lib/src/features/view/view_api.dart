// What the app needs of P4 (view, frames, search): bars hidden while presenting / UI hidden, the frame list sheet,
// device settings to store, the presentation and search entry points.
export '../frames/frames_list.dart' show FramesListSheet, framesListSheet;
export '../frames/present.dart' show Presentation, presentField;
export '../search/search_bar.dart' show openSearch, closeSearch, searchIncludesHidden;
export 'board_background.dart' show BoardSettings, boardSettingsOf, boardSettingsSheet, snapPrefKey, snapToGridPref;
export 'board_prefs.dart';
export 'view_camera.dart' show fitTo, zoomToSelection, zoomStep, zoomTo;
export 'view_state.dart';
