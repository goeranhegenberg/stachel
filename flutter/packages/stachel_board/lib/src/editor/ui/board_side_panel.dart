import 'package:flutter/material.dart';

/// Large windows (desktop, tablet – UX-Review P12): a panel at the right edge over the full height instead of a sheet
/// from the bottom (web: sidebar for comments, frames …). [builder] is the same content as the sheet; it closes with
/// „✕“, Esc, a click on the board beside it or `Navigator.pop` (like the sheet, so callers stay the same).
Future<T?> showBoardSidePanel<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  String? title,
  double width = 380,
  String panelKey = 'stachelSidePanel',
}) => showGeneralDialog<T>(
  context: context,
  barrierDismissible: true,
  barrierLabel: 'Schließen',
  barrierColor: const Color(0x14000000),
  transitionDuration: const Duration(milliseconds: 180),
  pageBuilder: (ctx, _, _) => BoardSidePanel(
    key: Key(panelKey),
    title: title,
    width: width,
    child: Builder(builder: builder),
  ),
  transitionBuilder: (ctx, anim, _, child) => SlideTransition(
    position: Tween(
      begin: const Offset(1, 0),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
    child: child,
  ),
);

/// The panel of [showBoardSidePanel]: right edge, full height, a heading row with „✕“.
class BoardSidePanel extends StatelessWidget {
  const BoardSidePanel({super.key, required this.child, this.title, this.width = 380});

  final Widget child;
  final String? title;
  final double width;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Align(
      alignment: Alignment.centerRight,
      child: Material(
        color: theme.colorScheme.surface,
        elevation: 8,
        child: SizedBox(
          width: width,
          height: double.infinity,
          child: SafeArea(
            left: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 4, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          title ?? '',
                          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.3),
                        ),
                      ),
                      IconButton(
                        key: const Key('stachelSidePanelClose'),
                        tooltip: 'Schließen (Esc)',
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(context).maybePop(),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: Align(alignment: Alignment.topCenter, child: child),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
