import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_documents.dart' show handleSharedPdf;

// Share target „Teilen → Stachel“ (audit K13, concept E4d): images, text/links and files from other apps land on a
// board. Android: intent filters SEND/SEND_MULTIPLE in the manifest, `MainActivity.kt` copies the shared streams into
// the app's cache (`<cache>/shared/`, content URIs are only readable for a short time) and hands them over on the
// channel `stachel/share` (`initial` = what started the app, `shared` = a share while it runs). iOS would need a
// Share Extension (own target, App Group, provisioning profile) – not buildable without a Mac, see CLAUDE.md.

/// One shared file, copied into the app's cache by the platform side.
class StachelSharedFile {
  const StachelSharedFile({required this.path, required this.name, required this.mime, this.size = 0, this.error});

  /// Copy in the app's cache ('' when [error] is set).
  final String path;
  final String name;
  final String mime;
  final int size;

  /// `too_large` (over [stachelShareMaxBytes]) or `unreadable`; null = fine.
  final String? error;

  bool get isImage => mime.startsWith('image/');
  bool get isPdf =>
      mime == 'application/pdf' || (mime == 'application/octet-stream' && name.toLowerCase().endsWith('.pdf'));

  static StachelSharedFile? fromJson(Object? j) {
    if (j is! Map) return null;
    String str(String k) => j[k] is String ? j[k] as String : '';
    final path = str('path');
    final error = j['error'] is String ? j['error'] as String : null;
    if (path.isEmpty && error == null) return null;
    return StachelSharedFile(
      path: path,
      name: str('name').isEmpty ? 'Datei' : str('name'),
      mime: str('mime').toLowerCase(),
      size: j['size'] is int ? j['size'] as int : 0,
      error: error,
    );
  }
}

/// What another app shared with this app.
class StachelShared {
  const StachelShared({this.text = '', this.subject = '', this.files = const []});

  final String text;
  final String subject;
  final List<StachelSharedFile> files;

  bool get isEmpty => text.trim().isEmpty && files.isEmpty;

  /// The text for a sticky note: subject first unless the text already starts with it (browsers share title + URL).
  String get noteText {
    final t = text.trim(), s = subject.trim();
    if (s.isEmpty || t.contains(s)) return t;
    if (t.isEmpty) return s;
    return '$s\n$t';
  }

  /// Null for nothing usable.
  static StachelShared? fromJson(Object? j) {
    if (j is! Map) return null;
    final s = StachelShared(
      text: j['text'] is String ? j['text'] as String : '',
      subject: j['subject'] is String ? j['subject'] as String : '',
      files: [for (final f in (j['files'] is List ? j['files'] as List : const [])) ?StachelSharedFile.fromJson(f)],
    );
    return s.isEmpty ? null : s;
  }
}

/// Largest file the platform side copies (the board takes images up to 15 MB and PDFs up to 15 MB, web K01/K05).
const stachelShareMaxBytes = 15 * 1024 * 1024;

/// Puts a shared file other than an image onto the open board (P7 registers `application/pdf`). Called once the board
/// is live and editable; [file] stays readable until the returned future completes.
typedef StachelSharedFileHandler = Future<void> Function(BuildContext context, BoardUi ui, StachelSharedFile file);

/// What the app wires: shared PDFs become documents on the board (P7 `handleSharedPdf`, with the original name – the
/// cached copy is called `<time>_<n>_<name>`).
final defaultStachelSharedFileHandlers = <String, StachelSharedFileHandler>{
  'application/pdf': (context, ui, file) => handleSharedPdf(context, ui, file.path, name: file.name),
};

/// Handlers by MIME type (exact, e.g. `application/pdf`). Hook for other packages (P7: PDF documents, wired by
/// [defaultStachelSharedFileHandlers]); a file without a handler gets a hint and is dropped.
final stachelSharedFileHandlers = <String, StachelSharedFileHandler>{...defaultStachelSharedFileHandlers};

/// Handler for [file] (PDFs also when an app sends them as `application/octet-stream`).
StachelSharedFileHandler? stachelSharedFileHandlerFor(StachelSharedFile file) =>
    stachelSharedFileHandlers[file.mime] ?? (file.isPdf ? stachelSharedFileHandlers['application/pdf'] : null);

/// Incoming shares; the home screen takes them from [pending] (like `StachelLinks`).
class StachelShareTarget {
  StachelShareTarget._();
  static final instance = StachelShareTarget._();

  @visibleForTesting
  static const channel = MethodChannel('stachel/share');

  final pending = ValueNotifier<StachelShared?>(null);
  bool _started = false;

  /// Listens for shares and asks for the one that started the app (Android only; elsewhere nothing to do).
  Future<void> start({bool? android}) async {
    if (_started || !(android ?? (!kIsWeb && Platform.isAndroid))) return;
    _started = true;
    channel.setMethodCallHandler((call) async {
      if (call.method == 'shared') receive(call.arguments);
    });
    try {
      receive(await channel.invokeMethod<Object?>('initial'));
    } catch (_) {
      // no platform side (tests, older build): nothing shared
    }
  }

  /// Takes a share from the platform side (null/empty = nothing).
  void receive(Object? raw) {
    final s = StachelShared.fromJson(raw);
    if (s != null) pending.value = s;
  }

  StachelShared? take() {
    final s = pending.value;
    pending.value = null;
    return s;
  }

  /// Deletes the cached copies of [share] (after they were put on a board or the share was cancelled). Never throws.
  static Future<void> discard(StachelShared share) async {
    for (final f in share.files) {
      if (f.path.isEmpty) continue;
      try {
        await File(f.path).delete();
      } catch (_) {}
    }
  }
}
