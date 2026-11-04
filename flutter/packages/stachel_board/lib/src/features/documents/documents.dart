import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import 'doc_pages.dart';
import 'document_host.dart';

// The web module „documents“ for the app (`files.ts`, `actions.ts`): put PDFs on the board, page through them (for
// everyone, no undo step), render missing pages (whoever comes first), „Alle Seiten aufs Board legen“, download. What
// the web computes on the Yjs document runs on the server with the web's code (act `documents.*`); rendering and
// uploading the page images is done here, like the browser does with pdf.js.

/// Texts of the module (web `files.ts`, `actions.ts`, `viewer.tsx`).
class DocumentTexts {
  static String tooLarge(String name) => '„$name“ ist größer als 15 MB.';
  static String tooManyPages(String name, int n) => '„$name“ hat $n Seiten – übernommen werden die ersten $maxPages.';
  static const uploadFailed = 'Die PDF konnte nicht hochgeladen werden.';
  static const preparing = 'wird vorbereitet …';
  static String pagePreparing(int page) => 'Seite $page wird vorbereitet …';
  static String pagesPreparing(int done, int n) => 'Seiten werden vorbereitet ($done von $n) …';
  static const notAllPages = 'Nicht alle Seiten konnten vorbereitet werden.';
  static const expandFailed = 'Die Seiten konnten nicht aufs Board gelegt werden.';
  static const pageUnavailable = 'Diese Seite lässt sich gerade nicht anzeigen.';
  static const offline = 'PDFs lassen sich nur mit Verbindung einfügen.';
  static const viewer = 'Vollbild ansehen';
  static const download = 'PDF herunterladen';
  static const expand = 'Alle Seiten aufs Board legen';
  static const prev = 'Vorige Seite';
  static const next = 'Nächste Seite';
}

/// A PDF being put on the board: placeholder „Name wird vorbereitet …“ (only for me, like the web).
class DocUpload {
  const DocUpload({required this.key, required this.rect, required this.name});
  final String key;
  final Rect rect;
  final String name;

  DocUpload withRect(Rect r) => DocUpload(key: key, rect: r, name: name);
}

class _OpenPdf {
  _OpenPdf(this.pdf);
  final Future<PdfFile> pdf;
  Timer? timer;
  int users = 0;
}

/// PDF documents of one board screen (one per [BoardUi], see [of]).
class Documents {
  Documents._(this.ui);

  static final _all = Expando<Documents>('documents');

  /// The documents state of [ui].
  static Documents of(BoardUi ui) => _all[ui] ??= Documents._(ui);

  final BoardUi ui;

  /// Running PDF uploads (placeholders on the board, only here).
  final uploads = ValueNotifier<List<DocUpload>>(const []);

  BoardController get _c => ui.controller;
  DocumentHost? get host => documentHost(ui);

  BoardObject? doc(String id) {
    final o = _c.state[id];
    return isDoc(o) ? o : null;
  }

  void _toast(String text) => ui.hints.show(text);

  /// Paging is possible (rights, server knows the action).
  bool get canPage => ui.editor.editable && _c.canAct('documents.page');

  /// Missing pages can be rendered and stored here.
  bool get canFill => host != null && ui.editor.editable && _c.canAct('documents.addPage');

  /// „Alle Seiten aufs Board legen“ for [o].
  bool canExpand(BoardObject o) => canFill && !o.locked && _c.canAct('documents.expand');

  // ---- opened PDFs (kept a while, then released) ----------------------------------------------------------------

  final _open = <String, _OpenPdf>{};

  Future<T> _withPdf<T>(String fileId, Future<T> Function(PdfFile pdf) fn, {PdfFile? preset}) async {
    final h = host;
    if (h == null) throw const DocumentError(DocumentTexts.pageUnavailable);
    var e = _open[fileId];
    if (e == null) {
      final pdf = preset != null ? Future.value(preset) : h.fetchPdf(fileId).then(h.openPdf);
      final entry = _OpenPdf(pdf);
      e = entry;
      _open[fileId] = entry;
      pdf.then(
        (_) {},
        onError: (_) {
          if (identical(_open[fileId], entry)) _open.remove(fileId);
        },
      );
    }
    final entry = e;
    entry.timer?.cancel();
    entry.timer = null;
    entry.users++;
    try {
      return await fn(await entry.pdf);
    } finally {
      entry.users--;
      if (entry.users == 0) {
        entry.timer = Timer(keepPdfOpen, () => _release(fileId, entry));
      }
    }
  }

