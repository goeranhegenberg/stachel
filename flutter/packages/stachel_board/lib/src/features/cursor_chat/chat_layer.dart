import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../follow/collab_common.dart';

// Cursor-Chat (web `CursorChat.tsx`): the others' short messages live at their pointer (typing dots, 5 s after
// sending), own message from the board menu „Kurznachricht“ – a phone has no mouse pointer, so it appears where the
// app's pointer is for the others: the middle of the view. Awareness `collab.chat`, not stored. Audit rows L18, L19.

/// A sent message stays this long at the pointer (web `CHAT_LINGER`).
const chatLinger = Duration(milliseconds: 5000);

/// Longest message (web `CHAT_MAX`).
const chatMax = 120;

/// Own message field of one board screen.
class CursorChatRuntime {
  CursorChatRuntime._(this.ui);
  static final _of = Expando<CursorChatRuntime>('CursorChatRuntime');
  static CursorChatRuntime of(BoardUi ui) => _of[ui] ??= CursorChatRuntime._(ui);
  final BoardUi ui;

  /// The own field is open.
  final open = ValueNotifier<bool>(false);
  Timer? _linger;

  /// Opens the own field (web `openCursorChat`; not while presenting).
  bool start() {
    if (ui.presenting.value) return false;
    _linger?.cancel();
    open.value = true;
    return true;
  }

  void send(Map<String, Object?>? msg, {bool immediate = false}) =>
      ui.controller.presence.setExtra(awChat, msg, immediate: immediate);

  /// Closes the field: [keep] sends the text (stays [chatLinger]), else the message disappears.
  void close(String text, {required bool keep}) {
    if (!open.value) return;
    open.value = false;
    final t = text.trim();
    if (keep && t.isNotEmpty) {
      send({'text': t}, immediate: true);
      _linger = Timer(chatLinger, () => send(null, immediate: true));
    } else {
      send(null, immediate: true);
    }
  }
}

/// Overlay `collab.chat` (not while presenting): the others' messages at their pointers and the own field.
class CursorChatLayer extends StatelessWidget {
  const CursorChatLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final view = ui.view;
    if (view == null) return const SizedBox.shrink();
    final rt = CursorChatRuntime.of(ui);
    return ListenableBuilder(
      listenable: Listenable.merge([ui.controller, view.camera, rt.open]),
      builder: (context, _) {
        final cam = view.camera.value;
        final size = view.viewSize;
        final bubbles = <Widget>[];
        for (final p in ui.controller.peers) {
          final msg = p.extra[awChat];
          if (msg is! Map || msg['text'] is! String || (msg['text'] as String).isEmpty) continue;
          if (p.cursorX == null || p.cursorY == null) continue;
          final s = cam.toScreen(Offset(p.cursorX!, p.cursorY!));
          if (s.dx < -200 || s.dy < -60 || s.dx > size.width + 20 || s.dy > size.height + 20) continue;
          bubbles.add(
            Positioned(
              key: ValueKey('collabChat-${p.id}'),
              left: s.dx + 15,
              top: s.dy + 17,
              child: IgnorePointer(
                child: _Bubble(
                  color: peerColor(p.color),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        p.name,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Color(0xD9FFFFFF),
                          height: 1.2,
                        ),
                      ),
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(text: msg['text'] as String),
                            if (msg['typing'] == true)
                              const TextSpan(
                                text: ' …',
                                style: TextStyle(fontWeight: FontWeight.w800),
                              ),
                          ],
                        ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }
        if (rt.open.value && !ui.presenting.value) {
          final c = size.center(Offset.zero);
          bubbles.add(
            Positioned(
              // like the web at the pointer (+15/+17), but kept on the screen (the field is up to 280 px wide)
              left: (c.dx + 15).clamp(8.0, (size.width - 288).clamp(8.0, double.infinity)),
              top: c.dy + 17,
              child: _OwnChat(ui: ui),
            ),
          );
        }
        if (bubbles.isEmpty) return const SizedBox.shrink();
        return Stack(clipBehavior: Clip.none, children: bubbles);
      },
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.color, required this.child, this.padding = const EdgeInsets.fromLTRB(12, 7, 12, 6)});
  final Color color;
  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(maxWidth: 280),
    padding: padding,
    decoration: BoxDecoration(
      color: color,
      borderRadius: const BorderRadius.only(
        topLeft: Radius.circular(4),
        topRight: Radius.circular(14),
        bottomLeft: Radius.circular(14),
        bottomRight: Radius.circular(14),
      ),
      boxShadow: const [BoxShadow(color: Color(0x38000000), blurRadius: 18, offset: Offset(0, 6))],
    ),
    child: child,
  );
}

class _OwnChat extends StatefulWidget {
  const _OwnChat({required this.ui});
  final BoardUi ui;

  @override
  State<_OwnChat> createState() => _OwnChatState();
}

class _OwnChatState extends State<_OwnChat> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  CursorChatRuntime get rt => CursorChatRuntime.of(widget.ui);

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      // leaving the field sends (web onBlur → close(true))
      if (!_focus.hasFocus) rt.close(_text.text, keep: true);
    });
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = peerColor(widget.ui.controller.color ?? '');
    return _Bubble(
      color: color,
      padding: const EdgeInsets.fromLTRB(8, 2, 2, 2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 90, maxWidth: 220),
            child: IntrinsicWidth(
              child: TextField(
                key: const Key('collabChatInput'),
                controller: _text,
                focusNode: _focus,
                autofocus: true,
                maxLength: chatMax,
                textInputAction: TextInputAction.send,
                cursorColor: Colors.white,
                style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                decoration: const InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  counterText: '',
                  hintText: 'Sag was …',
                  hintStyle: TextStyle(color: Color(0xB3FFFFFF)),
                ),
                onChanged: (v) => rt.send(v.isEmpty ? null : {'text': v, 'typing': true}),
                onSubmitted: (v) => rt.close(v, keep: true),
              ),
            ),
          ),
          IconButton(
            key: const Key('collabChatCancel'),
            tooltip: 'Verwerfen',
            visualDensity: VisualDensity.compact,
            color: Colors.white,
            onPressed: () => rt.close(_text.text, keep: false),
            icon: const Icon(Icons.close, size: 18),
          ),
        ],
      ),
    );
  }
}
