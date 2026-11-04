import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../render/board_scene.dart';
import '../../model/board_source.dart';
import '../../model/collab.dart';
import '../board_editor.dart';

/// Hint texts of the web (touch wording), one place for all of them. To be replaced by the generated web constants
/// (`lib/src/web/web_constants.g.dart` from F1 `tools/native-web-constants.mts`, audit §3.3) once they exist.
abstract final class BoardHintTexts {
  /// B15, web `Editor.tsx` empty board (touch: „Doppeltippen“).
  static const emptyBoard = 'Leeres Board. Doppeltippen für eine Haftnotiz – oder ein Werkzeug wählen.';

  /// B06, web `ConnectionNotice` after a lost connection came back.
  static const reconnected = 'Wieder verbunden';

  /// F21, web `Editor.tsx`: the object being written in was deleted by someone else.
  static String deletedBy(String? name) =>
      name == null || name.isEmpty ? 'Von jemand anderem gelöscht' : 'Von $name gelöscht';

  /// O04: a web action waits for the server.
  static const running = 'wird ausgeführt …';
  static const queued = 'wird ausgeführt, sobald online';
}

/// The board's hints like the web shows them (audit B06, B15, F21, O04):
/// - connection lost: [connectionLost] only after [lostDelay] (short gaps stay silent), back: [reconnected] for
///   [backTime] – only if the lost hint was visible (web `ConnectionNotice`),
/// - empty board: [emptyBoard] (ready, nothing on it, nothing being uploaded),
/// - the object being written in deleted by someone else: [messages] „Von Mara gelöscht“ (who selected it last, within
///   15 s),
/// - web actions: their `toast` from the `ack` on [messages]; [running] lists actions waiting for the server.
class BoardHints extends ChangeNotifier {
  BoardHints({
    required this.controller,
    required this.editor,
    this.lostDelay = const Duration(milliseconds: 1500),
    this.backTime = const Duration(milliseconds: 3200),
  }) {
    controller.addListener(_controllerChanged);
    controller.source.connection.addListener(_connectionChanged);
    editor.addListener(_editorChanged);
    _acts = controller.actResults.listen(_actDone);
    _lastEditing = editor.editingId;
    _connectionChanged();
  }

  final BoardController controller;
  final BoardEditor editor;
  final Duration lostDelay;
  final Duration backTime;

  final _messages = StreamController<String>.broadcast();
  StreamSubscription<ActDone>? _acts;

  /// Short hints for a snackbar (the app shows them).
  Stream<String> get messages => _messages.stream;

  /// Shows [text] as a short hint (packages: „Ausgeblendet. Zurückholen: …“).
  void show(String text) {
    if (!_messages.isClosed && text.isNotEmpty) _messages.add(text);
  }

  // ---- connection (B06) -------------------------------------------------------------------------------------------

  bool _everLive = false;
  bool _lost = false;
  bool _lostShown = false;
  bool _back = false;
  Timer? _lostTimer;
  Timer? _backTimer;

  /// The connection broke after the board was live and stayed away longer than [lostDelay].
  bool get connectionLost => _lostShown;

  /// The board was live at least once in this session (before that a missing connection shows right away).
  bool get everLive => _everLive;

  /// The connection is back after a visible [connectionLost] (shown for [backTime]).
  bool get reconnected => _back;

  void _connectionChanged() {
    final c = controller.source.connection.value;
    if (c == BoardConnection.live) {
      _lostTimer?.cancel();
      final wasShown = _lostShown;
      _lost = false;
      _lostShown = false;
      if (_everLive && wasShown) {
        _back = true;
        _backTimer?.cancel();
        _backTimer = Timer(backTime, () {
          _back = false;
          notifyListeners();
        });
      }
      _everLive = true;
      notifyListeners();
    } else if (c == BoardConnection.offline || c == BoardConnection.connecting) {
      if (!_everLive || _lost) return;
      _lost = true;
      _back = false;
      _backTimer?.cancel();
      _lostTimer?.cancel();
      _lostTimer = Timer(lostDelay, () {
        if (!_lost) return;
        _lostShown = true;
        notifyListeners();
      });
      notifyListeners();
    } else {
      _lostTimer?.cancel();
      _lost = _lostShown = _back = false;
      notifyListeners();
    }
  }

  // ---- empty board (B15) ------------------------------------------------------------------------------------------

  /// Ready and nothing on the board: „Leeres Board. Doppeltippen …“ – not while someone (also someone else, web
  /// `collab.uploads`) is uploading something onto it.
  bool get emptyBoard =>
      controller.loaded &&
      !controller.fromCache &&
      controller.uploads.value.isEmpty &&
      !controller.peers.any((p) => p.extra[uploadsAwareness] is List && (p.extra[uploadsAwareness] as List).isNotEmpty) &&
      !controller.state.objects.values.any(isVisibleObject);

  // ---- web actions (O04) ------------------------------------------------------------------------------------------

  /// Own web actions waiting for the server (marker „wird ausgeführt …“).
  List<RunningAct> get running => controller.runningActs;

  void _actDone(ActDone d) {
    final t = d.result?.toast;
    if (t != null) show(t);
  }

  // ---- deleted while writing (F21) --------------------------------------------------------------------------------

  /// Who selected which object last (name, when): the name in „Von Mara gelöscht“.
  final _picker = <String, (String, DateTime)>{};
  String? _lastEditing;

  void _controllerChanged() {
    if (!identical(controller.peers, _peersSeenList)) {
      _peersSeenList = controller.peers;
      final now = DateTime.now();
      _picker.removeWhere((_, v) => now.difference(v.$2) > const Duration(seconds: 15));
      for (final p in controller.peers) {
        for (final id in p.selection) {
          _picker[id] = (p.name, now);
        }
      }
    }
  }

  Object? _peersSeenList;

  void _editorChanged() {
    final was = _lastEditing;
    _lastEditing = editor.editingId;
    if (was == null || editor.editingId == was) return;
    // closed because the object is gone on the server and not by an own pending change (own delete, empty node)
    if (controller.confirmed[was] == null && controller.state[was] == null && !controller.hasPending(was)) {
      show(BoardHintTexts.deletedBy(_picker[was]?.$1));
    }
  }

  @override
  void dispose() {
    controller.removeListener(_controllerChanged);
    controller.source.connection.removeListener(_connectionChanged);
    editor.removeListener(_editorChanged);
    _acts?.cancel();
    _lostTimer?.cancel();
    _backTimer?.cancel();
    _messages.close();
    super.dispose();
  }
}
