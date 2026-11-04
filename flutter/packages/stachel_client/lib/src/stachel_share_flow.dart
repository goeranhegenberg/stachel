import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';
import 'stachel_share_target.dart';
import 'stachel_board_screen.dart';
import 'stachel_photo_flow.dart';
import 'stachel_style.dart';

/// „Teilen → Stachel“ (K13): another app shared images, text/links or files with the app → pick the board → it opens
/// natively and the shared things land in the middle of the view like „Foto aufs Board“ (images uploaded offline-safe,
/// text as a sticky note like the web's `pasteText`, PDFs and other files through [stachelSharedFileHandlers]).
Future<void> startStachelShare(
  BuildContext context,
  StachelClient client,
  StachelShared share, {
  StachelBoardsApi? boardsApi,
  Widget Function(String boardId, String title, StachelShared share)? boardScreen,
}) async {
  final usable = share.noteText.isNotEmpty || share.files.any((f) => f.error == null);
  if (!usable) {
    skShowMsg(context, _skippedText(share.files) ?? 'Damit kann Stachel nichts anfangen.');
    await StachelShareTarget.discard(share);
    return;
  }
  final board = await pickStachelBoard(context, boardsApi ?? HttpStachelBoardsApi(client));
  if (board == null || !context.mounted) {
    await StachelShareTarget.discard(share);
    return;
  }
  await Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          boardScreen?.call(board.id, board.title, share) ??
          StachelBoardScreen(client: client, boardId: board.id, title: board.title, initialShare: share),
    ),
  );
}

/// Puts [share] onto the open board (the board screen calls this once the board is live): images through [addPhoto]
/// side by side from [center], other files through their handler, the text as one sticky note at a free spot (several
/// lines or table data first ask „Einfügen als …“ like pasting). The cached copies are deleted afterwards; what could
/// not go on the board is named in one [message].
Future<void> placeStachelShare(
  BuildContext context,
  BoardUi ui,
  StachelShared share, {
  required Offset center,
  required Future<void> Function(Uint8List bytes, {Offset? center}) addPhoto,
  required void Function(String text) message,
}) async {
  try {
    if (!ui.editor.editable) {
      message('Du darfst dieses Board nur ansehen – nichts eingefügt.');
      return;
    }
    final skipped = <String>[?_skippedText(share.files)];
    var at = center;
    for (final f in share.files) {
      if (f.error != null) continue;
      if (f.isImage) {
        final Uint8List bytes;
        try {
          bytes = await File(f.path).readAsBytes();
        } catch (_) {
          skipped.add('„${f.name}“ ließ sich nicht lesen');
          continue;
        }
        await addPhoto(bytes, center: at);
        at += const Offset(560, 0); // next to it (images are at most 520 wide)
        continue;
      }
      final handler = stachelSharedFileHandlerFor(f);
      if (handler == null || !context.mounted) {
        skipped.add(
          f.isPdf
              ? 'PDFs kann diese App-Version noch nicht aufs Board legen'
              : '„${f.name}“ kann Stachel nicht aufs Board legen',
        );
        continue;
      }
      try {
        await handler(context, ui, f);
      } catch (_) {
        skipped.add('„${f.name}“ ließ sich nicht einfügen');
      }
      at += const Offset(700, 0);
    }
    final text = share.noteText;
    if (text.isNotEmpty) {
      final spot = freeSpot(ui.editor.scene, at, const Size(200, 200)) + const Offset(100, 100);
      final ask = pasteTextAs;
      final asked = ask != null && context.mounted && await ask(context, ui, text, spot);
      if (!asked) pasteText(ui, text, spot);
    }
    if (skipped.isNotEmpty) message('${skipped.join('. ')}.');
  } finally {
    await StachelShareTarget.discard(share);
  }
}

/// Files the platform side could not take (too large, unreadable); null = none.
String? _skippedText(List<StachelSharedFile> files) {
  final bad = files.where((f) => f.error != null).toList();
  if (bad.isEmpty) return null;
  final names = bad.map((f) => '„${f.name}“').join(', ');
  final tooLarge = bad.every((f) => f.error == 'too_large');
  return tooLarge
      ? '$names ${bad.length == 1 ? 'ist' : 'sind'} größer als 15 MB und ${bad.length == 1 ? 'bleibt' : 'bleiben'} weg'
      : '$names ließ sich nicht lesen';
}
