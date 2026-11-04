import 'package:flutter/material.dart';

import '../registry/board_ui.dart';

/// Label of the switch „Mehrfachauswahl“ (D02) on the phone (UX P6, B11).
const multiSelectLabel = 'Mehrere wählen';

/// UX P6 (B11): the switch „Mehrfachauswahl“ (D02) as a labeled chip instead of a bare icon. Off: „Mehrere wählen“;
/// on: filled, with a check mark and the number of selected objects – tapping objects adds or removes them. It turns
/// itself off after moving the selection or another change (`BoardView`), on a tap into the empty board and with
/// „Auswahl aufheben“.
class MultiSelectChip extends StatelessWidget {
  const MultiSelectChip({super.key, required this.ui});

  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final editor = ui.editor;
    final theme = ui.theme;
    final on = editor.multiSelect;
    final n = editor.selection.value.length;
    final fg = on ? Colors.white : theme.ink;
    return Semantics(
      button: true,
      toggled: on,
      label: on ? '$multiSelectLabel, an, $n ausgewählt' : multiSelectLabel,
      hint: on ? 'Weitere Objekte antippen fügt sie hinzu oder nimmt sie heraus' : null,
      excludeSemantics: true,
      child: Tooltip(
        message: on ? 'Mehrfachauswahl beenden' : 'Weitere Objekte antippen, um sie hinzuzufügen',
        child: Material(
          color: on ? theme.accent : theme.surface,
          shape: StadiumBorder(side: BorderSide(color: on ? theme.accent : theme.ink, width: 1.5)),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: const Key('stachelMultiSelect'),
            onTap: () => editor.multiSelect = !on,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 36),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(on ? Icons.check_circle : Icons.library_add_check_outlined, size: 18, color: fg),
                    const SizedBox(width: 6),
                    Text(multiSelectLabel, style: theme.label(size: 14, color: fg)),
                    if (on) ...[
                      const SizedBox(width: 6),
                      Container(
                        key: const Key('stachelMultiSelectCount'),
                        constraints: const BoxConstraints(minWidth: 20),
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
                        child: Text(
                          '$n',
                          textAlign: TextAlign.center,
                          style: theme.label(size: 13, color: theme.accentDark),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
