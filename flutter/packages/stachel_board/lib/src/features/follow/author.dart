import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/collab.dart';
import '../../render/board_scene.dart' show isVisibleObject;
import '../stack/stack_model.dart' show stackOf;
import '../view/board_background.dart' show boardSettingsOf;
import 'collab_common.dart';

/// Name of [key] like the web's `usePeople`: the server's list ([known], host), the people present and the comment
/// authors; me = [meAs]; unknown = null (nothing shown).
String? _nameOf(BoardUi ui, String key, List<Person> known, String meAs) {
  if (key == CollabSession.of(ui).me) return meAs;
  for (final p in ui.controller.peers) {
    if (p.key == key && p.name.isNotEmpty) return p.name;
  }
  for (final p in known) {
    if (p.key == key && p.name.isNotEmpty) return p.name;
  }
  for (final t in readThreads(ui.controller.state.ext[commentsExt])) {
    for (final m in t.messages) {
      if (m.by == key && m.name.isNotEmpty) return m.name;
    }
  }
  return null;
}

/// Asks the host once for everyone who can open the board (web `/api/users?board=`).
mixin _KnownPeople<T extends StatefulWidget> on State<T> {
  BoardUi get ui;
  List<Person> known = const [];
  bool _asked = false;

  void ask() {
    if (_asked) return;
    _asked = true;
    unawaited(
      ui.host.people().then((list) {
        if (mounted && list.isNotEmpty) setState(() => known = list);
      }, onError: (_) => _asked = false),
    );
  }
}

/// „von Mara“ at the selected sticky note (web `AuthorHover`, audit L20): the web shows it when the mouse rests on a
/// note; a phone has no hover, so it shows for the one selected note (same place: inside its bottom right corner, same
/// text, only from 60 px width on, not while writing in it). Not while „Autor:in an Haftnotizen zeigen“ is on – then
/// every note carries the name already ([AuthorLabels]).
class AuthorLabel extends StatefulWidget {
  const AuthorLabel({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<AuthorLabel> createState() => _AuthorLabelState();
}

class _AuthorLabelState extends State<AuthorLabel> with _KnownPeople {
  @override
  BoardUi get ui => widget.ui;

  /// Name of [key]; me = „dir“.
  String? nameOf(String key) => _nameOf(ui, key, known, 'dir');

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.editor, ui.controller, view.camera]),
      builder: (context, _) {
        final o = ui.editor.single;
        final by = o == null ? null : o.raw['createdBy'];
        if (o == null ||
            o.type != 'sticky' ||
            by is! String ||
            by.isEmpty ||
            ui.editor.editingId == o.id ||
            boardSettingsOf(ui).authors) {
          return const SizedBox.shrink();
        }
        final cam = view.camera.value;
        if (o.w * cam.z < authorMinPx) return const SizedBox.shrink();
        ask();
        final name = nameOf(by);
        if (name == null) return const SizedBox.shrink();
        final s = cam.toScreen(Offset(o.x + o.w, o.y + o.h));
        return Stack(
          children: [
            Positioned(
              right: view.viewSize.width - s.dx + 6,
              bottom: view.viewSize.height - s.dy + 6,
              child: IgnorePointer(child: _Tag(text: 'von $name')),
            ),
          ],
        );
      },
    );
  }
}

/// From this width of a note on screen (px) its author is shown (web `AUTHOR_MIN_PX`).
const authorMinPx = 60.0;

/// One name at a note (web `authorLabels`): left/bottom = the note's bottom left corner on screen, [maxW] its width.
typedef NoteAuthor = ({String id, double x, double y, double maxW, String name});

/// Names for every visible sticky note in view (web `authorLabels`): only with a known person ([nameOf] null = none),
/// from [authorMinPx] on, not at the note being written in ([editing]).
List<NoteAuthor> noteAuthors(BoardUi ui, Size size, String? Function(String key) nameOf, String? editing) {
  final view = ui.view;
  if (view == null) return const [];
  final cam = view.camera.value;
  final world = cam.viewRect(size);
  final out = <NoteAuthor>[];
  for (final id in ui.editor.scene.grid.query(world)) {
    final o = ui.controller.state[id];
    if (o == null || o.type != 'sticky' || o.id == editing || !isVisibleObject(o)) continue;
    // note stack (Q2): only the top note carries a name (like the web)
    if (o.raw['stacked'] == true && o.groupId != null) {
      final s = stackOf(o, ui.controller.state);
      if (s.isNotEmpty && s.last.id != o.id) continue;
    }
    final by = o.raw['createdBy'];
    if (by is! String || by.isEmpty) continue;
    final w = o.w * cam.z;
    if (w < authorMinPx) continue;
    final a = cam.toScreen(Offset(o.x, o.y));
    final h = o.h * cam.z;
    if (a.dx > size.width || a.dy > size.height || a.dx + w < 0 || a.dy + h < 0) continue;
    final name = nameOf(by);
    if (name == null) continue;
    out.add((id: o.id, x: a.dx.roundToDouble(), y: (a.dy + h).roundToDouble(), maxW: w.floorToDouble(), name: name));
  }
  // paint order of the board: later (higher z) notes last
  out.sort((a, b) => (ui.controller.state[a.id]?.z ?? '').compareTo(ui.controller.state[b.id]?.z ?? ''));
  return out;
}

/// Board setting „Autor:in an Haftnotizen zeigen“ (web `AuthorLabels`, for everyone): every sticky note in view
/// carries its creator's real name small at its bottom left (my own notes too). Not in presentation mode (overlay
/// without `presenting`), not at the note being written in, only from 60 px note width on.
class AuthorLabels extends StatefulWidget {
  const AuthorLabels({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<AuthorLabels> createState() => _AuthorLabelsState();
}

class _AuthorLabelsState extends State<AuthorLabels> with _KnownPeople {
  @override
  BoardUi get ui => widget.ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    return ListenableBuilder(
      listenable: Listenable.merge([ui.editor, ui.controller, view.camera]),
      builder: (context, _) {
        if (!boardSettingsOf(ui).authors) return const SizedBox.shrink();
        ask();
        final me = CollabSession.of(ui).myName;
        final labels = noteAuthors(
          ui,
          view.viewSize,
          (key) => _nameOf(ui, key, known, me.isEmpty ? 'ich' : me),
          ui.editor.editingId,
        );
        if (labels.isEmpty) return const SizedBox.shrink();
        return IgnorePointer(
          child: Stack(
            key: const Key('collabNoteAuthors'),
            clipBehavior: Clip.hardEdge,
            children: [
              for (final l in labels)
                Positioned(
                  left: l.x,
                  top: l.y - 19,
                  width: l.maxW,
                  child: Padding(
                    key: Key('collabNoteAuthor-${l.id}'),
                    padding: const EdgeInsets.fromLTRB(8, 0, 8, 5),
                    child: Text(
                      l.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0x8C0A0A0A),
                        fontSize: 11,
                        height: 14 / 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    key: const Key('collabNoteAuthor'),
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: const Color(0xC70A0A0A), borderRadius: BorderRadius.circular(6)),
    child: Text(
      text,
      style: const TextStyle(color: Colors.white, fontSize: 11.5, height: 16 / 11.5, fontWeight: FontWeight.w600),
    ),
  );
}
