import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/ui/board_overlays.dart' show BoardTopSlot;
import '../commands/commands_model.dart' show replacePreview, replacePreviewText, replaceCount;
import '../richtext/whole.dart' show remeasureTexts;
import '../view/view_camera.dart';
import '../view/view_state.dart';
import 'search_model.dart';

// Search on the board (M13, web features/tools/search.tsx SearchBar): plain text, frame titles, tags, assignee, timeline
// texts; hits in reading order, „i von n“, ↑/↓ (the keyboard's search key = next), all highlighted, „Alle wählen“; the
// camera only moves when the hit is not well visible; hidden objects only while they are shown.

/// Opens the search bar (board menu, empty board menu).
void openSearch(BoardUi ui) {
  final s = BoardViewPrefs.of(ui);
  s.searchOpen.value = true;
  _focusRequests.value++;
}

void closeSearch(BoardUi ui) => BoardViewPrefs.of(ui).searchOpen.value = false;

/// Q3: opens the search bar with the row „Ersetzen durch“ (board menu „Suchen und ersetzen“, web `openReplace`).
void openReplace(BoardUi ui) {
  replaceOpen.value = true;
  openSearch(ui);
}

/// The row „Ersetzen durch“ under the search bar is open (web `replaceOpen`).
final replaceOpen = ValueNotifier<bool>(false);

final _focusRequests = ValueNotifier<int>(0);

/// Hidden objects are searched while they are shown („Ausgeblendete zeigen“, P1); null = never.
bool Function(BoardUi ui)? searchIncludesHidden;

class BoardSearchLayer extends StatefulWidget {
  const BoardSearchLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<BoardSearchLayer> createState() => _BoardSearchLayerState();
}

