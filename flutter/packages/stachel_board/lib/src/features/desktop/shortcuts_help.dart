import 'package:flutter/material.dart';

import '../../editor/desktop.dart';
import '../../editor/registry/board_ui.dart';
import '../view/board_prefs.dart';

/// One row of the shortcut list (web `ShortcutDef.help`): group, keys as the web writes them, what it does.
class BoardShortcutHelp {
  const BoardShortcutHelp(this.group, this.keys, this.label);
  final String group;
  final String keys;
  final String label;
}

/// Groups in the order of the web's „Tastenkürzel“ (Werkzeuge, Bearbeiten, Ansicht first, then the modules).
const boardShortcutGroups = ['Werkzeuge', 'Bearbeiten', 'Ansicht', 'Anordnen', 'Mindmap', 'Zusammenarbeit'];

/// All keys of the board (docs/features/desktop.md §2) – texts and order like the web's list.
const boardShortcuts = <BoardShortcutHelp>[
  BoardShortcutHelp('Werkzeuge', 'V', 'Auswählen'),
  BoardShortcutHelp('Werkzeuge', 'H', 'Ansicht verschieben'),
  BoardShortcutHelp('Werkzeuge', 'N', 'Haftnotiz'),
  BoardShortcutHelp('Werkzeuge', 'T', 'Text'),
  BoardShortcutHelp('Werkzeuge', 'S', 'Form'),
  BoardShortcutHelp('Werkzeuge', 'L', 'Verbinder'),
  BoardShortcutHelp('Werkzeuge', 'P', 'Stift'),
  BoardShortcutHelp('Werkzeuge', 'E', 'Radierer'),
  BoardShortcutHelp('Werkzeuge', 'F', 'Rahmen'),
  BoardShortcutHelp('Werkzeuge', 'C', 'Kommentar'),
  BoardShortcutHelp('Werkzeuge', 'R / O', 'Rechteck / Kreis'),
  BoardShortcutHelp('Bearbeiten', 'Strg Z / Strg Y', 'Rückgängig / Wiederholen'),
  BoardShortcutHelp('Bearbeiten', 'Strg C / V / X', 'Kopieren / Einfügen / Ausschneiden'),
  BoardShortcutHelp('Bearbeiten', 'Strg D', 'Duplizieren'),
  BoardShortcutHelp('Bearbeiten', 'Strg A', 'Alles auswählen'),
  BoardShortcutHelp('Bearbeiten', 'Strg G', 'Gruppieren'),
  BoardShortcutHelp('Bearbeiten', 'Strg Umschalt G', 'Gruppierung lösen'),
  BoardShortcutHelp('Bearbeiten', 'Entf', 'Löschen'),
  BoardShortcutHelp('Bearbeiten', 'Enter / Tippen', 'Text bearbeiten'),
  BoardShortcutHelp('Bearbeiten', 'Esc', 'Werkzeug beenden / Auswahl aufheben'),
  BoardShortcutHelp('Bearbeiten', '← → ↑ ↓', 'Auswahl verschieben (Umschalt: 10 Punkte)'),
  BoardShortcutHelp('Bearbeiten', 'Tab', 'Nächste Haftnotiz (beim Schreiben)'),
  BoardShortcutHelp('Bearbeiten', 'Strg B / I', 'Fett / Kursiv'),
  BoardShortcutHelp('Bearbeiten', 'Strg U', 'Unterstrichen'),
  BoardShortcutHelp('Bearbeiten', 'Strg Umschalt S', 'Durchgestrichen'),
  BoardShortcutHelp('Bearbeiten', 'Strg K', 'Link einfügen'),
  BoardShortcutHelp('Bearbeiten', 'Strg Alt C', 'Format kopieren'),
  BoardShortcutHelp('Bearbeiten', 'Strg Alt V', 'Format einfügen'),
  BoardShortcutHelp('Ansicht', 'Strg K', 'Befehl suchen'),
  BoardShortcutHelp('Ansicht', 'Strg F', 'Auf dem Board suchen'),
  BoardShortcutHelp('Ansicht', 'Strg H', 'Suchen und ersetzen'),
  BoardShortcutHelp('Ansicht', 'Leertaste + Ziehen', 'Ansicht verschieben'),
  BoardShortcutHelp('Ansicht', 'Rechtsklick + Ziehen', 'Ansicht verschieben'),
  BoardShortcutHelp('Ansicht', 'Rad / Strg + Rad', 'Zoomen (Mausrad einstellbar)'),
  BoardShortcutHelp('Ansicht', 'Umschalt + Rad', 'Seitlich verschieben'),
  BoardShortcutHelp('Ansicht', 'Umschalt 1', 'Alles einpassen'),
  BoardShortcutHelp('Ansicht', 'Umschalt 2', 'Auf Auswahl zoomen'),
  BoardShortcutHelp('Ansicht', '+ / −', 'Vergrößern / Verkleinern'),
  BoardShortcutHelp('Ansicht', 'Strg 0 / Umschalt 0', 'Zoom 100 %'),
  BoardShortcutHelp('Ansicht', "Strg '", 'Raster ein/aus'),
  BoardShortcutHelp('Ansicht', 'Bild ↑ / Bild ↓', 'Vorheriger / nächster Rahmen'),
  BoardShortcutHelp('Ansicht', 'Strg \\', 'Oberfläche aus-/einblenden'),
  BoardShortcutHelp('Ansicht', 'F11', 'Vollbild'),
  BoardShortcutHelp('Ansicht', 'Strg Alt H', 'Versionsverlauf'),
  BoardShortcutHelp('Ansicht', '?', 'Diese Übersicht'),
  BoardShortcutHelp('Anordnen', 'Strg ] / Strg [', 'Eine Ebene nach vorne / hinten'),
  BoardShortcutHelp('Anordnen', 'Strg Umschalt ] / [', 'Ganz nach vorne / hinten'),
  BoardShortcutHelp('Anordnen', 'Strg Umschalt L', 'Sperren / Entsperren'),
  BoardShortcutHelp('Anordnen', 'Strg Umschalt H', 'Ausblenden / Einblenden'),
  BoardShortcutHelp('Mindmap', 'Tab', 'Unterthema anlegen'),
  BoardShortcutHelp('Mindmap', 'Enter', 'Thema auf gleicher Ebene'),
  BoardShortcutHelp('Mindmap', 'Pfeiltasten', 'Zwischen Themen wechseln'),
  BoardShortcutHelp('Mindmap', 'Strg .', 'Zweig ein-/ausklappen'),
  BoardShortcutHelp('Zusammenarbeit', '/', 'Nachricht am Mauszeiger'),
];

