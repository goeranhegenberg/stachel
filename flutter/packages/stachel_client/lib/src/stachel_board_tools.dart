import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';
import 'stachel_style.dart';

// F2: tool bar, context bar, menus and their pickers come from the registries of `stachel_board`
// (`editor/registry/`, `editor/ui/`, `features/*`); the app adds its own entries in `stachel_app_features.dart`. What
// stays here: undo/redo in the edit bar while writing (otherwise they sit in the tool bar, UX-A1) and the edit bar
// (with the format bar).

/// Undo/redo buttons (edit bar while writing). [beforeHistory] runs first (the board ends writing, so undo takes back
/// the text just written – like the web, where undo while writing touches only the text – and not an earlier step).
class StachelUndoRedo extends StatelessWidget {
  const StachelUndoRedo({super.key, required this.controller, required this.enabled, this.beforeHistory});
  final BoardController controller;
  final bool enabled;
  final VoidCallback? beforeHistory;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        key: const Key('stachelUndo'),
        tooltip: 'Rückgängig',
        visualDensity: VisualDensity.compact,
        icon: const Icon(Icons.undo),
        onPressed: enabled && controller.canUndo
            ? () {
                beforeHistory?.call();
                controller.undo();
              }
            : null,
      ),
      IconButton(
        key: const Key('stachelRedo'),
        tooltip: 'Wiederholen',
        visualDensity: VisualDensity.compact,
        icon: const Icon(Icons.redo),
        onPressed: enabled && controller.canRedo
            ? () {
                beforeHistory?.call();
                controller.redo();
              }
            : null,
      ),
    ],
  );
}

/// Bar above the keyboard while writing in an object: one row (UX P11 – no dead label „Text bearbeiten“) with the
/// format bar (scrolls sideways), [extra] and „FERTIG“; only when someone else writes there a line above it says so
/// (web `RemoteHint` „Wird gerade auch von … bearbeitet“).
class StachelEditBar extends StatelessWidget {
  const StachelEditBar({super.key, required this.writer, required this.onDone, this.editor, this.extra});

  /// Someone else writing in the same object, full name ('' = nobody).
  final String writer;
  final VoidCallback onDone;

  /// With an editor: the format bar for the selected text (E3).
  final BoardEditor? editor;

  /// More actions before „FERTIG“ (mind node: Unterthema, Gleiche Ebene).
  final Widget? extra;

  @override
  Widget build(BuildContext context) => Material(
    color: Sk.surface,
    child: Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Sk.ink, width: 3)),
      ),
      padding: const EdgeInsets.fromLTRB(6, 2, 4, 2),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (writer.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
              child: Text(
                'Wird gerade auch von $writer bearbeitet',
                key: const Key('stachelEditHint'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Sk.pinkDark, fontWeight: FontWeight.w600),
              ),
            ),
          SizedBox(
            height: 48,
            child: Row(
              children: [
                Expanded(child: editor == null ? const SizedBox.shrink() : _fading(StachelFormatBar(editor: editor!))),
                ?extra,
                TextButton(key: const Key('stachelEditDone'), onPressed: onDone, child: const Text('FERTIG')),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  /// The format bar fades out at its right end: there is more to scroll to.
  Widget _fading(Widget bar) => ShaderMask(
    blendMode: BlendMode.dstIn,
    shaderCallback: (r) => const LinearGradient(
      colors: [Colors.white, Colors.white, Color(0x00FFFFFF)],
      stops: [0, 0.88, 1],
    ).createShader(r),
    child: bar,
  );
}

/// Format bar while writing – the package's [RichFormatBar] (P8, like the web's FormatBar on the phone: size, bold,
/// italic, underline, text color, highlight, link and „Mehr“ with paragraph style, strike, lists, indent, alignment,
/// font) on the selected text (nothing selected: the whole text).
class StachelFormatBar extends StatelessWidget {
  const StachelFormatBar({super.key, required this.editor});
  final BoardEditor editor;

  @override
  Widget build(BuildContext context) => RichFormatBar(editor: editor);
}