class _BoardSearchLayerState extends State<BoardSearchLayer> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _replace = TextEditingController();
  int _index = 0;
  String? _lastShown;

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    _focusRequests.addListener(_focusField);
    replaceOpen.addListener(_replaceToggled);
  }

  void _replaceToggled() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _focusRequests.removeListener(_focusField);
    replaceOpen.removeListener(_replaceToggled);
    _replace.dispose();
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _focusField() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _focus.requestFocus();
      _text.selection = TextSelection(baseOffset: 0, extentOffset: _text.text.length);
    });
  }

  List<SearchHit> _hits() {
    final v = ui.view;
    if (v == null) return const [];
    v.scene.bounds; // syncs the index
    return findHits(
      ui.controller.state.ordered,
      _text.text,
      (o) => boundsOf(v.scene, o),
      includeHidden: searchIncludesHidden?.call(ui) ?? false,
    );
  }

  /// Replacing needs the right to edit (the server refuses „ansehen/kommentieren“ anyway) and the server action.
  bool get _canReplace => ui.editor.editable && ui.controller.canAct('tools.replace');

  /// Replaces from the current hit on ([first]: only the first match, „Ersetzen“) or in all hits („Alle“) – one undo
  /// step on the server with the web code; the hint comes from the server like the web's.
  Future<void> _doReplace(List<SearchHit> hits, int index, {required bool first}) async {
    if (hits.isEmpty) return;
    final ordered = first ? [...hits.sublist(index), ...hits.sublist(0, index)] : hits;
    final query = _text.text;
    final done = await ui.controller.act('tools.replace', {
      'ids': [for (final h in ordered) h.object.id],
      'query': query,
      'replace': _replace.text,
      'first': first,
    }, label: 'Ersetzen');
    final data = done.result?.data;
    final changed = data is Map && data['changed'] is List
        ? [for (final id in data['changed'] as List) '$id']
        : const <String>[];
    if (changed.isNotEmpty) remeasureTexts(ui, changed);
    if (!mounted || !first || changed.isEmpty) return;
    // „Ersetzen“: on to the next hit when the current one has no match left (web)
    final o = ui.controller.state[changed.first];
    if (o != null && replaceCount(o, query) == 0 && hits.length > 1) {
      setState(() => _index = index % (hits.length - 1));
    }
  }

  void _close() {
    closeSearch(ui);
    _focus.unfocus();
    _lastShown = null;
  }

  /// Camera to the hit: only when it is not well visible; too small → zoom in (web `reveal`).
  void _reveal(Rect r) {
    final v = ui.view;
    if (v == null || v.viewSize == Size.zero) return;
    final cam = v.camera.value, size = v.viewSize;
    final s = cam.rectToScreen(r);
    const margin = 72.0;
    final inView =
        s.left >= margin && s.top >= margin + 48 && s.right <= size.width - margin && s.bottom <= size.height - margin;
    final readable = math.max(s.width, s.height) >= 60;
    if (inView && readable) return;
    if (readable && s.width < size.width * 0.7 && s.height < size.height * 0.6) {
      final c = r.center;
      BoardViewPrefs.of(ui).animateCamera(Camera(size.width / 2 - c.dx * cam.z, size.height / 2 - c.dy * cam.z, cam.z));
    } else {
      fitTo(ui, r.inflate(math.max(r.width, r.height) * 0.6), maxZoomFit: 1.25);
    }
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
    valueListenable: BoardViewPrefs.of(ui).searchOpen,
    builder: (context, open, _) {
      if (!open) return const SizedBox.shrink();
      final view = ui.view;
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _close();
        },
        child: ListenableBuilder(
          listenable: Listenable.merge([ui.controller, _text]),
          builder: (context, _) {
            final hits = _hits();
            final index = hits.isEmpty ? 0 : math.min(_index, hits.length - 1);
            final current = hits.isEmpty ? null : hits[index];
            if (current != null) {
              final key = '${_text.text}|${current.object.id}';
              if (_lastShown != key) {
                _lastShown = key;
                WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(current.rect));
              }
            } else {
              _lastShown = null;
            }
            final label = _text.text.trim().isEmpty
                ? ''
                : (hits.isEmpty ? 'Keine Treffer' : '${index + 1} von ${hits.length}');
            void go(int d) {
              if (hits.isEmpty) return;
              setState(() => _index = (index + d + hits.length) % hits.length);
            }

            return Stack(
              children: [
                if (view != null)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: CustomPaint(
                        key: const Key('stachelSearchHits'),
                        painter: _HitsPainter(hits, current?.object.id, view.camera),
                      ),
                    ),
                  ),
                // UX-Review P2: on top of the stack, the vote bar and the timer below it; Q3: replace row under the bar
                Positioned.fill(
                  child: BoardTopSlot(
                    ui: ui,
                    order: BoardTopSlot.searchOrder,
                    stretch: true,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _bar(label, hits, go),
                        if (replaceOpen.value && _canReplace) ...[const SizedBox(height: 6), _replaceRow(hits, index)],
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      );
    },
  );

  /// Second row „Ersetzen durch“ (web `.tools-replace`): field, preview „3 Stellen in 2 Objekten“, „Ersetzen“, „Alle“.
  Widget _replaceRow(List<SearchHit> hits, int index) {
    final t = ui.theme;
    final p = replacePreview(hits.map((h) => h.object), _text.text);
    final canGo = p.total > 0;
    return Material(
      key: const Key('stachelReplaceBar'),
      color: t.surface,
      elevation: 3,
      shape: RoundedRectangleBorder(side: BorderSide(color: t.ink, width: 2)),
      child: Padding(
        padding: const EdgeInsets.only(left: 10, right: 4),
        child: Row(
          children: [
            Icon(Icons.find_replace, color: t.grey),
            const SizedBox(width: 6),
            Expanded(
              child: TextField(
                key: const Key('stachelReplaceField'),
                controller: _replace,
                autocorrect: false,
                enableSuggestions: false,
                maxLength: 500,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  hintText: 'Ersetzen durch',
                  border: InputBorder.none,
                  isDense: true,
                  counterText: '',
                ),
                onSubmitted: (_) {
                  if (canGo) _doReplace(hits, index, first: true);
                },
              ),
            ),
            if (_text.text.trim().isNotEmpty)
              Flexible(
                child: Text(
                  replacePreviewText(p),
                  key: const Key('stachelReplaceCount'),
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: t.grey, fontSize: 12),
                ),
              ),
            TextButton(
              key: const Key('stachelReplaceOne'),
              onPressed: canGo ? () => _doReplace(hits, index, first: true) : null,
              child: const Text('Ersetzen'),
            ),
            TextButton(
              key: const Key('stachelReplaceAll'),
              onPressed: canGo ? () => _doReplace(hits, index, first: false) : null,
              child: const Text('Alle'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bar(String label, List<SearchHit> hits, void Function(int) go) {
    final t = ui.theme;
    return Material(
      key: const Key('stachelSearchBar'),
      color: t.surface,
      elevation: 3,
      shape: RoundedRectangleBorder(side: BorderSide(color: t.ink, width: 2)),
      child: Padding(
        padding: const EdgeInsets.only(left: 10),
        child: Row(
          children: [
            Icon(Icons.search, color: t.grey),
            const SizedBox(width: 6),
            Expanded(
              child: TextField(
                key: const Key('stachelSearchField'),
                controller: _text,
                focusNode: _focus,
                autofocus: true,
                textInputAction: TextInputAction.search,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  hintText: 'Auf dem Board suchen',
                  border: InputBorder.none,
                  isDense: true,
                ),
                onChanged: (_) => setState(() => _index = 0),
                onSubmitted: (_) {
                  go(1);
                  _focus.requestFocus();
                },
              ),
            ),
            Semantics(
              liveRegion: true,
              child: Text(
                label,
                key: const Key('stachelSearchCount'),
                style: TextStyle(color: t.grey, fontSize: 12),
              ),
            ),
            IconButton(
              key: const Key('stachelSearchPrev'),
              tooltip: 'Vorheriger Treffer',
              visualDensity: VisualDensity.compact,
              onPressed: hits.length < 2 ? null : () => go(-1),
              icon: const Icon(Icons.keyboard_arrow_up),
            ),
            IconButton(
              key: const Key('stachelSearchNext'),
              tooltip: 'Nächster Treffer',
              visualDensity: VisualDensity.compact,
              onPressed: hits.length < 2 ? null : () => go(1),
              icon: const Icon(Icons.keyboard_arrow_down),
            ),
            if (_canReplace)
              IconButton(
                key: const Key('stachelSearchReplaceToggle'),
                tooltip: 'Suchen und ersetzen',
                visualDensity: VisualDensity.compact,
                isSelected: replaceOpen.value,
                onPressed: () => replaceOpen.value = !replaceOpen.value,
                icon: const Icon(Icons.find_replace),
              ),
            IconButton(
              key: const Key('stachelSearchAll'),
              tooltip: 'Alle wählen',
              visualDensity: VisualDensity.compact,
              onPressed: hits.isEmpty
                  ? null
                  : () {
                      ui.editor.select({for (final h in hits) h.object.id});
                      _close();
                    },
              icon: const Icon(Icons.select_all),
            ),
            IconButton(
              key: const Key('stachelSearchClose'),
              tooltip: 'Suche schließen',
              visualDensity: VisualDensity.compact,
              onPressed: _close,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }
}

/// All hits outlined (5 px around, green), the current one pink with a halo (web `.tools-search-hit`, `.is-current`).
class _HitsPainter extends CustomPainter {
  _HitsPainter(this.hits, this.current, this.camera) : super(repaint: camera);
  final List<SearchHit> hits;
  final String? current;
  final CameraController camera;

  @override
  void paint(Canvas canvas, Size size) {
    final cam = camera.value;
    final view = (Offset.zero & size).inflate(40);
    for (final h in hits) {
      final r = cam.rectToScreen(h.rect).inflate(5);
      if (!r.overlaps(view)) continue;
      final cur = h.object.id == current;
      final rr = RRect.fromRectAndRadius(r, const Radius.circular(7));
      if (cur) canvas.drawRRect(rr.inflate(4), Paint()..color = const Color(0x38EC4E92));
      canvas.drawRRect(rr, Paint()..color = cur ? const Color(0x14EC4E92) : const Color(0x38C9E14A));
      canvas.drawRRect(
        rr.deflate(cur ? 1.5 : 1),
        Paint()
          ..color = cur ? const Color(0xFFEC4E92) : const Color(0xFFA9C22A)
          ..style = PaintingStyle.stroke
          ..strokeWidth = cur ? 3 : 2,
      );
    }
  }

  @override
  bool shouldRepaint(_HitsPainter old) => old.hits != hits || old.current != current;
}
