import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/paint_utils.dart';
import '../../mindmap/mind_render.dart' show webTextOn;
import 'card_model.dart';
import 'live_text.dart';
import 'structure_state.dart';

// Card UI of package P3 (web `structure/card/card.tsx`): status, person and due date choosers of the context bar, the
// details dialog „Karte“ (title and description live, status, person, due date, tags, color, „Fertig“) as a full sheet.

Color _c(String hex) => parseColor(hex, const Color(0xFF1763B5));

/// Avatar of a person (web `Avatar`: user color, initials).
class CardAvatar extends StatelessWidget {
  const CardAvatar({super.key, required this.person, this.size = 26});
  final CardPerson person;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: _c(userColorOf(person.key)), shape: BoxShape.circle),
    child: Text(
      initialsOf(person.name),
      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: size * 0.42),
    ),
  );
}

/// The person of a card (`assignee`).
CardPerson? assigneeOf(BoardObject o) {
  final a = o.raw['assignee'];
  return a is Map && a['key'] is String ? CardPerson(a['key'] as String, '${a['name'] ?? ''}') : null;
}

/// Status sheet (web pop „Status“): the four statuses + „Ohne“. Returns `''` for „Ohne“, null when closed.
Future<String?> pickCardStatus(BuildContext context, BoardUi ui, String? current) => ui.openSheet<String>(
  context,
  (ctx) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final s in cardStatuses)
            ChoiceChip(
              key: Key('stachelCardStatus-${s.s}'),
              selected: current == s.s,
              avatar: CircleAvatar(backgroundColor: _c(s.color), radius: 5),
              label: Text(s.label),
              onSelected: (_) => Navigator.of(ctx).pop(s.s),
            ),
          ChoiceChip(
            key: const Key('stachelCardStatus-none'),
            selected: current == null,
            label: const Text('Ohne'),
            onSelected: (_) => Navigator.of(ctx).pop(''),
          ),
        ],
      ),
    ),
  ),
);

/// Person sheet (web pop „Zuständig“): everyone who opened the board + me + present ones, „Niemand“. Returns the
/// person, or a person with empty key for „Niemand“; null when closed.
Future<CardPerson?> pickCardPerson(BuildContext context, BoardUi ui, String? currentKey) {
  final people = cardPeople(ui.controller);
  return ui.openSheet<CardPerson>(
    context,
    scrollControlled: true,
    (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.7),
        child: ListView(
          shrinkWrap: true,
          children: [
            ListTile(title: Text('ZUSTÄNDIG', style: ui.theme.label(size: 15))),
            for (final p in people)
              ListTile(
                key: Key('stachelCardPerson-${p.key}'),
                leading: CardAvatar(person: p, size: 28),
                title: Text(p.name),
                selected: p.key == currentKey,
                onTap: () => Navigator.of(ctx).pop(p),
              ),
            ListTile(
              key: const Key('stachelCardPerson-none'),
              leading: const CircleAvatar(radius: 14, child: Icon(Icons.person_off_outlined, size: 16)),
              title: const Text('Niemand'),
              selected: currentKey == null,
              onTap: () => Navigator.of(ctx).pop(const CardPerson('', '')),
            ),
          ],
        ),
      ),
    ),
  );
}

String _day(DateTime d) => '${d.year}-${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}';

/// Due date (web pop „Fällig am“: date input + „Entfernen“): the system date picker; with a date set first the choice
/// „Datum ändern“ / „Entfernen“. Returns `YYYY-MM-DD`, `''` for removed, null when cancelled.
Future<String?> pickCardDue(BuildContext context, BoardUi ui, String? current) async {
  if (current != null) {
    final what = await ui.openSheet<String>(
      context,
      (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              key: const Key('stachelCardDueChange'),
              leading: const Icon(Icons.event),
              title: Text('Fällig am ${formatDue(current)} – ändern'),
              onTap: () => Navigator.of(ctx).pop('change'),
            ),
            ListTile(
              key: const Key('stachelCardDueRemove'),
              leading: const Icon(Icons.event_busy),
              title: const Text('Entfernen'),
              onTap: () => Navigator.of(ctx).pop('remove'),
            ),
          ],
        ),
      ),
    );
    if (what == null) return null;
    if (what == 'remove') return '';
  }
  if (!context.mounted) return null;
  final now = DateTime.now();
  final init = current != null ? DateTime.tryParse(current) ?? now : now;
  final d = await showDatePicker(
    context: context,
    initialDate: init,
    firstDate: DateTime(now.year - 5),
    lastDate: DateTime(now.year + 10),
    helpText: 'FÄLLIG AM',
  );
  return d == null ? null : _day(d);
}

