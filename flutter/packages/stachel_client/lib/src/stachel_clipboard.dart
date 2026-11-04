import 'dart:io';

import 'package:flutter/services.dart';
import 'package:pasteboard/pasteboard.dart';
import 'package:stachel_board/stachel_board.dart';

/// `text/html` for copying board objects (audit D21): Flutter's clipboard knows only plain text, so on Android the
/// app writes text + HTML through its own channel (`MainActivity.kt`, `ClipData.newHtmlText`) and reads HTML with
/// `pasteboard` (`ClipData.Item.htmlText`). Then objects copied in the browser paste in the app and the other way
/// round, like between two browsers. iOS: not yet (`pasteboard` has no HTML there, the channel is Android only) – the
/// plain text still goes along.
abstract final class StachelClipboard {
  static const channel = MethodChannel('stachel/clipboard');

  /// Plugs the Android implementation into [BoardClipboard] (once; elsewhere nothing changes).
  static void install({bool? android}) {
    if (!(android ?? Platform.isAndroid)) return;
    BoardClipboard.writeHtml = (text, html) async =>
        await channel.invokeMethod<bool>('setHtml', {'text': text, 'html': html}) ?? false;
    BoardClipboard.readHtml = () => Pasteboard.html;
  }
}
