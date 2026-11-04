import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import 'doc_pages.dart';
import 'documents.dart';

// Full-screen view of a document (web `viewer.tsx`): only for me, the page at the object does not change. Swipe or
// ‹ › to page, pinch to zoom, neighbour pages preloaded, name, „n / N“, download, „Diese Seite lässt sich gerade
// nicht anzeigen.“; closes when the document is deleted (also by others). Missing pages are rendered (then for
// everyone on the board, like the web).

const _green = Color(0xFF2FE38C);

/// Opens the viewer for document [id].
Future<void> openDocumentViewer(BuildContext context, BoardUi ui, String id) {
  final o = Documents.of(ui).doc(id);
  if (o == null) return Future.value();
  return Navigator.of(context).push(
    PageRouteBuilder<void>(
      opaque: false,
      barrierColor: const Color(0xF50A0A0A),
      pageBuilder: (_, _, _) => DocumentViewer(ui: ui, id: id),
      transitionsBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
    ),
  );
}

class DocumentViewer extends StatefulWidget {
  const DocumentViewer({super.key, required this.ui, required this.id});
  final BoardUi ui;
  final String id;

  @override
  State<DocumentViewer> createState() => _DocumentViewerState();
}

class _DocumentViewerState extends State<DocumentViewer> {
  Documents get docs => Documents.of(widget.ui);
  late final PageController _pages;
  late int _page;
  bool _closed = false;
  bool _zoomed = false;

  /// Loaded page images (image ID → bytes), the shown one and its neighbours.
  final _bytes = <String, Uint8List>{};
  final _loading = <String>{};
  final _failedPages = <int>{};

