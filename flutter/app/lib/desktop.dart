import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

/// Windows and Linux (docs/release/desktop.md). Tests (`FLUTTER_TEST`) count as a phone.
bool get isDesktop =>
    !kIsWeb && !Platform.environment.containsKey('FLUTTER_TEST') && (Platform.isWindows || Platform.isLinux);

/// Desktop stand-in for „Teilen → Stachel“: files dragged onto the window (images, PDFs, text files) go the same way as
/// a share on Android ([StachelShareTarget]: pick the board, then they land in its middle). The share flow deletes its
/// files afterwards, so they are copied into the app's temp folder first – the originals stay untouched.
class DesktopDropZone extends StatefulWidget {
  const DesktopDropZone({super.key, required this.child});

  final Widget child;

  @override
  State<DesktopDropZone> createState() => _DesktopDropZoneState();
}

class _DesktopDropZoneState extends State<DesktopDropZone> {
  bool _over = false;

  @override
  Widget build(BuildContext context) {
    if (!isDesktop) return widget.child;
    return DropTarget(
      onDragEntered: (_) => setState(() => _over = true),
      onDragExited: (_) => setState(() => _over = false),
      onDragDone: (d) {
        setState(() => _over = false);
        _receive(d.files.map((f) => f.path).toList());
      },
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(
          children: [
            widget.child,
            if (_over)
              const Positioned.fill(
                child: IgnorePointer(
                  child: ColoredBox(
                    color: Color(0xcc0a0a0a),
                    child: Center(
                      child: Text(
                        'Loslassen – kommt aufs Board',
                        style: TextStyle(
                          color: Color(0xffc9e14a),
                          fontFamily: 'BarlowCondensed',
                          fontWeight: FontWeight.w700,
                          fontSize: 32,
                          decoration: TextDecoration.none,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

Future<void> _receive(List<String> paths) async {
  final files = <Map<String, Object?>>[];
  final texts = <String>[];
  final dir = Directory('${Directory.systemTemp.path}${Platform.pathSeparator}stachel_drop');
  await dir.create(recursive: true);
  final stamp = DateTime.now().microsecondsSinceEpoch;
  for (final (i, path) in paths.indexed) {
    final src = File(path);
    final name = path.split(RegExp(r'[\\/]')).last;
    final mime = droppedMime(name);
    try {
      if (!await src.exists()) continue; // a folder or a vanished file
      final size = await src.length();
      if (size > stachelShareMaxBytes) {
        files.add({'name': name, 'mime': mime, 'size': size, 'error': 'too_large'});
        continue;
      }
      if (mime.startsWith('text/')) {
        texts.add(await src.readAsString());
        continue;
      }
      final copy = await src.copy('${dir.path}${Platform.pathSeparator}${stamp}_${i}_$name');
      files.add({'path': copy.path, 'name': name, 'mime': mime, 'size': size});
    } catch (_) {
      files.add({'name': name, 'mime': mime, 'error': 'unreadable'});
    }
  }
  // one share for everything (the root screen starts one flow per share)
  StachelShareTarget.instance.receive({'text': texts.join('\n\n'), 'files': files});
}

/// MIME type by file name (desktop drops carry none).
@visibleForTesting
String droppedMime(String name) {
  final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
  return switch (ext) {
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    'pdf' => 'application/pdf',
    'txt' || 'md' => 'text/plain',
    'csv' => 'text/csv',
    _ => 'application/octet-stream',
  };
}
