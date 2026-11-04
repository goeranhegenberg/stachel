import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

// Licenses of what this package ships but Flutter's generated NOTICES do not know (docs/legal/lizenzen.md §5.2): the
// fonts Source Serif 4 and JetBrains Mono (SIL OFL 1.1) and the lucide icon paths (ISC, partly Feather MIT). They appear
// in `showLicensePage` of every app using the package (the Stachel app and host apps that embed it).

bool _registered = false;

/// Text of a license file shipped as an asset of [package]: `packages/<package>/<path>` in an app, plain `<path>` in
/// the package's own tests.
Future<String> loadPackageLicense(String package, String path, {AssetBundle? bundle}) async {
  final b = bundle ?? rootBundle;
  try {
    return await b.loadString('packages/$package/$path', cache: false);
  } catch (_) {
    return b.loadString(path, cache: false);
  }
}

/// Adds the package's licenses to [LicenseRegistry] once (later calls do nothing). Texts load only when the license
/// page asks for them.
void registerStachelBoardLicenses() {
  if (_registered) return;
  _registered = true;
  const files = {
    'Source Serif 4': 'assets/fonts/OFL-SourceSerif4.txt',
    'JetBrains Mono': 'assets/fonts/OFL-JetBrainsMono.txt',
    'lucide': 'assets/licenses/lucide.txt',
  };
  LicenseRegistry.addLicense(() async* {
    for (final e in files.entries) {
      yield LicenseEntryWithLineBreaks([e.key], await loadPackageLicense('stachel_board', e.value));
    }
  });
}