/// Opens the details dialog of card [id] (web modal `structure.card`) as a full sheet.
Future<void> openCardDetails(BuildContext context, BoardUi ui, String id) => ui.openSheet<void>(
  context,
  scrollControlled: true,
  closeOnSelectionChange: false,
  (ctx) => CardDetails(ui: ui, id: id),
);

/// The details dialog „Karte“: title and description live (concurrent typing merged by the server), status (tap again =
/// none), person, due date, tags (× removes, new tag ≤ 40 with 8 colors), color, „Fertig“.
class CardDetails extends StatefulWidget {
  const CardDetails({super.key, required this.ui, required this.id});
  final BoardUi ui;
  final String id;

  @override
  State<CardDetails> createState() => _CardDetailsState();
}

class _CardDetailsState extends State<CardDetails> {
  late final LiveText _title;
  late final LiveText _desc;
  final _tag = TextEditingController();
  String _tagColor = tagColors.isEmpty ? '#c9e14a' : tagColors.first;

  BoardUi get ui => widget.ui;
  BoardObject? get o => ui.controller.state[widget.id];
  StructureState get st => StructureState.of(ui.editor);

  @override
  void initState() {
    super.initState();
    _title = LiveText(read: () => o?.text ?? '', send: (base, text) => _act('card.title', base, text));
    _desc = LiveText(read: () => o?.desc ?? '', send: (base, text) => _act('card.desc', base, text));
    ui.controller.addListener(_changed);
  }

  void _act(String name, String base, String text) {
    if (o == null || !ui.controller.canAct(name)) return;
    ui.controller.act(name, {'id': widget.id, 'base': base, 'text': text});
  }

  void _changed() {
    _title.pull();
    _desc.pull();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    ui.controller.removeListener(_changed);
    _title.dispose();
    _desc.dispose();
    _title.controller.dispose();
    _desc.controller.dispose();
    _tag.dispose();
    super.dispose();
  }

  void _set(Map<String, Object?> patch) => st.patchCards([widget.id], patch);

  void _addTag() {
    final label = _tag.text.trim();
    final card = o;
    if (label.isEmpty || card == null) return;
    final tags = [
      for (final t in card.tags) {'label': t.label, 'color': t.color},
      {'label': label.length > tagMax ? label.substring(0, tagMax) : label, 'color': _tagColor},
    ];
    _set({'tags': tags});
    _tag.clear();
    setState(() {});
  }

