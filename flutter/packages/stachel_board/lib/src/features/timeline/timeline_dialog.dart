import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show LengthLimitingTextInputFormatter;

import '../../editor/registry/board_ui.dart';
import '../cards/live_text.dart';
import '../core/core_widgets.dart' show ColorSwatchDot;
import '../shapes/shape_widgets.dart' show colorNameOf;
import 'timeline_actions.dart';
import 'timeline_model.dart';
import 'timeline_overlay.dart' show tlSendText;
import 'timeline_state.dart';

/// Dialog „Eintrag“ / „Meilenstein“ (web `ItemDialog`, long press on an item or „Titel, Datum und Spur …“): title (live),
/// start/end (end ≥ start, moving the start keeps the length), lane, milestone, color (10), delete.
Future<void> openTimelineItemDialog(BuildContext context, BoardUi ui, String id, String key) => ui.openSheet<void>(
  context,
  (ctx) => TimelineItemSheet(ui: ui, id: id, itemKey: key),
  scrollControlled: true,
  closeOnSelectionChange: false,
);

class TimelineItemSheet extends StatefulWidget {
  const TimelineItemSheet({super.key, required this.ui, required this.id, required this.itemKey});
  final BoardUi ui;
  final String id;
  final String itemKey;

  @override
  State<TimelineItemSheet> createState() => _TimelineItemSheetState();
}

class _TimelineItemSheetState extends State<TimelineItemSheet> {
  late final LiveText _title;
  bool _closing = false;

  BoardUi get ui => widget.ui;

  TlItem? get _item {
    final o = ui.controller.state[widget.id];
    return o == null ? null : safeTimeline(o.raw['timeline']).items[widget.itemKey];
  }

  @override
  void initState() {
    super.initState();
    _title = LiveText(
      read: () => _item?.title ?? '',
      send: (base, text) => tlSendText(ui, widget.id, TlFocus.item(widget.itemKey), base, text),
    );
    ui.controller.addListener(_changed);
  }

  void _changed() {
    _title.pull();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    ui.controller.removeListener(_changed);
    _title.dispose();
    _title.controller.dispose();
    super.dispose();
  }

  Future<void> _pickDay(String which, TlItem it) async {
    final cur = which == 'start' ? it.a : it.b;
    final d = DateTime.fromMillisecondsSinceEpoch(cur * tlDayMs, isUtc: true);
    final first = which == 'end' ? DateTime.fromMillisecondsSinceEpoch(it.a * tlDayMs, isUtc: true) : DateTime(1970);
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(d.year, d.month, d.day),
      firstDate: DateTime(first.year, first.month, first.day),
      lastDate: DateTime(2200),
    );
    if (picked == null) return;
    tlSetDay(ui, widget.id, widget.itemKey, which, tlToday(picked));
  }

  @override
  Widget build(BuildContext context) {
    final o = ui.controller.state[widget.id];
    final it = _item;
    if (o == null || it == null) {
      // deleted meanwhile (also by someone else): close like the web
      if (!_closing) {
        _closing = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) Navigator.of(context).maybePop();
        });
      }
      return const SizedBox(height: 80);
    }
    final d = safeTimeline(o.raw['timeline']);
    final theme = ui.theme;
    final color = it.color ?? tlDefaultColor;
    Widget day(String which, String label, int n) => Expanded(
      child: InkWell(
        key: Key('stachelTlDay-$which'),
        onTap: () => _pickDay(which, it),
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder(), isDense: true),
          child: Text(tlDayLabel(n, true)),
        ),
      ),
    );
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(
            key: const Key('stachelTlDialog'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(it.ms ? 'MEILENSTEIN' : 'EINTRAG', style: theme.label(size: 16)),
              const SizedBox(height: 12),
              TextField(
                key: const Key('stachelTlTitle'),
                controller: _title.controller,
                inputFormatters: [LengthLimitingTextInputFormatter(200)],
                decoration: const InputDecoration(labelText: 'Titel', border: OutlineInputBorder(), isDense: true),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  day('start', it.ms ? 'Datum' : 'Beginn', it.a),
                  if (!it.ms) ...[const SizedBox(width: 12), day('end', 'Ende', it.b)],
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'Spur', border: OutlineInputBorder(), isDense: true),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          key: const Key('stachelTlLane'),
                          isDense: true,
                          isExpanded: true,
                          value: it.lane,
                          items: [
                            for (final l in d.lanes)
                              DropdownMenuItem(
                                value: l,
                                child: Text(
                                  (d.names[l] ?? '').isEmpty ? 'Ohne Namen' : d.names[l]!,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (v) {
                            if (v != null && v != it.lane) tlPatchItem(ui, widget.id, widget.itemKey, lane: v);
                          },
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: CheckboxListTile(
                      key: const Key('stachelTlMsCheck'),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      controlAffinity: ListTileControlAffinity.leading,
                      title: const Text('Meilenstein (ein Tag)'),
                      value: it.ms,
                      onChanged: (v) {
                        if (v != null && v != it.ms) tlPatchItem(ui, widget.id, widget.itemKey, ms: v);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text('Farbe', style: theme.label(size: 13, color: theme.grey)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in tlColors)
                    Semantics(
                      label: 'Farbe ${colorNameOf(c)}',
                      selected: color == c,
                      button: true,
                      child: InkWell(
                        key: Key('stachelTlColor-$c'),
                        customBorder: const CircleBorder(),
                        onTap: () => tlPatchItem(
                          ui,
                          widget.id,
                          widget.itemKey,
                          color: c == tlDefaultColor ? null : c,
                          clearColor: c == tlDefaultColor,
                        ),
                        child: Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: color == c ? theme.ink : Colors.transparent, width: 2),
                          ),
                          child: ColorSwatchDot(c, size: 32, ink: theme.ink),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  TextButton(
                    key: const Key('stachelTlDelete'),
                    onPressed: () {
                      _closing = true;
                      tlRemoveItem(ui, widget.id, widget.itemKey);
                      Navigator.of(context).maybePop();
                    },
                    child: Text('Löschen', style: TextStyle(color: theme.danger)),
                  ),
                  const Spacer(),
                  FilledButton(
                    key: const Key('stachelTlDone'),
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('Fertig'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
