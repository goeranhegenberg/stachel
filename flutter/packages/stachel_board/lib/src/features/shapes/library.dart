import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../stickers/sticker_data.dart';
import '../stickers/sticker_widgets.dart';
import 'catalog.dart';
import 'shape_state.dart';
import 'shape_widgets.dart';

/// Id of the library sheet (web sidebar tab `shapes.library`; on the phone a sheet from below) – args `{'tab':
/// 'shapes' | 'stickers' | 'icons'}`.
const librarySheet = 'shapes.library';

/// Opens the library on [tab] (web „Alle Formen“ / „Alle Sticker und Icons“).
Future<void> openLibrary(BuildContext context, BoardUi ui, String tab) async {
  P2Tools.of(ui.editor).libraryTab = tab;
  await ui.openRegisteredSheet(context, librarySheet, args: {'tab': tab});
}

/// Picks [e] for the shape tool and activates it (web `armShape`).
void armShape(BoardUi ui, ShapeEntry e) {
  P2Tools.of(ui.editor).setShape(e.kind, e.id);
  ui.editor.useTool('shape');
}

/// Picks [item] for the sticker tool and activates it (web `armSticker`).
void armSticker(BoardUi ui, PlaceItem item) {
  P2Tools.of(ui.editor).sticker = item;
  ui.editor.useTool('shapes.sticker');
}

const _tabs = [
  ('shapes', 'Formen', 'Formen suchen'),
  ('stickers', 'Sticker', 'Emoji oder Stempel suchen'),
  ('icons', 'Icons', 'Icons suchen'),
];

/// The library (web `LibraryPanel`, J01/J03–J05): Formen / Sticker / Icons, search, sections; tapping a tile picks
/// the tool and closes the sheet – the next tap on the board places it (dragging tiles onto the board is the
/// desktop's way, the web's phone layout taps as well).
class ShapeLibrary extends StatefulWidget {
  const ShapeLibrary({super.key, required this.ui, this.tab});
  final BoardUi ui;
  final String? tab;

  @override
  State<ShapeLibrary> createState() => _ShapeLibraryState();
}

class _ShapeLibraryState extends State<ShapeLibrary> {
  late String tab = widget.tab ?? P2Tools.of(widget.ui.editor).libraryTab;
  final query = TextEditingController();

  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    P2Tools.of(ui.editor).ui = ui;
    RecentEmoji.load(ui.host.readSetting).then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  void _pick(VoidCallback arm) {
    Navigator.of(context).pop();
    arm();
  }

