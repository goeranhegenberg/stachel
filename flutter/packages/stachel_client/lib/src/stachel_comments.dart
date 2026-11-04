import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_board_widgets.dart';
import 'stachel_style.dart';

/// Comments on a native board (E3, like the web's collab module): read, write with @mentions, reply, edit/delete own
/// messages, done/open again; the list of all threads with filter. Everything goes out through the [BoardEditor] as
/// ops (optimistic, contract §8.6).

/// „heute, 14:32“ for an ISO time ('' if unreadable).
String commentWhen(String iso) {
  final t = DateTime.tryParse(iso);
  return t == null ? '' : stachelWhen(t.toLocal());
}

/// Text field with @mention suggestions above it (people from `GET /api/users`, those on the board, authors).
class MentionField extends StatefulWidget {
  const MentionField({
    super.key,
    required this.controller,
    required this.people,
    required this.onSend,
    this.hint = 'Kommentar schreiben … (@ erwähnt jemanden)',
    this.sendLabel = 'SENDEN',
    this.autofocus = true,
    this.fieldKey,
  });

  final TextEditingController controller;
  final List<Person> people;
  final VoidCallback onSend;
  final String hint;
  final String sendLabel;
  final bool autofocus;
  final Key? fieldKey;

  @override
  State<MentionField> createState() => _MentionFieldState();
}

class _MentionFieldState extends State<MentionField> {
  List<Person> _suggest = const [];
  ({int start, String query})? _open;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    final c = widget.controller;
    final caret = c.selection.isValid ? c.selection.extentOffset : c.text.length;
    final q = mentionQuery(c.text, caret);
    final next = q == null || mentionDone(q.query, widget.people)
        ? const <Person>[]
        : matchPeople(widget.people, q.query);
    if (!mounted) return;
    setState(() {
      _open = q;
      _suggest = next;
    });
  }

  void _pick(Person p) {
    final q = _open;
    if (q == null) return;
    final c = widget.controller;
    final caret = c.selection.isValid ? c.selection.extentOffset : c.text.length;
    final r = insertMention(c.text, q.start, caret, p.name);
    c.value = TextEditingValue(
      text: r.text,
      selection: TextSelection.collapsed(offset: r.caret),
    );
  }

  @override
  Widget build(BuildContext context) {
    final empty = widget.controller.text.trim().isEmpty;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_suggest.isNotEmpty)
          Material(
            key: const Key('stachelMentionSuggestions'),
            color: Sk.surface,
            shape: Border.all(color: Sk.ink, width: 1.5),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 180),
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                children: [
                  for (final p in _suggest)
                    ListTile(
                      key: Key('stachelMention-${p.key}'),
                      dense: true,
                      leading: CircleAvatar(
                        radius: 14,
                        backgroundColor: Sk.blue,
                        child: Text(peerInitials(p.name), style: const TextStyle(fontSize: 11, color: Colors.white)),
                      ),
                      title: Text(p.name),
                      onTap: () => _pick(p),
                    ),
                ],
              ),
            ),
          ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                key: widget.fieldKey ?? const Key('stachelCommentField'),
                controller: widget.controller,
                autofocus: widget.autofocus,
                minLines: 1,
                maxLines: 5,
                maxLength: 5000,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(hintText: widget.hint, counterText: '', isDense: true),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              key: const Key('stachelCommentSend'),
              onPressed: empty ? null : widget.onSend,
              child: Text(widget.sendLabel),
            ),
          ],
        ),
      ],
    );
  }
}

/// A message text with mentions highlighted (pink when it is me).
class MentionText extends StatelessWidget {
  const MentionText(this.text, {super.key, required this.people, required this.me});
  final String text;
  final List<Person> people;
  final String me;

  @override
  Widget build(BuildContext context) {
    final parts = splitMentions(text, people);
    return Text.rich(
      TextSpan(
        children: [
          for (final p in parts)
            TextSpan(
              text: p.text,
              style: p.key == null
                  ? null
                  : TextStyle(fontWeight: FontWeight.w700, color: p.key == me ? Sk.pinkDark : Sk.blue),
            ),
        ],
      ),
      style: const TextStyle(fontSize: 15, height: 1.3),
    );
  }
}

