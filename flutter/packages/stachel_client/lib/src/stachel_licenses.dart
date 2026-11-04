import 'package:flutter/foundation.dart';
import 'package:stachel_board/stachel_board.dart';

// PDFium (pdfrx/pdfium_dart load it as a native library in a build hook, so Flutter's NOTICES miss it): the LICENSE of
// bblanchon/pdfium-binaries (release chromium/8125) and the licenses of the parts it contains, as assets of this
// package (docs/legal/lizenzen.md §5.2). Shown in `showLicensePage` of the Stachel app and of host apps.

bool _registered = false;

/// File under `assets/licenses/pdfium/` → name of the part on the license page.
const stachelPdfiumLicenseFiles = {
  'LICENSE.txt': 'pdfium-binaries (Benoit Blanchon)',
  'pdfium.txt': 'PDFium',
  'abseil.txt': 'Abseil',
  'agg23.txt': 'Anti-Grain Geometry 2.3',
  'catapult.txt': 'Catapult',
  'cpu_features.txt': 'cpu_features',
  'dragonbox-Apache2-LLVM.txt': 'Dragonbox (Apache-2.0 with LLVM exception)',
  'dragonbox-Boost.txt': 'Dragonbox (Boost)',
  'fast_float.txt': 'fast_float',
  'freetype.txt': 'FreeType',
  'harfbuzz.txt': 'HarfBuzz',
  'highway.txt': 'Highway',
  'icu.txt': 'ICU',
  'lcms.txt': 'Little CMS',
  'libjpeg_turbo.md': 'libjpeg-turbo',
  'libjpeg_turbo.ijg': 'libjpeg-turbo (IJG)',
  'libopenjpeg.txt': 'OpenJPEG',
  'libpng.txt': 'libpng',
  'libunwind.txt': 'libunwind',
  'llvm-libc.txt': 'LLVM libc',
  'simdutf.txt': 'simdutf',
  'zlib.txt': 'zlib',
};

/// Registers the licenses of both Stachel packages (fonts, lucide, PDFium) once; later calls do nothing.
/// [StachelHomeScreen] calls it, apps may call it earlier (e.g. in `main`).
void registerStachelLicenses() {
  registerStachelBoardLicenses();
  if (_registered) return;
  _registered = true;
  LicenseRegistry.addLicense(() async* {
    for (final e in stachelPdfiumLicenseFiles.entries) {
      final text = await loadPackageLicense('stachel_client', 'assets/licenses/pdfium/${e.key}');
      yield LicenseEntryWithLineBreaks(['PDFium'], '${e.value}\n\n$text');
    }
  });
}