  Widget _label(String s) => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 6),
    child: Text(s.toUpperCase(), style: ui.theme.label(size: 14)),
  );

  @override
  Widget build(BuildContext context) {
    final card = o;
    if (card == null) {
      return const SafeArea(
        child: Padding(padding: EdgeInsets.all(24), child: Text('Die Karte gibt es nicht mehr.')),
      );
    }
    final writable = ui.editor.editable && !card.locked;
    final color = card.color ?? (cardColors.isEmpty ? '#1763b5' : cardColors.first);
    final person = assigneeOf(card);
    final people = cardPeople(ui.controller);
    final choices = person != null && !people.any((p) => p.key == person.key) ? [person, ...people] : people;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
          child: ListView(
            key: const Key('stachelCardDetailsSheet'),
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            children: [
              Container(height: 6, color: _c(color)),
              const SizedBox(height: 8),
              Text('KARTE', style: ui.theme.label(size: 18)),
              _label('Titel'),
              TextField(
                key: const Key('stachelCardTitle'),
                controller: _title.controller,
                enabled: writable,
                decoration: InputDecoration(border: const OutlineInputBorder(), hintText: cardPlaceholder),
              ),
              _label('Beschreibung'),
              TextField(
                key: const Key('stachelCardDesc'),
                controller: _desc.controller,
                enabled: writable,
                minLines: 4,
                maxLines: 10,
                decoration: const InputDecoration(border: OutlineInputBorder()),
              ),
              _label('Status'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final s in cardStatuses)
                    ChoiceChip(
                      key: Key('stachelCardDetailStatus-${s.s}'),
                      selected: card.status == s.s,
                      avatar: CircleAvatar(backgroundColor: _c(s.color), radius: 5),
                      label: Text(s.label),
                      onSelected: writable ? (_) => _set({'status': card.status == s.s ? null : s.s}) : null,
                    ),
                ],
              ),
              _label('Zuständig'),
              DropdownButtonFormField<String>(
                key: const Key('stachelCardDetailPerson'),
                initialValue: person?.key ?? '',
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: [
                  const DropdownMenuItem(value: '', child: Text('Niemand')),
                  for (final p in choices) DropdownMenuItem(value: p.key, child: Text(p.name)),
                ],
                onChanged: writable
                    ? (k) {
                        final p = choices.where((x) => x.key == k).firstOrNull;
                        _set({'assignee': p?.toJson()});
                      }
                    : null,
              ),
              _label('Fällig am'),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      key: const Key('stachelCardDetailDue'),
                      onPressed: writable
                          ? () async {
                              final now = DateTime.now();
                              final d = await showDatePicker(
                                context: context,
                                initialDate: DateTime.tryParse(card.due ?? '') ?? now,
                                firstDate: DateTime(now.year - 5),
                                lastDate: DateTime(now.year + 10),
                              );
                              if (d != null) _set({'due': _day(d)});
                            }
                          : null,
                      icon: const Icon(Icons.event),
                      label: Text(card.due == null ? 'Datum wählen' : formatDue(card.due!)),
                    ),
                  ),
                  if (card.due != null && writable)
                    TextButton(
                      key: const Key('stachelCardDetailDueRemove'),
                      onPressed: () => _set({'due': null}),
                      child: const Text('ENTFERNEN'),
                    ),
                ],
              ),
              _label('Tags'),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final (i, t) in card.tags.indexed)
                    InputChip(
                      key: Key('stachelCardTag-$i'),
                      label: Text(t.label, style: TextStyle(color: webTextOn(t.color))),
                      backgroundColor: _c(t.color ?? '#c9e14a'),
                      deleteIconColor: webTextOn(t.color),
                      onDeleted: writable
                          ? () {
                              final rest = [
                                for (final (j, x) in card.tags.indexed)
                                  if (j != i) {'label': x.label, 'color': x.color},
                              ];
                              _set({'tags': rest.isEmpty ? null : rest});
                            }
                          : null,
                    ),
                ],
              ),
              if (writable) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('stachelCardNewTag'),
                        controller: _tag,
                        maxLength: tagMax,
                        decoration: const InputDecoration(hintText: 'Neuer Tag', counterText: ''),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => _addTag(),
                      ),
                    ),
                    TextButton(
                      key: const Key('stachelCardAddTag'),
                      onPressed: _tag.text.trim().isEmpty ? null : _addTag,
                      child: const Text('HINZUFÜGEN'),
                    ),
                  ],
                ),
                Wrap(
                  spacing: 10,
                  children: [
                    for (final c in tagColors)
                      InkWell(
                        key: Key('stachelCardTagColor-$c'),
                        customBorder: const CircleBorder(),
                        onTap: () => setState(() => _tagColor = c),
                        child: Container(
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                            color: _c(c),
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: _tagColor == c ? ui.theme.ink : const Color(0x22000000),
                              width: _tagColor == c ? 3 : 1,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
              _label('Farbe'),
              Wrap(
                spacing: 10,
                children: [
                  for (final c in cardColors)
                    InkWell(
                      key: Key('stachelCardColor-$c'),
                      onTap: writable ? () => _set({'color': c}) : null,
                      child: Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: _c(c),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(
                            color: color == c ? ui.theme.ink : const Color(0x22000000),
                            width: color == c ? 3 : 1,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  key: const Key('stachelCardDone'),
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('FERTIG'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `update` for one card field from the context bar (multi selection: every card), with heights.
void setCardField(BoardUi ui, String field, Object? value) {
  StructureState.of(ui.editor).patchCards([for (final o in ui.selected) o.id], {field: value});
}
