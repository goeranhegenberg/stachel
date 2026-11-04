import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_state.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_images.dart';
import '../../render/board_painter.dart';
import '../../render/board_scene.dart';
import '../../render/object_renderers.dart';
import '../../render/text_layout.dart';
import '../cards/structure_state.dart';
import 'instance_templates.dart';
import 'own_templates.dart';
import 'template_model.dart';

// Template gallery and „Einfügen als …“ of package P3 (web `templates/gallery.tsx`, `paste.tsx`) as sheets: search,
// categories, previews drawn with the app's painter, „Enthält …“, „Einfügen“ → web action `structure.template` in the
// middle of the view (or the next free place, the server decides like the web); the camera then moves there or zooms out
// until the whole template is visible – never in (web `insertAtFreeSpot`).

/// Id of the gallery sheet (tool „Vorlagen“, board menu „Vorlage einfügen …“, long press „Vorlage einfügen …“).
const templatesSheet = 'structure.templates';

/// Id of the „Einfügen als …“ sheet (args: `text`, `x`, `y` = place in the world).
const pasteSheet = 'structure.paste';

class _NoImages extends ChangeNotifier implements BoardImages {
  @override
  ui.Image? image(String id, int tier) => null;

  @override
  bool missing(String id) => false;
}

/// Preview of a template: its objects drawn with the board painter, fitted into the box ([objects] = an own template,
/// else the gallery's template [id]).
class TemplatePreview extends StatefulWidget {
  const TemplatePreview({super.key, required this.id, this.objects, this.fonts = const BoardFonts()});
  final String id;
  final List<BoardObject>? objects;
  final BoardFonts fonts;

  @override
  State<TemplatePreview> createState() => _TemplatePreviewState();
}

class _TemplatePreviewState extends State<TemplatePreview> {
  /// Free space around the objects (screen px).
  static const _pad = 10.0;

  /// Screen height of a frame's title above the frame: the painter draws it in screen size (small title ≤ 14 · 1.6 +
  /// 3 px, the big one far out ≤ 18 px on its pill + 4 px), so the world bounds alone leave no room for it.
  static const _titleBand = 32.0;

  late BoardScene _scene;
  late RenderContext _ctx;
  Rect? _bounds;

  /// Top edge of the topmost frame (its title goes above it), null without frames.
  double? _frameTop;
  final _camera = ValueNotifier(Camera.identity);
  final _selection = ValueNotifier<Set<String>>(const {});
  final _images = _NoImages();

  @override
  void initState() {
    super.initState();
    final objs = widget.objects ?? templateObjects(widget.id);
    final state = BoardState()..applySnapshot(BoardSnapshot(objects: objs), rev: 0, epoch: 'preview');
    _scene = BoardScene(state)..sync();
    _ctx = RenderContext(scene: _scene, text: TextLayoutCache(maxEntries: 400), fonts: widget.fonts, images: _images);
    _bounds = _scene.bounds;
    for (final o in objs) {
      if (o.type == 'frame' && isVisibleObject(o)) _frameTop = math.min(_frameTop ?? o.y, o.y);
    }
  }

  /// Fits the objects into [size] (at most 4×); when the title of the topmost frame would be cut off at the top, again
  /// with room for it (the web's SVG preview has the title in its bounds, `previewBounds`). Unlike [Camera.fit] not
  /// held at the board's [minZoom]: a big template still fits into a small preview.
  Camera _fit(Rect b, Size size) {
    Camera fit(double top) {
      final w = math.max(1.0, size.width - 2 * _pad), h = math.max(1.0, size.height - top - _pad);
      final z = math.min(math.min(w / math.max(b.width, 1), h / math.max(b.height, 1)), 4.0);
      return Camera(_pad + w / 2 - b.center.dx * z, top + h / 2 - b.center.dy * z, z);
    }

    final cam = fit(_pad);
    final top = _frameTop;
    if (top == null || cam.toScreen(Offset(0, top)).dy >= _pad + _titleBand) return cam;
    return fit(_pad + _titleBand);
  }