/// First message of a new thread at [at] ([initial]: text already in the field); returns the thread ID (null =
/// cancelled).
Future<String?> newStachelComment(
  BuildContext context,
  BoardEditor editor,
  CommentAnchor at,
  List<Person> people, {
  String initial = '',
}) async {
  final c = TextEditingController(text: initial);
  final text = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(ctx).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            at.objectId == null ? 'KOMMENTAR AUF DEM BOARD' : 'KOMMENTAR ZUM OBJEKT',
            style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w700, fontSize: 16),
          ),
          const SizedBox(height: 8),
          MentionField(controller: c, people: people, onSend: () => Navigator.of(ctx).pop(c.text)),
        ],
      ),
    ),
  );
  // the sheet still slides out with the field: the controller is left to the GC
  if (text == null || text.trim().isEmpty) return null;
  return editor.addComment(at, text, people);
}

/// A reply that was being written when someone else deleted the thread (web `rescueDraft`): where the thread was and
/// the text – the board opens it as a new comment there.
typedef StachelCommentRescue = ({CommentAnchor at, String draft});

/// One thread as a sheet (live: changes of others show up): messages, reply, done/open, own messages editable.
/// Returns a [StachelCommentRescue] when someone else deleted the thread while a reply was being written.
Future<StachelCommentRescue?> showStachelThread(
  BuildContext context, {
  required BoardEditor editor,
  required String threadId,
  required List<Person> people,
  VoidCallback? onShowObject,
  void Function(CommentThread thread, CommentMessage message)? onReport,
}) => showModalBottomSheet<StachelCommentRescue>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (ctx) =>
      _ThreadSheet(editor: editor, threadId: threadId, people: people, onShowObject: onShowObject, onReport: onReport),
);

class _ThreadSheet extends StatefulWidget {
  const _ThreadSheet({
    required this.editor,
    required this.threadId,
    required this.people,
    this.onShowObject,
    this.onReport,
  });
  final BoardEditor editor;
  final String threadId;
  final List<Person> people;
  final VoidCallback? onShowObject;

  /// „Melden …“ an fremden Nachrichten (Moderation); null = kein Menü.
  final void Function(CommentThread thread, CommentMessage message)? onReport;

  @override
  State<_ThreadSheet> createState() => _ThreadSheetState();
}

class _ThreadSheetState extends State<_ThreadSheet> {
  final _reply = TextEditingController();
  String? _editing;

  /// The thread as last seen (for the rescue when it disappears) and whether we deleted it ourselves.
  CommentThread? _last;
  bool _deletedHere = false;
  bool _rescued = false;

  BoardController get _c => widget.editor.controller;

  @override
  void initState() {
    super.initState();
    _c.addListener(_changed);
    // reading the thread = mentions read (the web's „Du wurdest erwähnt“ goes away)
    WidgetsBinding.instance.addPostFrameCallback((_) => widget.editor.markMentionsRead());
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _c.removeListener(_changed);
    _reply.dispose();
    super.dispose();
  }

