import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'stachel_boards_api.dart';
import 'stachel_photos.dart';
import 'stachel_board_screen.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

/// Camera or gallery? (null = cancelled; without a camera – desktop – straight to the file dialog)
Future<StachelPhotoSource?> askPhotoSource(BuildContext context) async =>
    stachelHasCamera ? _askPhotoSource(context) : StachelPhotoSource.gallery;

Future<StachelPhotoSource?> _askPhotoSource(BuildContext context) => showModalBottomSheet<StachelPhotoSource>(
  context: context,
  showDragHandle: true,
  builder: (ctx) => SafeArea(
    child: Wrap(
      children: [
        ListTile(
          key: const Key('stachelPhotoCamera'),
          leading: const Icon(Icons.photo_camera_outlined),
          title: const Text('Foto aufnehmen'),
          onTap: () => Navigator.of(ctx).pop(StachelPhotoSource.camera),
        ),
        ListTile(
          key: const Key('stachelPhotoGallery'),
          leading: const Icon(Icons.photo_library_outlined),
          title: const Text('Bild aus der Galerie'),
          onTap: () => Navigator.of(ctx).pop(StachelPhotoSource.gallery),
        ),
      ],
    ),
  ),
);

/// Team → NEU ANLEGEN → „Foto aufs Board“ (E3): photo first (camera or gallery), then the board; the board opens
/// natively and the photo lands at a free spot in the middle of it (uploaded like from the board, offline-safe).
Future<void> startStachelPhoto(
  BuildContext context,
  StachelClient client, {
  StachelPhotoPicker? picker,
  StachelBoardsApi? boardsApi,
  Widget Function(String boardId, String title, Uint8List photo)? boardScreen,
}) async {
  final source = await askPhotoSource(context);
  if (source == null || !context.mounted) return;
  final Uint8List? bytes;
  try {
    bytes = await (picker ?? ImagePickerPhotos()).pick(source);
  } catch (_) {
    if (context.mounted) {
      skShowMsg(
        context,
        source == StachelPhotoSource.camera
            ? 'Die Kamera ließ sich nicht öffnen.'
            : 'Die Galerie ließ sich nicht öffnen.',
      );
    }
    return;
  }
  if (bytes == null || !context.mounted) return;
  final board = await pickStachelBoard(context, boardsApi ?? HttpStachelBoardsApi(client));
  if (board == null || !context.mounted) return;
  await Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          boardScreen?.call(board.id, board.title, bytes!) ??
          StachelBoardScreen(client: client, boardId: board.id, title: board.title, initialPhoto: bytes),
    ),
  );
}

/// Board picker (favorites and recently opened first, search); offline the saved list.
Future<StachelBoardInfo?> pickStachelBoard(BuildContext context, StachelBoardsApi boards) =>
    showModalBottomSheet<StachelBoardInfo>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _BoardPicker(boards: boards),
    );

class _BoardPicker extends StatefulWidget {
  const _BoardPicker({required this.boards});
  final StachelBoardsApi boards;

  @override
  State<_BoardPicker> createState() => _BoardPickerState();
}

class _BoardPickerState extends State<_BoardPicker> {
  List<StachelBoardInfo>? _list;
  String? _error;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await widget.boards.boards();
      if (mounted) setState(() => _list = list);
    } on StachelException catch (e) {
      final cached = await widget.boards.cachedBoards();
      if (!mounted) return;
      setState(() {
        _list = cached?.boards;
        _error = cached == null ? e.message : null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    final q = _q.trim().toLowerCase();
    final boards =
        [
          for (final b in list ?? const <StachelBoardInfo>[])
            if (!b.template && (q.isEmpty || b.title.toLowerCase().contains(q))) b,
        ]..sort((a, b) {
          if (a.favorite != b.favorite) return a.favorite ? -1 : 1;
          final oa = a.openedAt, ob = b.openedAt;
          if (oa != null || ob != null) {
            if (oa == null) return 1;
            if (ob == null) return -1;
            return ob.compareTo(oa);
          }
          return 0;
        });
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          key: const Key('stachelBoardPicker'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                'AUF WELCHES BOARD?',
                style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w700, fontSize: 16),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                key: const Key('stachelBoardPickerSearch'),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Board suchen',
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _q = v),
              ),
            ),
            if (list == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Padding(padding: const EdgeInsets.all(24), child: Text(_error!))
            else
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final b in boards)
                      ListTile(
                        key: Key('stachelPickBoard-${b.id}'),
                        leading: Icon(
                          b.favorite ? Icons.star : Icons.dashboard_outlined,
                          color: b.favorite ? Sk.pink : null,
                        ),
                        title: Text(b.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onTap: () => Navigator.of(context).pop(b),
                      ),
                    if (boards.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Kein Board gefunden.')),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
