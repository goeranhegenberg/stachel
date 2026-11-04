import 'package:flutter/material.dart';

import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import 'laser_layer.dart';

/// P5: Laserpointer (Presence `collab.laser`, `setExtra(immediate: true)`).
///
/// Owner: P5 (parity audit §4, rows C18, L17). Only this directory (`features/laser/`, tests `test/features/laser/`)
/// belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Werkzeug `collab.laser` · 112 (`ToolPlace.more`, `behavior.draws`, bleibend)
/// - Overlay `collab.laser` · 20 (`presenting: true`)
void registerLaser(BoardRegistry r) {
  r.defineTool(
    ToolDef(
      id: 'collab.laser',
      label: 'Laserpointer',
      shortLabel: 'LASER',
      icon: Icons.flare,
      order: 112,
      phone: ToolPlace.more,
      behavior: laserBehavior,
      once: false,
      keyName: 'stachelToolLaser',
      moreKey: 'stachelMoreLaser',
      subtitle: 'Finger halten und ziehen – alle sehen die Spur',
      hint: (_) => 'Laserpointer: Finger aufs Board halten und ziehen',
      available: (ui) => ui.controller.features.contains('extra'),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'collab.laser',
      order: 20,
      presenting: true,
      build: (context, ui) => LaserLayer(ui: ui),
    ),
  );
}