  void _send(CommentThread t) {
    final text = _reply.text;
    final e = _editing;
    if (e != null) {
      widget.editor.editComment(t.id, e, text, widget.people);
    } else {
      widget.editor.replyComment(t.id, text, widget.people);
    }
    _reply.clear();
    setState(() => _editing = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.editor.threads.where((x) => x.id == widget.threadId).firstOrNull;
    final me = _c.user?.key ?? '';
    final canWrite = widget.editor.commentable; // also the role `comment`
    if (t != null) _last = t;
    final last = _last;
    if (t == null && !_deletedHere && !_rescued && last != null && _reply.text.trim().isNotEmpty) {
      // deleted by someone else while writing a reply: keep the draft as a new comment at the same place (web)
      _rescued = true;
      final alive = last.objectId != null && _c.state[last.objectId!] != null;
      final pos = last.position((i) => _c.state[i]);
      final at = CommentAnchor(
        pos.dx.roundToDouble(),
        pos.dy.roundToDouble(),
        objectId: alive ? last.objectId : null,
        dx: alive ? last.dx : 0,
        dy: alive ? last.dy : 0,
      );
      final draft = _reply.text;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop((at: at, draft: draft));
      });
    }
    if (t == null) {
      return const SafeArea(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('Dieser Kommentar wurde gelöscht.', key: Key('stachelThreadGone')),
        ),
      );
    }
    final object = t.objectId == null ? null : _c.state[t.objectId!];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: Column(
          key: const Key('stachelThread'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 4, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      t.resolved ? 'ERLEDIGT' : (object == null ? 'KOMMENTAR' : 'KOMMENTAR ZUM OBJEKT'),
                      style: TextStyle(
                        fontFamily: Sk.cond,
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                        color: t.resolved ? Sk.grey : Sk.ink,
                      ),
                    ),
                  ),
                  if (widget.onShowObject != null)
                    IconButton(
                      key: const Key('stachelThreadShow'),
                      tooltip: 'Auf dem Board zeigen',
                      icon: const Icon(Icons.center_focus_strong_outlined),
                      onPressed: () {
                        Navigator.of(context).pop();
                        widget.onShowObject!();
                      },
                    ),
                  if (canWrite)
                    TextButton.icon(
                      key: const Key('stachelThreadResolve'),
                      onPressed: () => widget.editor.resolveComment(t.id, resolved: !t.resolved),
                      icon: Icon(t.resolved ? Icons.replay : Icons.check),
                      label: Text(t.resolved ? 'WIEDER ÖFFNEN' : 'ERLEDIGT'),
                    ),
                ],
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  for (final (i, m) in t.messages.indexed)
                    Padding(
                      key: Key('stachelMsg-${m.id}'),
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 15,
                            backgroundColor: m.by == me ? Sk.pink : Sk.blue,
                            child: Text(
                              peerInitials(m.name),
                              style: const TextStyle(fontSize: 11, color: Colors.white),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${m.by == me ? 'Du' : m.name} · ${commentWhen(m.at)}${m.edited != null ? ' · bearbeitet' : ''}',
                                  style: TextStyle(fontSize: 12, color: Sk.grey),
                                ),
                                MentionText(m.text, people: widget.people, me: me),
                              ],
                            ),
                          ),
                          if (canWrite && m.by == me)
                            PopupMenuButton<String>(
                              key: Key('stachelMsgMenu-${m.id}'),
                              onSelected: (v) {
                                if (v == 'edit') {
                                  _reply.text = m.text;
                                  setState(() => _editing = m.id);
                                } else {
                                  if (i == 0) _deletedHere = true;
                                  widget.editor.deleteComment(t.id, m.id);
                                  if (i == 0) Navigator.of(context).pop();
                                }
                              },
                              itemBuilder: (_) => [
                                const PopupMenuItem(value: 'edit', child: Text('Bearbeiten')),
                                PopupMenuItem(value: 'delete', child: Text(i == 0 ? 'Kommentar löschen' : 'Löschen')),
                              ],
                            )
                          else if (m.by != me && widget.onReport != null)
                            PopupMenuButton<String>(
                              key: Key('stachelMsgMenu-${m.id}'),
                              onSelected: (_) {
                                // the sheet closes first; the report sheet opens on the board screen
                                Navigator.of(context).pop();
                                widget.onReport!(t, m);
                              },
                              itemBuilder: (_) => const [
                                PopupMenuItem(key: Key('stachelMsgReport'), value: 'report', child: Text('Melden …')),
                              ],
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            if (canWrite)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_editing != null)
                      Row(
                        children: [
                          Expanded(
                            child: Text('Nachricht bearbeiten', style: TextStyle(color: Sk.grey)),
                          ),
                          TextButton(
                            onPressed: () {
                              _reply.clear();
                              setState(() => _editing = null);
                            },
                            child: const Text('ABBRECHEN'),
                          ),
                        ],
                      ),
                    MentionField(
                      controller: _reply,
                      people: widget.people,
                      autofocus: false,
                      hint: t.resolved ? 'Antworten öffnet den Kommentar wieder' : 'Antworten … (@ erwähnt jemanden)',
                      sendLabel: _editing != null ? 'SPEICHERN' : 'SENDEN',
                      onSend: () => _send(t),
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

/// Where a thread sits, like the web's `objectLabel`: „Haftnotiz „Bühne““ (text ≤ 32 characters), „Gelöschtes Objekt“,
/// or „Auf dem Board“ for a free pin.
String commentPlace(BoardObject? o, {required bool hasObject, BoardRegistry? registry}) {
  if (!hasObject) return 'Auf dem Board';
  if (o == null) return 'Gelöschtes Objekt';
  final base = o.type == 'shape' ? shapeKindLabel(o.shape) : (registry?.typeOf(o.type)?.label ?? 'Objekt');
  final text = (o.type == 'frame' ? '' : o.displayText).replaceAll(RegExp(r'\s+'), ' ').trim();
  if (text.isEmpty) return base;
  return '$base „${text.length > 32 ? '${text.substring(0, 31)}…' : text}“';
}

/// All threads of the board (filter open / resolved / all): tap = show it on the board and open it. The filter starts
/// at [filter] and every change goes to [onFilter] – like the web, it also decides which pins the board shows
/// (`CollabLayer.filter`).
Future<void> showStachelCommentList(
  BuildContext context, {
  required BoardEditor editor,
  required List<Person> people,
  required void Function(CommentThread t) onOpen,
  String filter = 'open',
  ValueChanged<String>? onFilter,
}) {
  Widget list(BuildContext ctx) => _CommentList(
    editor: editor,
    filter: filter,
    onFilter: onFilter,
    onOpen: (t) {
      Navigator.of(ctx).pop();
      onOpen(t);
    },
  );
  // large windows (UX-Review P12): a panel at the right like the web's sidebar
  if (BoardDesktop.wideOf(context)) {
    return showBoardSidePanel<void>(context, title: 'KOMMENTARE', panelKey: 'stachelCommentPanel', builder: list);
  }
  return showModalBottomSheet<StachelCommentRescue>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: list,
  );
}

