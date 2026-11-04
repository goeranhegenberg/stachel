import 'package:flutter/widgets.dart';

import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../versions/admin_host.dart';
import 'thumbnail.dart';

/// P6: Vorschaubild (PUT) nach Änderungen.
///
/// Owner: P6 (parity audit §4, rows N09). Only this directory (`features/thumbnail/`, tests
/// `test/features/thumbnail/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - kein UI-Eintrag nötig (Dienst im Paket): unsichtbares Overlay `tools.thumbnail` (web Slot `tools.thumbnail`)
void registerThumbnail(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'tools.thumbnail',
      order: 0,
      // keeps working while presenting (changes by others still count)
      presenting: true,
      build: (context, ui) =>
          adminHost(ui) == null ? const SizedBox.shrink() : IgnorePointer(child: ThumbnailUploader(ui: ui)),
    ),
  );
}
