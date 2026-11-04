import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:stachel_board/stachel_board.dart' show BoardDesktop;
import 'package:stachel_client/stachel_client.dart';

import 'app_session.dart';
import 'config.dart';
import 'desktop.dart';
import 'links.dart';
import 'root.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Sk.style = StachelTheme.style;
  Sk.darkStyle = StachelTheme.darkStyle;
  // Windows/Linux: mouse and keyboard like the web (introduction, menus as popups; docs/features/desktop.md)
  BoardDesktop.enabled = isDesktop;
  registerAppLicenses();
  final links = StachelAppLinks(StachelConfig.accountsBase);
  // App Links on stachel.intsode.com (/b/, /verify/, /reset/); the stream also brings the link that started the app
  // (desktop: from the command line, also stachel://…, see links.dart)
  unawaited(
    Future(() async {
      try {
        AppLinks().uriLinkStream.listen(links.handle, onError: (_) {});
      } catch (_) {}
    }),
  );
  // „Teilen → Stachel“: images, text and PDFs shared from other apps (Android); on Windows/Linux dragged onto the window
  unawaited(StachelShareTarget.instance.start());
  runApp(DesktopDropZone(child: StachelApp(session: AppSession(), links: links)));
}

/// Licenses Flutter's NOTICES miss (legal CR-4, docs/legal/lizenzen.md §5.2): Barlow / Barlow Condensed (SIL OFL 1.1,
/// app asset) plus the packages' fonts, lucide and PDFium ([registerStachelLicenses]). Idempotent.
void registerAppLicenses() {
  registerStachelLicenses();
  if (_appLicenses) return;
  _appLicenses = true;
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(['Barlow', 'Barlow Condensed'], await rootBundle.loadString(barlowLicenseAsset));
  });
}

bool _appLicenses = false;

/// OFL text of Barlow and Barlow Condensed (one project, one license).
const barlowLicenseAsset = 'assets/fonts/OFL-Barlow.txt';