class _CommentList extends StatefulWidget {
  const _CommentList({required this.editor, required this.onOpen, required this.filter, this.onFilter});
  final BoardEditor editor;
  final void Function(CommentThread t) onOpen;
  final String filter;
  final ValueChanged<String>? onFilter;

  @override
  State<_CommentList> createState() => _CommentListState();
}

class _CommentListState extends State<_CommentList> {
  late String _filter = const {'open', 'resolved', 'all'}.contains(widget.filter) ? widget.filter : 'open';

  @override
  Widget build(BuildContext context) {
    final all = [...widget.editor.threads]..sort((a, b) => b.lastActivity.compareTo(a.lastActivity));
    final open = all.where((t) => !t.resolved).toList(), done = all.where((t) => t.resolved).toList();
    final shown = switch (_filter) {
      'open' => open,
      'resolved' => done,
      _ => all,
    };
    final c = widget.editor.controller;
    final me = c.user?.key ?? '';
    // web: threads with an unread mention of me carry „@ du“
    final mentioned = {for (final (t, _) in unreadMentions(all, me, null)) t.id};
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.75),
      child: Column(
        key: const Key('stachelCommentList'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'open', label: Text('Offen ${open.length}')),
                ButtonSegment(value: 'resolved', label: Text('Erledigt ${done.length}')),
                ButtonSegment(value: 'all', label: Text('Alle ${all.length}')),
              ],
              selected: {_filter},
              showSelectedIcon: false,
              onSelectionChanged: (s) {
                setState(() => _filter = s.first);
                widget.onFilter?.call(s.first);
              },
            ),
          ),
          Flexible(
            child: shown.isEmpty
                ? Padding(
                    key: const Key('stachelCommentEmpty'),
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.mode_comment_outlined, size: 34, color: Sk.grey),
                        const SizedBox(height: 6),
                        Text(
                          _filter == 'resolved' ? 'Nichts erledigt' : 'Keine Kommentare',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          _filter == 'resolved'
                              ? 'Erledigte Kommentare erscheinen hier.'
                              : 'Lange auf ein Objekt drücken → Kommentieren.',
                          style: TextStyle(color: Sk.grey),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                : ListView(
                    shrinkWrap: true,
                    children: [
                      for (final t in shown)
                        ListTile(
                          key: Key('stachelCommentItem-${t.id}'),
                          leading: Icon(t.resolved ? Icons.check_circle_outline : Icons.mode_comment_outlined),
                          title: Text(t.messages.first.text, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text:
                                      '${t.messages.first.name} · ${commentWhen(t.lastActivity)} · '
                                      '${commentPlace(t.objectId == null ? null : c.state[t.objectId!], hasObject: t.objectId != null, registry: widget.editor.registry)}'
                                      '${t.messages.length > 1 ? ' · ${t.messages.length - 1} ${t.messages.length == 2 ? 'Antwort' : 'Antworten'}' : ''}',
                                ),
                                if (mentioned.contains(t.id))
                                  TextSpan(
                                    text: '  @ du',
                                    style: TextStyle(color: Sk.pink, fontWeight: FontWeight.w700),
                                  ),
                              ],
                            ),
                            key: Key('stachelCommentWhere-${t.id}'),
                          ),
                          trailing: widget.editor.commentable
                              ? IconButton(
                                  key: Key('stachelCommentResolve-${t.id}'),
                                  tooltip: t.resolved ? 'Wieder öffnen' : 'Als erledigt markieren',
                                  icon: Icon(t.resolved ? Icons.check_circle : Icons.check_circle_outline),
                                  color: t.resolved ? Sk.pink : Sk.grey,
                                  onPressed: () =>
                                      setState(() => widget.editor.resolveComment(t.id, resolved: !t.resolved)),
                                )
                              : null,
                          onTap: () => widget.onOpen(t),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