  @override
  Widget build(BuildContext context) {
    final current = _tabs.firstWhere((t) => t.$1 == tab, orElse: () => _tabs.first);
    return SafeArea(
      child: SizedBox(
        key: const Key('stachelLibrary'),
        height: MediaQuery.sizeOf(context).height * 0.82,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                segments: [
                  for (final (id, label, _) in _tabs)
                    ButtonSegment(
                      value: id,
                      label: Text(label, key: Key('stachelLibTab-$id')),
                    ),
                ],
                selected: {tab},
                onSelectionChanged: (s) => setState(() {
                  tab = s.first;
                  P2Tools.of(ui.editor).libraryTab = tab;
                  query.clear();
                }),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: TextField(
                key: const Key('stachelLibSearch'),
                controller: query,
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: const Icon(Icons.search),
                  hintText: current.$3,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Antippen und dann aufs Board tippen.',
                  style: TextStyle(fontSize: 12.5, color: ui.theme.grey),
                ),
              ),
            ),
            Expanded(child: CustomScrollView(slivers: _body())),
          ],
        ),
      ),
    );
  }

  List<Widget> _body() {
    final q = query.text.trim();
    switch (tab) {
      case 'stickers':
        if (q.isNotEmpty) {
          final found = [
            for (final s in stamps)
              if (searchMatches(q, [s.label, 'stempel'])) StampItem(s.id),
          ];
          final emoji = searchEmoji(q).take(160).map((e) => EmojiItem(e.ch));
          final all = <PlaceItem>[...found, ...emoji];
          return all.isEmpty ? [_empty('Nichts gefunden.')] : [_items('search', all)];
        }
        return [
          _section('Stempel'),
          _items('stamps', [for (final s in stamps) StampItem(s.id)]),
          _section('Zuletzt verwendet'),
          _items('recent', [for (final ch in RecentEmoji.list) EmojiItem(ch)]),
          for (final g in emojiGroups) ...[
            _section(g.label),
            _items(g.id, [for (final e in g.items) EmojiItem(e.ch)]),
          ],
        ];
      case 'icons':
        if (q.isNotEmpty) {
          final list = [
            for (final i in icons)
              if (searchMatches(q, [i.label, i.keys])) IconItem(i),
          ];
          return list.isEmpty ? [_empty('Kein Icon gefunden.')] : [_items('search', list)];
        }
        final groups = <String>{for (final i in icons) i.group};
        return [
          for (final g in groups) ...[
            _section(g),
            _items(g, [
              for (final i in icons)
                if (i.group == g) IconItem(i),
            ]),
          ],
        ];
      default:
        if (q.isNotEmpty) {
          final found = searchShapes(q);
          return found.isEmpty ? [_empty('Keine Form gefunden.')] : [_shapes(found)];
        }
        return [
          for (final (id, label) in shapeSections) ...[
            _section(label),
            _shapes([
              for (final e in shapeEntries)
                if (e.section == id) e,
            ]),
          ],
        ];
    }
  }

  Widget _section(String title) => SliverToBoxAdapter(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
      child: Text(title.toUpperCase(), style: ui.theme.label(size: 12.5, color: ui.theme.grey)),
    ),
  );

  Widget _empty(String text) => SliverToBoxAdapter(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Text(text, key: const Key('stachelLibEmpty'), textAlign: TextAlign.center),
    ),
  );

  Widget _shapes(List<ShapeEntry> list) {
    final tools = P2Tools.of(ui.editor);
    final shapeActive = ui.editor.activeToolId == 'shape';
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      sliver: SliverGrid.builder(
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 92, mainAxisExtent: 78),
        itemCount: list.length,
        itemBuilder: (context, i) {
          final e = list[i];
          final on = shapeActive && tools.shapeKind == e.kind && (tools.shapeEntry ?? e.id) == e.id;
          return Semantics(
            button: true,
            selected: on,
            label: e.label,
            child: InkWell(
              key: Key('stachelLibShape-${e.id}'),
              borderRadius: BorderRadius.circular(6),
              onTap: () => _pick(() => armShape(ui, e)),
              child: Container(
                margin: const EdgeInsets.all(2),
                decoration: BoxDecoration(
                  color: on ? ui.theme.accent.withValues(alpha: 0.15) : null,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    ShapeKindIcon(e.kind, w: e.w, h: e.h, size: 34, color: ui.theme.ink),
                    const SizedBox(height: 4),
                    Text(
                      e.label,
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11, height: 1.1),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _items(String section, List<PlaceItem> items) => SliverPadding(
    padding: const EdgeInsets.symmetric(horizontal: 8),
    sliver: SliverGrid.builder(
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 52, mainAxisExtent: 52),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        final label = switch (item) {
          StampItem(:final id) => 'Stempel ${stampById(id)?.label ?? id}',
          EmojiItem(:final ch) => 'Emoji $ch',
          IconItem(:final icon) => 'Icon ${icon.label}',
        };
        return Tooltip(
          message: label,
          child: Semantics(
            button: true,
            label: label,
            child: InkWell(
              key: Key('stachelLib-$section-${item.key}'),
              borderRadius: BorderRadius.circular(6),
              onTap: () => _pick(() => armSticker(ui, item)),
              child: Center(
                child: StickerItemPreview(item, size: item is IconItem ? 24 : 32, color: ui.theme.ink),
              ),
            ),
          ),
        );
      },
    ),
  );
}
