import 'package:flutter/material.dart';

import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

/// „Neues Board“ like the web's dialog (`features/tools/overview/overview.tsx` `NewBoardDialog`, audit A08/A09) as a
/// bottom sheet: choice „+ Leeres Board“ or one of the [templates] (with preview image), the name follows the chosen
/// template until it is typed by hand, at most 120 characters, empty = „Bitte gib einen Namen ein.“.
///
/// [onCreate] creates the board (template id null = empty board) and opens it; an error stays in the sheet.
Future<void> showStachelNewBoardSheet(
  BuildContext context, {
  required List<StachelBoardInfo> templates,
  StachelBoardInfo? initialTemplate,
  required ImageProvider? Function(StachelBoardInfo board) thumbnail,
  required Future<void> Function(String title, String? templateId) onCreate,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => StachelNewBoardSheet(
    templates: templates,
    initialTemplate: initialTemplate,
    thumbnail: thumbnail,
    onCreate: onCreate,
  ),
);

class StachelNewBoardSheet extends StatefulWidget {
  const StachelNewBoardSheet({
    super.key,
    required this.templates,
    this.initialTemplate,
    required this.thumbnail,
    required this.onCreate,
  });

  final List<StachelBoardInfo> templates;
  final StachelBoardInfo? initialTemplate;
  final ImageProvider? Function(StachelBoardInfo board) thumbnail;
  final Future<void> Function(String title, String? templateId) onCreate;

  @override
  State<StachelNewBoardSheet> createState() => _StachelNewBoardSheetState();
}

class _StachelNewBoardSheetState extends State<StachelNewBoardSheet> {
  late String? _template = widget.initialTemplate?.id;
  late final _name = TextEditingController(text: widget.initialTemplate?.title ?? 'Neues Board');
  bool _touched = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _name.selection = TextSelection(baseOffset: 0, extentOffset: _name.text.length);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _pick(String? id) {
    setState(() {
      _template = id;
      // the name follows the template as long as nobody typed one
      if (!_touched) {
        _name.text = id == null
            ? 'Neues Board'
            : widget.templates.where((t) => t.id == id).firstOrNull?.title ?? _name.text;
      }
    });
  }

  Future<void> _submit() async {
    final t = _name.text.trim();
    if (t.isEmpty) {
      setState(() => _error = 'Bitte gib einen Namen ein.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onCreate(t.length > 120 ? t.substring(0, 120) : t, _template);
    } on StachelException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final templates = widget.templates;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          key: const Key('stachelNewBoardSheet'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              widget.initialTemplate != null ? 'BOARD AUS VORLAGE' : 'NEUES BOARD',
              style: TextStyle(fontFamily: Sk.cond, fontSize: 20, fontWeight: FontWeight.w800),
            ),
            if (templates.isNotEmpty) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 112,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    _TemplateChoice(
                      key: const Key('stachelNewBlank'),
                      label: 'Leeres Board',
                      selected: _template == null,
                      onTap: () => _pick(null),
                      child: Center(
                        child: Text(
                          '+',
                          style: TextStyle(fontSize: 34, fontWeight: FontWeight.w700, color: Sk.grey),
                        ),
                      ),
                    ),
                    for (final t in templates)
                      _TemplateChoice(
                        key: Key('stachelNewTemplate-${t.id}'),
                        label: t.title,
                        selected: _template == t.id,
                        onTap: () => _pick(t.id),
                        child: _thumb(widget.thumbnail(t)),
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            TextField(
              key: const Key('stachelBoardTitle'),
              controller: _name,
              autofocus: true,
              maxLength: 120,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(labelText: 'Name'),
              onChanged: (_) => _touched = true,
              onSubmitted: (_) => _busy ? null : _submit(),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  key: const Key('stachelNewBoardError'),
                  style: TextStyle(color: Sk.danger),
                ),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('stachelNewBoardCreate'),
                  onPressed: _busy ? null : _submit,
                  child: Text(_busy ? 'LEGE AN …' : 'ANLEGEN'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static Widget _thumb(ImageProvider? img) {
    const blank = ColoredBox(color: Color(0xFFEDEBE4));
    if (img == null) return blank;
    return Image(image: img, fit: BoxFit.cover, errorBuilder: (_, _, _) => blank);
  }
}

class _TemplateChoice extends StatelessWidget {
  const _TemplateChoice({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    required this.child,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    label: label,
    child: GestureDetector(
      onTap: onTap,
      child: Container(
        width: 112,
        margin: const EdgeInsets.only(right: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  border: Border.all(color: selected ? Sk.pink : Sk.ink, width: selected ? 4 : 2),
                ),
                child: ClipRect(child: child),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: selected ? FontWeight.w800 : FontWeight.w500, fontSize: 13),
            ),
          ],
        ),
      ),
    ),
  );
}