  void _release(String fileId, _OpenPdf entry) {
    if (!identical(_open[fileId], entry) || entry.users > 0) return;
    _open.remove(fileId);
    entry.timer?.cancel();
    entry.pdf.then((p) => p.dispose(), onError: (_) {});
  }

  /// Releases all opened PDFs that are not in use (the board screen goes away).
  void closeAll() {
    for (final e in [..._open.entries]) {
      e.value.timer?.cancel();
      if (e.value.users == 0) _release(e.key, e.value);
    }
  }

  // ---- pages ----------------------------------------------------------------------------------------------------

  final _inflight = <String, Future<String?>>{};

  Future<String> _renderAndUpload(PdfFile pdf, int page, String name) async {
    final pt = pdf.pageSize(page);
    final px = renderSize(pt.width, pt.height);
    final img = await pdf.render(page, px.width, px.height);
    final base = name.replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '');
    return host!.uploadPage(img, '$base-seite-${page + 1}');
  }

  /// Image of page [page] of document [id] (rendered and uploaded if it is missing, then entered with act
  /// `documents.addPage`; the first one entered wins). Null = document gone or not possible here.
  Future<String?> ensurePage(String id, int page) {
    final o = doc(id);
    final file = o?.raw['docFile'];
    if (o == null || file is! String || !canFill) return Future.value(null);
    final have = pageImage(o, page);
    if (have != null) return Future.value(have);
    final key = '$id:$page';
    final running = _inflight[key];
    if (running != null) return running;
    final name = o.docName ?? 'Dokument.pdf';
    final p =
        _withPdf(file, (pdf) async {
          // entered meanwhile (another client)?
          final now = doc(id);
          if (now == null) return null;
          final already = pageImage(now, page);
          if (already != null) return already;
          final imageId = await _renderAndUpload(pdf, page, name);
          return doc(id) == null ? null : _addPage(id, page, imageId);
        }).whenComplete(() {
          // (a block: `remove` returns this future, `whenComplete` would wait for itself)
          _inflight.remove(key);
        });
    _inflight[key] = p;
    return p;
  }

  Future<String?> _addPage(String id, int page, String imageId) async {
    final o = doc(id);
    if (o == null) return null;
    final pages = o.raw['docPages'];
    final preview = <String, Object?>{
      'docPages': {if (pages is Map) ...pages.cast<String, Object?>(), '$page': imageId},
      if (currentPage(o) == page) 'imageId': imageId,
    };
    final d = await _c.act(
      'documents.addPage',
      {'id': id, 'page': page, 'imageId': imageId},
      label: DocumentTexts.pagePreparing(page + 1),
      predicted: [
        UpdateOp({id: preview}),
      ],
    );
    if (!d.ok) return null;
    final data = d.result?.data;
    final valid = data is Map ? data['imageId'] : null;
    return valid is String ? valid : imageId;
  }

  /// Renders the missing pages of [id] one after another (the current one first); stops when the object is gone.
  Future<bool> fillMissing(String id, {void Function(int done, int total)? onProgress}) async {
    var total = 0;
    var done = 0;
    for (;;) {
      final o = doc(id);
      if (o == null) return false;
      final missing = missingPages(o);
      total = math.max(total, done + missing.length);
      onProgress?.call(done, total);
      if (missing.isEmpty) return true;
      if (await ensurePage(id, missing.first) == null) return false;
      done++;
      await Future<void>.delayed(Duration.zero);
    }
  }

  /// Page [page] (for everyone, act `documents.page`, no undo step); its image is rendered if it is missing.
  void goToPage(String id, int page) {
    final o = doc(id);
    if (o == null || !canPage) return;
    final p = currentPage(o, page);
    if (p == currentPage(o) && o.raw['docPage'] == p) return;
    final img = pageImage(o, p);
    unawaited(
      _c.act(
        'documents.page',
        {'id': id, 'page': p},
        label: 'Seite ${p + 1}',
        predicted: [
          UpdateOp({
            id: {'docPage': p, 'imageId': img},
          }),
        ],
      ),
    );
    if (img == null) unawaited(ensurePage(id, p).catchError((Object _) => null));
  }

  /// One page on (or back).
  void stepPage(String id, int d) {
    final o = doc(id);
    if (o != null) goToPage(id, currentPage(o) + d);
  }

  /// `imageId` does not match the current page (paging and filling crossed) → act `documents.repair`.
  final _repairing = <String>{};
  void repairMirror(BoardObject o) {
    final img = pageImage(o, currentPage(o));
    if (img == null || o.imageId == img || !ui.editor.editable || !_c.canAct('documents.repair')) return;
    final key = '${o.id}:$img';
    if (!_repairing.add(key)) return;
    unawaited(_c.act('documents.repair', {'id': o.id}).whenComplete(() => _repairing.remove(key)));
  }

  // ---- „Alle Seiten aufs Board legen“ ----------------------------------------------------------------------------

  final _expanding = <String>{};

  /// Is „Alle Seiten aufs Board“ running for [id]?
  bool expanding(String id) => _expanding.contains(id);

  /// All pages as images to the right of the document (web `expandPages`): missing pages first, then act
  /// `documents.expand` (one undo step; selects them, moves the camera, hint).
  Future<void> expand(String id) async {
    final o = doc(id);
    if (o == null || !canExpand(o) || !_expanding.add(id)) return;
    try {
      final n = pageCount(o);
      final missing = missingPages(o).length;
      if (missing > 0) {
        _toast(DocumentTexts.pagesPreparing(n - missing, n));
        if (!await fillMissing(id)) {
          if (doc(id) != null) _toast(DocumentTexts.notAllPages);
          return;
        }
      }
      if (doc(id) == null) return;
      final d = await _c.act('documents.expand', {'id': id}, label: DocumentTexts.expand);
      if (!d.ok) {
        _toast(d.message ?? DocumentTexts.expandFailed);
      } else if (d.result?.skipped == true && d.result?.data is Map) {
        _toast(DocumentTexts.notAllPages);
      }
    } catch (e) {
      _toast(e is DocumentError || e is PdfOpenError ? '$e' : DocumentTexts.expandFailed);
    } finally {
      _expanding.remove(id);
    }
  }

  // ---- download -------------------------------------------------------------------------------------------------

  /// „PDF herunterladen“: the original with its name (system share sheet / „Öffnen mit“ in the app).
  Future<void> download(BoardObject o) async {
    final file = o.raw['docFile'];
    final h = host;
    if (file is! String || h == null) return;
    try {
      await h.savePdf(file, o.docName ?? 'Dokument.pdf');
    } catch (e) {
      _toast(e is DocumentError ? e.message : 'Die PDF konnte nicht geladen werden.');
    }
  }

  // ---- upload ---------------------------------------------------------------------------------------------------

  var _uploadSeq = 0;

  /// The middle of the view (world).
  Offset viewCenter() {
    final size = ui.editor.viewSize;
    return ui.editor.camera.value.toWorld((size == Size.zero ? const Size(400, 600) : size).center(Offset.zero));
  }

  /// Opens the file picker and puts the chosen PDFs on the board.
  Future<void> pickAndAdd() async {
    final h = host;
    if (h == null) return;
    final List<PdfInput> files;
    try {
      files = await h.pickPdfs();
    } catch (_) {
      _toast('Die Dateiauswahl ließ sich nicht öffnen.');
      return;
    }
    if (files.isNotEmpty) await addPdfs(files);
  }

  /// Puts PDFs on the board (file picker, share target): web `addPdfs` – check, upload the original, render page 1,
  /// create the document (one undo step) in a 640 box around [at] (default: middle of the view), further PDFs 32
  /// apart, the other pages in the background; afterwards the new documents are selected.
  Future<List<String>> addPdfs(List<PdfInput> files, {Offset? at}) async {
    final h = host;
    if (h == null || files.isEmpty) return const [];
    if (!ui.editor.editable) {
      _toast(DocumentTexts.offline);
      return const [];
    }
    final c = at ?? viewCenter();
    final ids = <String>[];
    var offset = 0.0;
    for (final f in files) {
      final name = cleanName(f.name.isEmpty ? 'Dokument.pdf' : f.name);
      if (f.bytes.length > maxPdfBytes) {
        _toast(DocumentTexts.tooLarge(name));
        continue;
      }
      final key = 'pdf-${++_uploadSeq}';
      Rect around(Size s) => Rect.fromLTWH(
        docRound(c.dx - s.width / 2 + offset),
        docRound(c.dy - s.height / 2 + offset),
        s.width,
        s.height,
      );
      uploads.value = [...uploads.value, DocUpload(key: key, rect: around(docSize(595 / 842)), name: name)];
      try {
        // open first (checks password/format on the device), then upload the original
        final pdf = await h.openPdf(f.bytes);
        final String fileId;
        try {
          fileId = await h.uploadPdf(f.bytes, name);
        } catch (_) {
          pdf.dispose();
          rethrow;
        }
        final id = await _withPdf(fileId, preset: pdf, (doc) async {
          final n = math.min(doc.pageCount, maxPages);
          if (doc.pageCount > maxPages) _toast(DocumentTexts.tooManyPages(name, doc.pageCount));
          final ratios = [for (var i = 0; i < n; i++) ratioOf(doc.pageSize(i).width, doc.pageSize(i).height)];
          final size = docSize(ratios.isEmpty ? 595 / 842 : ratios.first);
          final rect = around(size);
          uploads.value = [for (final u in uploads.value) u.key == key ? u.withRect(rect) : u];
          final first = await _renderAndUpload(doc, 0, name);
          final oid = BoardController.newId();
          _c.apply([
            CreateOp([
              {
                'id': oid,
                'type': docType,
                'x': rect.left,
                'y': rect.top,
                'w': rect.width,
                'h': rect.height,
                'docFile': fileId,
                'docName': name,
                'docCount': n,
                'docPage': 0,
                'docPages': {'0': first},
                'docRatios': ratios,
                'imageId': first,
              },
            ]),
          ]);
          return oid;
        });
        ids.add(id);
        offset += 32;
        // the other pages in the background
        final o = doc(id);
        if (o != null && pageCount(o) > 1) unawaited(fillMissing(id).catchError((Object _) => false));
      } catch (e) {
        _toast(switch (e) {
          PdfOpenError() => e.message,
          DocumentError() => e.message,
          _ => DocumentTexts.uploadFailed,
        });
      } finally {
        uploads.value = [
          for (final u in uploads.value)
            if (u.key != key) u,
        ];
      }
    }
    if (ids.isNotEmpty) ui.editor.select(ids.toSet());
    return ids;
  }
}

/// „Einfügen“ of files (D24, web: Strg V with a copied image or PDF goes to the file handlers before text): PDFs
/// from the clipboard become documents, an image goes through the app's image pipeline – both at [at]. False = no
/// files there (the caller pastes text/objects as before). Wired to P1's `pasteFiles` in `_wirePackages()`.
Future<bool> pasteClipboardFiles(BoardUi ui, Offset at) async {
  final h = documentHost(ui);
  if (h == null || !ui.editor.editable) return false;
  final ClipboardFiles c;
  try {
    c = await h.readClipboardFiles();
  } catch (_) {
    return false;
  }
  if (c.pdfs.isNotEmpty) {
    await Documents.of(ui).addPdfs(c.pdfs, at: at);
    return true;
  }
  final img = c.image;
  if (img == null) return false;
  await h.addImage(img, at);
  return true;
}