  @override
  void dispose() {
    _camera.dispose();
    _selection.dispose();
    _images.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, c) {
      final b = _bounds;
      final size = Size(c.maxWidth, c.maxHeight);
      if (b != null && size.width > 0 && size.height > 0) {
        _camera.value = _fit(b, size);
      }
      return ClipRect(
        child: CustomPaint(
          key: Key('stachelTemplatePreview-${widget.id}'),
          size: size,
          painter: BoardPainter(ctx: _ctx, camera: _camera, selection: _selection, repaint: _images, showGrid: false),
        ),
      );
    },
  );
}

/// The gallery (web modal „Vorlagen“): search, categories, grid with previews; the chosen one with description,
/// „Enthält …“ and „Einfügen“.
class TemplateGallery extends StatefulWidget {
  const TemplateGallery({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<TemplateGallery> createState() => _TemplateGalleryState();
}

/// An entry of the gallery: a built-in template, one of the instance (key `pack:<id>`) or an own one (key
/// `own:<id>`).
class _Entry {
  _Entry.builtIn(BoardTemplate t)
    : key = t.id,
      name = t.name,
      desc = t.desc,
      category = t.category,
      template = t,
      own = null,
      pack = null;
  _Entry.pack(InstanceTemplate t, this.category)
    : key = 'pack:${t.id}',
      name = t.name,
      desc = t.desc,
      template = null,
      own = null,
      pack = t;
  _Entry.own(OwnTemplate t)
    : key = 'own:${t.id}',
      name = t.name,
      desc = 'Nur du siehst sie.',
      category = ownCategory,
      template = null,
      own = t,
      pack = null;
  final String key;
  final String name;
  final String desc;
  final String category;
  final BoardTemplate? template;
  final OwnTemplate? own;
  final InstanceTemplate? pack;

  /// Objects of an own template or one of the instance (inserted with `structure.insert`); null = built-in.
  List<Map<String, Object?>>? get raw => own?.raw ?? pack?.raw;
}

class _TemplateGalleryState extends State<TemplateGallery> {
  String? _cat;
  String _q = '';
  String? _sel;
  List<OwnTemplate> _own = const [];
  bool _ownLoaded = false;
  InstanceTemplates _pack = InstanceTemplates.empty;
  bool _busy = false;

  OwnTemplatesHost? get _host => widget.ui.host is OwnTemplatesHost ? widget.ui.host as OwnTemplatesHost : null;

  @override
  void initState() {
    super.initState();
    _loadOwn();
    _loadPack();
  }

  /// Templates of the instance (every opening, like the own ones); errors or an older server = none.
  Future<void> _loadPack() async {
    final host = widget.ui.host;
    if (host is! InstanceTemplatesHost) return;
    try {
      final p = InstanceTemplates.fromJson(await (host as InstanceTemplatesHost).instanceTemplates());
      if (mounted) setState(() => _pack = p);
    } catch (_) {}
  }

  /// Own templates from the server (every opening: ones saved on another device come along); errors = none.
  Future<void> _loadOwn() async {
    final host = _host;
    if (host == null) return;
    try {
      final list = await host.listOwnTemplates();
      if (!mounted) return;
      setState(() {
        _own = [for (final j in list) ?OwnTemplate.fromJson(j)];
        _ownLoaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => _ownLoaded = true);
    }
  }

  Future<void> _delete(_Entry e) async {
    final host = _host, own = e.own;
    if (host == null || own == null || _busy) return;
    setState(() => _busy = true);
    try {
      await host.deleteOwnTemplate(own.id);
      if (!mounted) return;
      setState(
        () => _own = [
          for (final t in _own)
            if (t.id != own.id) t,
        ],
      );
      widget.ui.host.showMessage('Vorlage „${own.name}“ gelöscht.');
    } catch (err) {
      widget.ui.host.showMessage(host.errorText(err));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ui = widget.ui;
    final hasOwn = _host != null;
    final packCat = _pack.category;
    final list = [
      if (_cat != ownCategory)
        for (final t in filterTemplates(_cat, _q)) _Entry.builtIn(t),
      if (packCat != null && (_cat == null || _cat == packCat))
        for (final t in _pack.list)
          if (instanceTemplateMatches(t, packCat, _q)) _Entry.pack(t, packCat),
      if (_cat == null || _cat == ownCategory)
        for (final t in _own)
          if (ownMatches(t, _q)) _Entry.own(t),
    ];
    final cur = list.where((t) => t.key == _sel).firstOrNull ?? list.firstOrNull;
    final none = _cat == ownCategory && _q.trim().isEmpty
        ? (_ownLoaded
              ? 'Noch keine eigenen Vorlagen. Wähle Objekte aus und tippe im Menü auf „Auswahl als Vorlage speichern …“.'
              : 'Lädt …')
        : 'Keine Vorlage gefunden.';
    final h = MediaQuery.sizeOf(context).height;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SizedBox(
          height: h * 0.88,
          child: Column(
            key: const Key('stachelTemplates'),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Row(
                  children: [
                    Text('VORLAGEN', style: ui.theme.label(size: 18)),
                    const Spacer(),
                    IconButton(
                      key: const Key('stachelTemplatesClose'),
                      tooltip: 'Schließen',
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  key: const Key('stachelTemplateSearch'),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Vorlage suchen',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _q = v),
                ),
              ),
              SizedBox(
                height: 48,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  children: [
                    for (final c in [
                      null,
                      ...templateCategories,
                      if (packCat != null && !templateCategories.contains(packCat) && packCat != ownCategory) packCat,
                      if (hasOwn) ownCategory,
                    ])
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ChoiceChip(
                          key: Key('stachelTemplateCat-${c ?? 'all'}'),
                          label: Text(c ?? 'Alle'),
                          selected: _cat == c,
                          onSelected: (_) => setState(() => _cat = c),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: list.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(none, key: const Key('stachelTemplatesNone'), textAlign: TextAlign.center),
                        ),
                      )
                    : GridView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 220,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          childAspectRatio: 1.05,
                        ),
                        itemCount: list.length,
                        itemBuilder: (context, i) {
                          final t = list[i];
                          final active = cur?.key == t.key;
                          return InkWell(
                            key: Key('stachelTemplate-${t.key}'),
                            onTap: () => setState(() => _sel = t.key),
                            onDoubleTap: () => _use(t),
                            child: Container(
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: active ? ui.theme.accent : const Color(0x22000000),
                                  width: active ? 3 : 1,
                                ),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              padding: const EdgeInsets.all(6),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: TemplatePreview(
                                      key: ValueKey(t.key),
                                      id: t.key,
                                      objects: t.own?.objects ?? t.pack?.objects,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    t.name,
                                    style: const TextStyle(fontWeight: FontWeight.w700),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  Text(
                                    t.category,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: t.category == 'Events' || t.template == null
                                          ? ui.theme.accent
                                          : ui.theme.grey,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
              ),
              if (cur != null)
                Material(
                  elevation: 6,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(cur.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                              Text(cur.desc, style: TextStyle(color: ui.theme.grey, fontSize: 13)),
                              Text(
                                'Enthält ${_contents(cur).join(' · ')}',
                                key: const Key('stachelTemplateContains'),
                                style: const TextStyle(fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        if (cur.own != null) ...[
                          const SizedBox(width: 8),
                          IconButton(
                            key: const Key('stachelTemplateDelete'),
                            tooltip: 'Vorlage löschen',
                            onPressed: _busy ? null : () => _delete(cur),
                            icon: const Icon(Icons.delete_outline),
                          ),
                        ],
                        const SizedBox(width: 12),
                        FilledButton(
                          key: const Key('stachelTemplateUse'),
                          onPressed:
                              ui.controller.canAct(cur.raw != null ? 'structure.insert' : 'structure.template') &&
                                  ui.editor.editable
                              ? () => _use(cur)
                              : null,
                          child: const Text('EINFÜGEN'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// „Enthält …“: built-in from the web constants, own ones and those of the instance counted from their objects.
  List<String> _contents(_Entry e) {
    final t = e.template;
    if (t != null) return templateContents(t);
    final counts = <String, int>{};
    for (final o in e.raw!) {
      final type = o['type'] as String;
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return templateContents(
      BoardTemplate(id: e.key, name: e.name, desc: e.desc, category: e.category, contains: counts),
    );
  }

  void _use(_Entry e) {
    Navigator.of(context).maybePop();
    final raw = e.raw;
    if (raw != null) {
      insertTemplateObjects(widget.ui, raw);
    } else {
      insertTemplate(widget.ui, e.key);
    }
  }
}

/// Inserts template [id] (web `insertTemplate`): in the middle of the view, or the next free place (server); the camera
/// moves there or zooms out until it is fully visible – never in.
Future<void> insertTemplate(BoardUi ui, String id) =>
    _insertAndShow(ui, 'structure.template', (x, y) => {'template': id, 'x': x, 'y': y});

/// Inserts an own template (web `insertAtFreeSpot` with its objects) through the web action `structure.insert`; the
/// objects travel as JSON text (rich text is nested deeper than `args` allow).
Future<void> insertOwnTemplate(BoardUi ui, OwnTemplate t) => insertTemplateObjects(ui, t.raw);

/// Inserts template objects in the clipboard format (own templates, templates of the instance) with `structure.insert`.
Future<void> insertTemplateObjects(BoardUi ui, List<Map<String, Object?>> raw) =>
    _insertAndShow(ui, 'structure.insert', (x, y) => {'json': jsonEncode(raw), 'x': x, 'y': y});

Future<void> _insertAndShow(BoardUi ui, String action, Map<String, Object?> Function(double x, double y) args) async {
  final st = StructureState.of(ui.editor);
  final size = st.viewSize;
  final cam = ui.editor.camera.value;
  final c = size == Size.zero ? Offset.zero : cam.toWorld(size.center(Offset.zero));
  final done = await ui.controller.act(
    action,
    args(c.dx.roundToDouble(), c.dy.roundToDouble()),
    label: 'Vorlage einfügen',
  );
  final data = done.result?.data;
  final r = data is Map ? data['rect'] : null;
  if (r is! Map || size == Size.zero) return;
  final rect = Rect.fromLTWH(
    (r['x'] as num).toDouble(),
    (r['y'] as num).toDouble(),
    (r['w'] as num).toDouble(),
    (r['h'] as num).toDouble(),
  );
  final now = ui.editor.camera.value;
  final z = now.z;
  final tl = now.toScreen(rect.topLeft);
  final visible =
      tl.dx >= 0 && tl.dy >= 0 && tl.dx + rect.width * z <= size.width && tl.dy + rect.height * z <= size.height;
  if (rect.width * z > size.width * 0.86 || rect.height * z > size.height * 0.8 || !visible) {
    ui.editor.camera.value = Camera.fit(rect, size, padding: const FitPadding.all(48), maxZoomFit: z);
  }
}

/// Asks „Einfügen als …“ for [text] at [world] when it is table data or several lines (web `PasteCatcher`); returns
/// false when there is nothing to ask (one line: the caller pastes a single note). For the clipboard package (P1).
Future<bool> showPasteAs(BuildContext context, BoardUi ui, String text, Offset world) async {
  if (pasteChoice(text) == null) return false;
  await ui.openRegisteredSheet(context, pasteSheet, args: {'text': text, 'x': world.dx, 'y': world.dy});
  return true;
}

/// The question „Einfügen als …“: Tabelle (table data only) · N Haftnotizen · Eine Haftnotiz.
class PasteAsSheet extends StatelessWidget {
  const PasteAsSheet({super.key, required this.ui, required this.text, required this.at});
  final BoardUi ui;
  final String text;
  final Offset at;

  @override
  Widget build(BuildContext context) {
    final choice = pasteChoice(text);
    if (choice == null) return const SizedBox.shrink();
    final table = choice.table;
    final n = pasteNotesCount(choice);
    void insert(String as) {
      Navigator.of(context).maybePop();
      ui.controller.act('structure.paste', {
        'text': text,
        'as': as,
        'x': at.dx.roundToDouble(),
        'y': at.dy.roundToDouble(),
        'color': ui.editor.stickyColor,
      }, label: 'Einfügen');
    }

    final ok = ui.controller.canAct('structure.paste') && ui.editor.editable;
    return SafeArea(
      child: Padding(
        key: const Key('stachelPasteAs'),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('EINFÜGEN ALS …', style: ui.theme.label(size: 16)),
            const SizedBox(height: 6),
            Text(
              table != null
                  ? 'Tabellendaten mit ${table.length} ${table.length == 1 ? 'Zeile' : 'Zeilen'} und ${table.first.length} Spalten.'
                  : 'Text mit ${choice.lines.length} Zeilen.',
            ),
            const SizedBox(height: 12),
            if (table != null)
              FilledButton(
                key: const Key('stachelPasteTable'),
                onPressed: ok ? () => insert('table') : null,
                child: const Text('TABELLE'),
              ),
            if (table != null)
              OutlinedButton(
                key: const Key('stachelPasteNotes'),
                onPressed: ok ? () => insert('notes') : null,
                child: Text('$n HAFTNOTIZEN'),
              )
            else
              FilledButton(
                key: const Key('stachelPasteNotes'),
                onPressed: ok ? () => insert('notes') : null,
                child: Text('$n HAFTNOTIZEN'),
              ),
            OutlinedButton(
              key: const Key('stachelPasteNote'),
              onPressed: ok ? () => insert('note') : null,
              child: const Text('EINE HAFTNOTIZ'),
            ),
          ],
        ),
      ),
    );
  }
}

/// „Auswahl als Vorlage speichern …“ (web `saveTemplate.tsx`): name (suggested from the selection), then the selection
/// with frame contents and connectors in between goes to the server as an own template (gallery „Meine Vorlagen“).
Future<void> saveSelectionAsTemplate(BuildContext context, BoardUi ui) async {
  final host = ui.host is OwnTemplatesHost ? ui.host as OwnTemplatesHost : null;
  if (host == null) return;
  final objects = templateFromSelection(ui.controller.state, ui.editor.selection.value);
  final problem = saveProblem(objects);
  if (problem != null) {
    ui.host.showMessage(problem);
    return;
  }
  final name = await showDialog<String>(
    context: context,
    builder: (ctx) => _SaveTemplateDialog(initial: suggestTemplateName(objects), count: objects.length),
  );
  if (name == null) return;
  try {
    await host.saveOwnTemplate(name, objects);
    ui.host.showMessage('Als Vorlage „$name“ gespeichert. Du findest sie unter Vorlagen → Meine Vorlagen.');
  } catch (e) {
    ui.host.showMessage(host.errorText(e));
  }
}

class _SaveTemplateDialog extends StatefulWidget {
  const _SaveTemplateDialog({required this.initial, required this.count});
  final String initial;
  final int count;

  @override
  State<_SaveTemplateDialog> createState() => _SaveTemplateDialogState();
}

class _SaveTemplateDialogState extends State<_SaveTemplateDialog> {
  late final _text = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _save() {
    final name = cleanTemplateName(_text.text);
    if (name != null) Navigator.of(context).pop(name);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    key: const Key('stachelSaveTemplateDialog'),
    title: const Text('Als Vorlage speichern'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          key: const Key('stachelSaveTemplateName'),
          controller: _text,
          autofocus: true,
          maxLength: maxOwnName,
          decoration: const InputDecoration(labelText: 'Name der Vorlage'),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _save(),
        ),
        Text(
          '${widget.count} ${widget.count == 1 ? 'Objekt' : 'Objekte'}. Nur du siehst die Vorlage, auf allen deinen Geräten.',
          style: const TextStyle(fontSize: 13),
        ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
      FilledButton(
        key: const Key('stachelSaveTemplateOk'),
        onPressed: cleanTemplateName(_text.text) == null ? null : _save,
        child: const Text('SPEICHERN'),
      ),
    ],
  );
}

/// Builds the gallery sheet (registry) – kept here so `register.dart` stays a list of entries.
Widget buildTemplatesSheet(BuildContext context, BoardUi ui, Map<String, Object?> args) => TemplateGallery(ui: ui);

Widget buildPasteSheet(BuildContext context, BoardUi ui, Map<String, Object?> args) => PasteAsSheet(
  ui: ui,
  text: args['text'] as String? ?? '',
  at: Offset((args['x'] as num?)?.toDouble() ?? 0, (args['y'] as num?)?.toDouble() ?? 0),
);

/// For tests: objects of a template as the gallery draws them.
List<BoardObject> previewObjects(String id) => templateObjects(id);
