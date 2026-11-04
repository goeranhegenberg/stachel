import 'dart:io';

import 'package:flutter/services.dart';
import 'package:stachel_board/stachel_board.dart';

/// Loads Barlow / Barlow Condensed from the Stachel app's assets (`../../app/assets/fonts`) so goldens show real text
/// instead of the test font's boxes. Returns false if the files are not there (package used elsewhere).
Future<bool> loadBoardFonts() async {
  final dir = Directory('../../app/assets/fonts');
  if (!dir.existsSync()) return false;
  Future<void> family(String name, List<String> files) async {
    final loader = FontLoader(name);
    for (final f in files) {
      final file = File('${dir.path}/$f');
      if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }

  await family('Barlow', ['Barlow-Regular.ttf', 'Barlow-Medium.ttf', 'Barlow-SemiBold.ttf', 'Barlow-Bold.ttf']);
  await family('BarlowCondensed', [
    'BarlowCondensed-Medium.ttf',
    'BarlowCondensed-SemiBold.ttf',
    'BarlowCondensed-Bold.ttf',
    'BarlowCondensed-Black.ttf',
  ]);
  // Check boxes and stamps use Material Icons (bundled in the app); in tests it comes from the Flutter SDK.
  final root = Platform.environment['FLUTTER_ROOT'];
  final icons = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  if (root != null && icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
  // `fontFamily: serif/mono`: the package's own Source Serif 4 / JetBrains Mono (P2, `assets/fonts`)
  Future<void> own(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final f in files) {
      final file = File('assets/fonts/$f');
      if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }

  await own(BoardFonts.serifFamily, [
    'SourceSerif4-Regular.ttf',
    'SourceSerif4-Italic.ttf',
    'SourceSerif4-SemiBold.ttf',
    'SourceSerif4-Bold.ttf',
    'SourceSerif4-BoldItalic.ttf',
  ]);
  await own(BoardFonts.monoFamily, ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Italic.ttf', 'JetBrainsMono-Bold.ttf']);
  return true;
}
