import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../geometry/shape_paths.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../web/web_constants.dart';
import 'catalog.dart';
import 'shape_state.dart';
import 'shape_widgets.dart';

// Popovers of the shape's context bar as sheets (web `shapeType.tsx` KindPop/FillPop/BorderPop, `stickyShape.tsx`
// ShapePop). Like the web, a swatch changes the selection and the sheet stays open (`patch`); „Form ändern“ and the
// note shape close it (`choose`). A new selection closes them (D44).

/// The 16 fills of shapes (web `SHAPE_PALETTE`).
List<String> get shapePalette => [for (final c in WebConstants.instance.maps('colors.shape')) c['hex'] as String];

/// Border widths (web `BORDER_WIDTHS`).
const borderWidths = [0.0, 1.0, 2.0, 4.0, 8.0];

/// The first selected object, live (rebuilds with the controller).
BoardObject? _first(BoardUi ui) => ui.editor.selected.firstOrNull;

Widget _live(BoardUi ui, Widget Function(BuildContext context, BoardObject first) build) => ListenableBuilder(
  listenable: ui.controller,
  builder: (context, _) {
    final f = _first(ui);
    return f == null ? const SizedBox.shrink() : build(context, f);
  },
);

// ---- „Form ändern“ (E05) -----------------------------------------------------------------------------------------------

Future<void> showKindSheet(BuildContext context, BoardUi ui) =>
    ui.openSheet<void>(context, (ctx) => _KindSheet(ui: ui), scrollControlled: true);

class _KindSheet extends StatefulWidget {
  const _KindSheet({required this.ui});
  final BoardUi ui;

  @override
  State<_KindSheet> createState() => _KindSheetState();
}

