import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

import '../theme.dart';

/// Page frame of the login pages: logo, heading, a short text and the form, scrollable, max. 440 wide.
class AuthPage extends StatelessWidget {
  const AuthPage({
    super.key,
    required this.title,
    this.text,
    required this.children,
    this.showLogo = false,
    this.appBar = true,
  });

  final String title;
  final String? text;
  final List<Widget> children;
  final bool showLogo;
  final bool appBar;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: appBar ? AppBar() : null,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (showLogo) ...[
                    Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Image.asset('assets/brand/stachel_logo.png', width: 56, height: 56),
                        ),
                        const SizedBox(width: 14),
                        Text('STACHEL', style: t.displaySmall),
                      ],
                    ),
                    const SizedBox(height: 28),
                  ],
                  Text(title, style: t.headlineMedium),
                  if (text != null) ...[
                    const SizedBox(height: 8),
                    Text(text!, style: t.bodyLarge?.copyWith(color: StachelTheme.muted)),
                  ],
                  const SizedBox(height: 24),
                  ...children,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A hint box (green = ok, pink/red = problem, grey = info).
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.kind = NoticeKind.info, this.action});
  final String text;
  final NoticeKind kind;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final (bg, icon) = switch (kind) {
      NoticeKind.ok => (StachelTheme.green, Icons.check_circle_outline),
      NoticeKind.error => (const Color(0xFFFBE3EC), Icons.error_outline),
      NoticeKind.info => (StachelTheme.canvas, Icons.info_outline),
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: kind == NoticeKind.error ? StachelTheme.danger : StachelTheme.ink),
              const SizedBox(width: 10),
              Expanded(child: Text(text)),
            ],
          ),
          if (action != null) Align(alignment: Alignment.centerRight, child: action),
        ],
      ),
    );
  }
}

enum NoticeKind { ok, error, info }

/// Text field with label (and the right keyboard / autofill).
class AuthField extends StatelessWidget {
  const AuthField({
    super.key,
    required this.controller,
    required this.label,
    this.password = false,
    this.email = false,
    this.url = false,
    this.autofill,
    this.onSubmitted,
    this.action = TextInputAction.next,
    this.helper,
  });

  final TextEditingController controller;
  final String label;
  final bool password;
  final bool email;

  /// A web address (URL keyboard, no autocorrect).
  final bool url;
  final Iterable<String>? autofill;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction action;
  final String? helper;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextField(
      controller: controller,
      obscureText: password,
      autocorrect: !password && !email && !url,
      enableSuggestions: !password && !email && !url,
      keyboardType: email
          ? TextInputType.emailAddress
          : (url ? TextInputType.url : (password ? TextInputType.visiblePassword : TextInputType.text)),
      textInputAction: action,
      autofillHints: autofill,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(labelText: label, helperText: helper, helperMaxLines: 2),
    ),
  );
}

/// A full-width button with a spinner while [busy].
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.busy = false, this.outlined = false});
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool outlined;

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
        : Text(label);
    final onTap = busy ? null : onPressed;
    return outlined ? OutlinedButton(onPressed: onTap, child: child) : FilledButton(onPressed: onTap, child: child);
  }
}

/// The German text of an error for people.
String errorText(Object e) => e is StachelException ? e.message : 'Das hat nicht geklappt. Bitte versuch es nochmal.';
