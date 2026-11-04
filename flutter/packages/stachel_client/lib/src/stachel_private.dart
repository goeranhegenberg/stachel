import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';

// The app's side of the package's private mode (docs/features/private.md §4/§5): starting, revealing and cancelling
// go over REST with the app session (`Authorization: Bearer sts_…`, `X-Stachel: 1`).

/// The board host of the screen steers the private mode over [privateApi].
mixin StachelPrivateHost on BoardHost implements BoardPrivateHost {
  HttpStachelBoardsApi get privateApi;

  @override
  Future<Map<String, Object?>> privateMode(Map<String, Object?> body) => privateApi.privateMode(boardId, body);

  @override
  String privateErrorText(Object error) => stachelPrivateErrorText(error);
}

/// German text of a failed private-mode request: the server's message, else the app's text for its code.
String stachelPrivateErrorText(Object error) {
  if (error is! StachelException) return 'Das hat nicht geklappt. Bitte versuch es noch einmal.';
  final fallback = switch (error.code) {
    'already_running' => 'Der private Modus läuft schon.',
    'not_running' => 'Der private Modus läuft nicht mehr.',
    'not_facilitator' => 'Aufdecken kann nur, wer den privaten Modus gestartet hat, oder die Besitzer:in des Boards.',
    'own_reveal_off' => 'Eigene Notizen vorher aufdecken ist in diesem privaten Modus aus.',
    _ => null,
  };
  // the server's own text where it sent one (stachelErrorText keeps it for unknown codes)
  if (fallback != null && error.message == stachelErrorText(error.code, null)) return fallback;
  return error.message;
}