class _KindSheetState extends State<_KindSheet> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final ui = widget.ui;
    final list = searchKinds(q);
    final cur = _first(ui)?.shape ?? 'rect';
    return SafeArea(
      child: SizedBox(
        key: const Key('stachelKindSheet'),
        height: MediaQuery.sizeOf(context).height * 0.6,
        child: Column(
          children: [
            p2SheetTitle(ui, 'FORM ÄNDERN'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: TextField(
                key: const Key('stachelKindSearch'),
                decoration: const InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Form suchen',
                  border: OutlineInputBorder(),
                ),
                onChanged: (v) => setState(() => q = v),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: list.isEmpty
                  ? const Center(child: Text('Keine Form gefunden', key: Key('stachelKindEmpty')))
                  : GridView.extent(
                      maxCrossAxisExtent: 56,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      children: [
                        for (final (kind, label) in list)
                          Padding(
                            padding: const EdgeInsets.all(2),
                            child: P2FlyButton(
                              key: Key('stachelKind-$kind'),
                              label: label,
                              active: cur == kind,
                              onTap: () {
                                patchSelection(ui, (o) => o.type == 'shape' ? {'shape': kind} : null);
                                Navigator.of(context).pop();
                              },
                              child: ShapeKindIcon(kind, color: ui.theme.ink),
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---- Füllfarbe (E03) ---------------------------------------------------------------------------------------------------

Future<void> showFillSheet(BuildContext context, BoardUi ui) =>
    ui.openSheet<void>(context, (ctx) => _FillSheet(ui: ui), scrollControlled: true);

class _FillSheet extends StatelessWidget {
  const _FillSheet({required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: _live(ui, (context, first) {
      final current = first.color ?? '#ffffff';
      final alpha = first.fillOpacity;
      return Column(
        key: const Key('stachelFillSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          p2SheetTitle(ui, 'FÜLLFARBE'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Wrap(
              children: [
                for (final c in shapePalette)
                  P2Swatch(
                    key: Key('stachelFill-$c'),
                    color: c,
                    label: 'Füllfarbe ${colorNameOf(c)}',
                    active: c == current,
                    onTap: () => patchSelection(ui, (o) => {'color': c}),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
            child: Row(
              children: [
                CustomColorButton(
                  key: const Key('stachelFillCustom'),
                  label: 'Eigene Füllfarbe',
                  onTap: () async {
                    final hex = await pickCustomColor(context, ui, initial: current, title: 'Eigene Füllfarbe');
                    if (hex != null) patchSelection(ui, (o) => {'color': hex});
                  },
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  key: const Key('stachelFillNone'),
                  label: const Text('Ohne Füllung'),
                  selected: alpha == 0,
                  onSelected: (_) => patchSelection(ui, (o) => {'fillOpacity': 0}),
                ),
              ],
            ),
          ),
          OpacitySlider(ui: ui, value: alpha),
        ],
      );
    }),
  );
}

/// Opacity of the fill 0–100 % in steps of 5 (100 % = field removed); one drag = one undo step (web
/// `OpacitySlider`).
class OpacitySlider extends StatefulWidget {
  const OpacitySlider({super.key, required this.ui, required this.value});
  final BoardUi ui;
  final double value;

  @override
  State<OpacitySlider> createState() => _OpacitySliderState();
}

class _OpacitySliderState extends State<OpacitySlider> {
  String _key = '';
  double? _dragging;

  static Object? _field(double v) => v >= 1 ? null : v;

  @override
  Widget build(BuildContext context) {
    final pct = ((_dragging ?? widget.value) * 100).round();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          const Text('Deckkraft'),
          Expanded(
            child: Slider(
              key: const Key('stachelFillOpacity'),
              value: pct.toDouble(),
              max: 100,
              divisions: 20,
              label: '$pct %',
              onChangeStart: (v) => _key = 'opacity${BoardController.nextReq()}',
              onChanged: (v) {
                final a = v / 100;
                setState(() => _dragging = a);
                if (_key.isEmpty) _key = 'opacity${BoardController.nextReq()}';
                patchSelection(widget.ui, (o) => {'fillOpacity': _field(a)}, step: false, coalesce: _key);
              },
              onChangeEnd: (v) {
                final a = v / 100;
                patchSelection(widget.ui, (o) => {'fillOpacity': _field(a)}, coalesce: _key);
                setState(() {
                  _dragging = null;
                  _key = '';
                });
              },
            ),
          ),
          SizedBox(
            width: 48,
            child: Text('$pct %', key: const Key('stachelFillOpacityValue'), textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}

// ---- Rand (E04) ---------------------------------------------------------------------------------------------------------

Future<void> showBorderSheet(BuildContext context, BoardUi ui) =>
    ui.openSheet<void>(context, (ctx) => _BorderSheet(ui: ui), scrollControlled: true);

class _BorderSheet extends StatelessWidget {
  const _BorderSheet({required this.ui});
  final BoardUi ui;

  static const _dashes = [('solid', 'Durchgezogen'), ('dashed', 'Gestrichelt'), ('dotted', 'Gepunktet')];

  @override
  Widget build(BuildContext context) => SafeArea(
    child: _live(ui, (context, first) {
      final stroke = first.stroke ?? '#0a0a0a';
      final sw = first.strokeWidth ?? 2;
      final dash = first.dash == 'dashed' || first.dash == 'dotted' ? first.dash! : 'solid';
      return Column(
        key: const Key('stachelBorderSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          p2SheetTitle(ui, 'RAND'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Wrap(
              children: [
                for (final c in inkColors)
                  P2Swatch(
                    key: Key('stachelBorderColor-$c'),
                    color: c,
                    round: true,
                    label: 'Randfarbe ${colorNameOf(c)}',
                    active: stroke == c,
                    // a color while there is no border brings a 2 px border (web)
                    onTap: () => patchSelection(ui, (o) => sw == 0 ? {'stroke': c, 'strokeWidth': 2} : {'stroke': c}),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
            child: Wrap(
              spacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                CustomColorButton(
                  key: const Key('stachelBorderCustom'),
                  label: 'Eigene Randfarbe',
                  onTap: () async {
                    final hex = await pickCustomColor(context, ui, initial: stroke, title: 'Eigene Randfarbe');
                    if (hex != null) patchSelection(ui, (o) => {'stroke': hex});
                  },
                ),
                for (final w in borderWidths)
                  ChoiceChip(
                    key: Key('stachelBorderWidth-${w.round()}'),
                    label: Text(w == 0 ? 'Ohne' : '${w.round()}'),
                    tooltip: 'Randstärke ${w.round()}',
                    selected: sw == w,
                    onSelected: (_) => patchSelection(ui, (o) => {'strokeWidth': w}),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
            child: Row(
              children: [
                for (final (d, label) in _dashes)
                  P2FlyButton(
                    key: Key('stachelBorderDash-$d'),
                    label: label,
                    active: dash == d,
                    onTap: () => patchSelection(ui, (o) => {'dash': d == 'solid' ? null : d}),
                    child: _DashIcon(d, color: ui.theme.ink),
                  ),
              ],
            ),
          ),
        ],
      );
    }),
  );
}

class _DashIcon extends StatelessWidget {
  const _DashIcon(this.dash, {required this.color});
  final String dash;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 26,
    height: 20,
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: switch (dash) {
        'dashed' => [for (var i = 0; i < 3; i++) Container(width: 6, height: 2.5, color: color)],
        'dotted' => [
          for (var i = 0; i < 5; i++)
            Container(
              width: 3,
              height: 3,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
        ],
        _ => [Expanded(child: Container(height: 2.5, color: color))],
      },
    ),
  );
}

/// The border look of [o] as a small icon (web `BorderIcon`).
class BorderIcon extends StatelessWidget {
  const BorderIcon(this.o, {super.key, required this.ink});
  final BoardObject o;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    final sw = o.strokeWidth ?? 2;
    final stroke = o.stroke ?? '#0a0a0a';
    return Container(
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: sw <= 0 ? ink.withValues(alpha: 0.35) : (stroke == '#0a0a0a' ? ink : hexColorOf(stroke)),
          width: sw <= 0 ? 1.5 : 2.6,
        ),
      ),
    );
  }
}

Color hexColorOf(String c) => RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(c)
    ? Color(int.parse('FF${c.substring(1)}', radix: 16))
    : const Color(0xFF0A0A0A);

/// The fill dot of the context bar: color with its opacity on a checker hint (web `shapes-fill-dot`).
class FillDot extends StatelessWidget {
  const FillDot(this.o, {super.key, required this.ink});
  final BoardObject o;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    final a = isOpenShapeKind(o.shape) ? 0.0 : o.fillOpacity;
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: hexColorOf(o.color ?? '#ffffff').withValues(alpha: a),
        border: Border.all(color: ink, width: 2),
      ),
      child: a < 1 ? CustomPaint(painter: _Slash(ink)) : null,
    );
  }
}

class _Slash extends CustomPainter {
  _Slash(this.ink);
  final Color ink;

  @override
  void paint(Canvas canvas, Size size) => canvas.drawLine(
    Offset(size.width * 0.2, size.height * 0.8),
    Offset(size.width * 0.8, size.height * 0.2),
    Paint()
      ..color = ink.withValues(alpha: 0.5)
      ..strokeWidth = 1.5,
  );

  @override
  bool shouldRepaint(covariant _Slash old) => old.ink != ink;
}

// ---- Form der Notiz (E11) -----------------------------------------------------------------------------------------

/// Common shape of the selected notes (mixed → `free`).
String stickyShapeOfAll(List<BoardObject> sel) {
  final s = {for (final o in sel) stickyShapeOf(o)};
  return s.length == 1 ? s.single : 'free';
}

Future<void> showStickyShapeSheet(BuildContext context, BoardUi ui) => ui.openSheet<void>(
  context,
  (ctx) => SafeArea(
    child: Column(
      key: const Key('stachelNoteShapeSheet'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        p2SheetTitle(ui, 'FORM DER NOTIZ'),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Row(
            children: [
              for (final (shape, label) in const [('square', 'Quadrat'), ('rect', 'Rechteck')])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: P2FlyButton(
                    key: Key('stachelNoteShape-$shape'),
                    label: label,
                    active: stickyShapeOfAll(ui.editor.selected) == shape,
                    onTap: () {
                      // the next new note comes in the shape chosen last
                      P2Tools.of(ui.editor).stickyShape = shape;
                      patchSelection(ui, (o) => stickyShapePatch(o, shape));
                      Navigator.of(ctx).pop();
                    },
                    child: StickyShapeIcon(shape, color: ui.theme.ink),
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  ),
);