/// Sets the wheel setting and keeps it on the device.
void setWheelMode(WheelMode m) {
  BoardDesktop.wheel.value = m;
  BoardPrefs.set(BoardDesktop.wheelKey, m.name);
}

/// „Tastenkürzel“ (web `ShortcutsDialog`): filter field, groups, and the switch „Mausrad: Zoomen / Schwenken“.
Future<void> showBoardShortcuts(BuildContext context, BoardUi ui) => showDialog<void>(
  context: context,
  builder: (ctx) => BoardShortcutsDialog(ui: ui),
);

class BoardShortcutsDialog extends StatefulWidget {
  const BoardShortcutsDialog({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<BoardShortcutsDialog> createState() => _BoardShortcutsDialogState();
}

class _BoardShortcutsDialogState extends State<BoardShortcutsDialog> {
  String _q = '';

  static String _fold(String s) =>
      s.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss');

  @override
  Widget build(BuildContext context) {
    final theme = widget.ui.theme;
    final q = _fold(_q.trim());
    final rows = [
      for (final s in boardShortcuts)
        if (q.isEmpty || _fold(s.label).contains(q) || _fold(s.keys).contains(q) || _fold(s.group).contains(q)) s,
    ];
    return AlertDialog(
      key: const Key('stachelShortcuts'),
      title: const Text('Tastenkürzel'),
      content: SizedBox(
        width: 560,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const Key('stachelShortcutsFilter'),
              autofocus: true,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Kürzel suchen'),
              onChanged: (v) => setState(() => _q = v),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: rows.isEmpty
                  ? Padding(padding: const EdgeInsets.all(16), child: Text('Kein Kürzel passt zu „${_q.trim()}“.'))
                  : ListView(
                      shrinkWrap: true,
                      children: [
                        for (final g in boardShortcutGroups)
                          if (rows.any((r) => r.group == g)) ...[
                            Padding(
                              padding: const EdgeInsets.fromLTRB(0, 12, 0, 4),
                              child: Text(g.toUpperCase(), style: theme.label(size: 13)),
                            ),
                            for (final r in rows.where((r) => r.group == g))
                              Padding(
                                padding: const EdgeInsets.symmetric(vertical: 3),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    SizedBox(
                                      width: 190,
                                      child: _Caps(keys: r.keys, theme: theme),
                                    ),
                                    Expanded(child: Text(r.label)),
                                  ],
                                ),
                              ),
                          ],
                      ],
                    ),
            ),
          ],
        ),
      ),
      actions: [
        ValueListenableBuilder<WheelMode>(
          valueListenable: BoardDesktop.wheel,
          builder: (context, mode, _) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Mausrad'),
              const SizedBox(width: 8),
              SegmentedButton<WheelMode>(
                key: const Key('stachelWheelMode'),
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: WheelMode.zoom, label: Text('Zoomen')),
                  ButtonSegment(value: WheelMode.pan, label: Text('Schwenken')),
                ],
                selected: {mode},
                onSelectionChanged: (s) => setWheelMode(s.single),
              ),
            ],
          ),
        ),
        FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('SCHLIESSEN')),
      ],
    );
  }
}

/// „Strg Umschalt G / Strg Y“ as key caps (web `keyCaps`): words like „Ziehen“ stay plain text.
class _Caps extends StatelessWidget {
  const _Caps({required this.keys, required this.theme});
  final String keys;
  final BoardUiTheme theme;

  static const _words = {'Ziehen', 'Rad', 'Tippen', 'beim'};

  @override
  Widget build(BuildContext context) {
    final parts = <Widget>[];
    for (final (i, alt) in keys.split(' / ').indexed) {
      if (i > 0) parts.add(Text(' / ', style: TextStyle(color: theme.grey)));
      for (final (j, p) in alt.split(' + ').indexed) {
        if (j > 0) parts.add(Text(' + ', style: TextStyle(color: theme.grey)));
        final words = p.split(' ').where((w) => _words.contains(w)).toList();
        final caps = p.split(' ').where((w) => !_words.contains(w)).join(' ');
        if (caps.isNotEmpty) {
          parts.add(
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                border: Border.all(color: theme.ink.withValues(alpha: 0.4)),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(caps, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            ),
          );
        }
        for (final w in words) {
          parts.add(Text(' $w', style: TextStyle(color: theme.grey)));
        }
      }
    }
    return Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: parts);
  }
}