  @override
  void initState() {
    super.initState();
    final o = docs.doc(widget.id);
    _page = o == null ? 0 : currentPage(o);
    _pages = PageController(initialPage: _page);
    widget.ui.controller.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) => _prepare());
  }

  @override
  void dispose() {
    widget.ui.controller.removeListener(_changed);
    _pages.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted || _closed) return;
    if (docs.doc(widget.id) == null) {
      _closed = true;
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {});
    _prepare();
  }

  /// Missing page → render it; neighbours → preload.
  void _prepare() {
    final o = docs.doc(widget.id);
    if (o == null || !mounted) return;
    final n = pageCount(o);
    final p = _page.clamp(0, n - 1);
    final img = pageImage(o, p);
    if (img == null) {
      if (_failedPages.contains(p)) return;
      if (!docs.canFill) {
        setState(() => _failedPages.add(p));
        return;
      }
      docs
          .ensurePage(widget.id, p)
          .then(
            (r) {
              if (r == null && mounted) setState(() => _failedPages.add(p));
            },
            onError: (Object _) {
              if (mounted) setState(() => _failedPages.add(p));
            },
          );
      return;
    }
    for (final q in [p, p + 1, p - 1]) {
      final id = q >= 0 && q < n ? pageImage(o, q) : null;
      if (id != null) _load(id, q);
    }
  }

  void _load(String imageId, int page) {
    final h = docs.host;
    if (h == null || _bytes.containsKey(imageId) || !_loading.add(imageId)) return;
    h
        .pageImageBytes(imageId)
        .then(
          (b) {
            _loading.remove(imageId);
            if (!mounted) return;
            setState(() {
              _bytes[imageId] = b;
              _failedPages.remove(page);
              // keep a few pages only
              if (_bytes.length > 6) _bytes.remove(_bytes.keys.first);
            });
          },
          onError: (Object _) {
            _loading.remove(imageId);
            if (mounted) setState(() => _failedPages.add(page));
          },
        );
  }

  void _go(int p) {
    final o = docs.doc(widget.id);
    if (o == null) return;
    final to = p.clamp(0, pageCount(o) - 1);
    if (to == _page) return;
    _pages.animateToPage(to, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final o = docs.doc(widget.id);
    if (o == null) return const SizedBox.shrink();
    final n = pageCount(o);
    final p = _page.clamp(0, n - 1);
    final name = o.docName ?? 'PDF';
    final white = Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.white);
    final cond = widget.ui.theme.condensedFont;
    return Material(
      type: MaterialType.transparency,
      child: Semantics(
        scopesRoute: true,
        namesRoute: true,
        explicitChildNodes: true,
        label: '$name – Vollbild',
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 10, 12, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: cond,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 18 * 0.04,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: const BoxDecoration(
                        color: _green,
                        borderRadius: BorderRadius.all(Radius.circular(999)),
                      ),
                      child: Text(
                        pageLabel(p, n),
                        key: const Key('stachelDocViewerPage'),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: Color(0xFF161118),
                          fontFeatures: [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (docs.host != null)
                      IconButton(
                        key: const Key('stachelDocViewerDownload'),
                        tooltip: DocumentTexts.download,
                        color: Colors.white,
                        icon: const Icon(Icons.download_outlined),
                        onPressed: () => docs.download(o),
                      ),
                    IconButton(
                      key: const Key('stachelDocViewerClose'),
                      tooltip: 'Schließen',
                      color: Colors.white,
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: PageView.builder(
                  key: const Key('stachelDocViewerPages'),
                  controller: _pages,
                  physics: _zoomed ? const NeverScrollableScrollPhysics() : const PageScrollPhysics(),
                  itemCount: n,
                  onPageChanged: (i) {
                    setState(() {
                      _page = i;
                      _zoomed = false;
                    });
                    _prepare();
                  },
                  itemBuilder: (context, i) => _pageView(o.id, i, n, white),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _NavButton(
                      key: const Key('stachelDocViewerPrev'),
                      icon: Icons.chevron_left,
                      label: DocumentTexts.prev,
                      onTap: p > 0 ? () => _go(p - 1) : null,
                    ),
                    _NavButton(
                      key: const Key('stachelDocViewerNext'),
                      icon: Icons.chevron_right,
                      label: DocumentTexts.next,
                      onTap: p < n - 1 ? () => _go(p + 1) : null,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pageView(String id, int i, int n, TextStyle? white) {
    final o = docs.doc(id);
    final img = o == null ? null : pageImage(o, i);
    final bytes = img == null ? null : _bytes[img];
    if (bytes == null) {
      final failed = _failedPages.contains(i);
      return Center(
        child: Text(
          failed ? DocumentTexts.pageUnavailable : DocumentTexts.pagePreparing(i + 1),
          key: Key('stachelDocViewerWait-$i'),
          style: white?.copyWith(fontSize: 16, fontWeight: FontWeight.w600, color: const Color(0xFFB9B4BD)),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: _ZoomablePage(
        bytes: bytes,
        label: '${o?.docName ?? 'PDF'}, Seite ${i + 1} von $n',
        onZoom: (z) {
          if (z != _zoomed && mounted) setState(() => _zoomed = z);
        },
      ),
    );
  }
}

class _ZoomablePage extends StatefulWidget {
  const _ZoomablePage({required this.bytes, required this.label, required this.onZoom});
  final Uint8List bytes;
  final String label;
  final void Function(bool zoomed) onZoom;

  @override
  State<_ZoomablePage> createState() => _ZoomablePageState();
}

class _ZoomablePageState extends State<_ZoomablePage> {
  final _t = TransformationController();

  @override
  void initState() {
    super.initState();
    _t.addListener(() => widget.onZoom(_t.value.getMaxScaleOnAxis() > 1.01));
  }

  @override
  void dispose() {
    _t.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => InteractiveViewer(
    transformationController: _t,
    maxScale: 5,
    child: Center(
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: Colors.white,
          boxShadow: [BoxShadow(color: Color(0xB3000000), blurRadius: 40, offset: Offset(0, 12), spreadRadius: -12)],
        ),
        child: Image.memory(widget.bytes, semanticLabel: widget.label, gaplessPlayback: true, fit: BoxFit.contain),
      ),
    ),
  );
}

class _NavButton extends StatelessWidget {
  const _NavButton({super.key, required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: label,
    child: Material(
      color: Colors.white.withValues(alpha: 0.08),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 52,
          height: 52,
          child: Icon(icon, size: 30, color: Colors.white.withValues(alpha: onTap == null ? 0.25 : 1)),
        ),
      ),
    ),
  );
}
