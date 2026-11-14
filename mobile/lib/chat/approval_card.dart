import 'package:flutter/material.dart';

import '../api/models.dart';

/// Answers a live card. Mirrors the desktop's card-answer semantics:
/// permission cards take allow/deny, questions take answer + message.
typedef CardAnswerer =
    Future<void> Function(
      String requestId,
      String behavior, {
      String? message,
      bool always,
      bool dismiss,
    });

/// What the server files when a question is closed unanswered
/// (`QUESTION_DISMISS_MESSAGE` in shared/ask-question.ts).
const questionDismissMessage =
    'The user closed this question without answering. '
    'Use your best judgment and continue.';

/// An approval/question card inside a bot message: Allow once / Deny /
/// Always allow for permissions, option chips + free text for questions,
/// a settled receipt once answered, and the named device for computer asks.
class ApprovalCard extends StatefulWidget {
  const ApprovalCard({super.key, required this.card, this.onAnswer});

  final OptionCard card;

  /// Null renders the card read-only (settled cards, previews).
  final CardAnswerer? onAnswer;

  @override
  State<ApprovalCard> createState() => _ApprovalCardState();
}

class _ApprovalCardState extends State<ApprovalCard> {
  bool _answering = false;

  /// Per-question selected option labels (structured questions).
  final Map<int, Set<String>> _picked = {};
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  OptionCard get _card => widget.card;
  bool get _live => _card.isLive && widget.onAnswer != null && !_answering;

  Future<void> _answer(
    String behavior, {
    String? message,
    bool always = false,
    bool dismiss = false,
  }) async {
    final requestId = _card.requestId;
    final onAnswer = widget.onAnswer;
    if (requestId == null || onAnswer == null || _answering) return;
    setState(() => _answering = true);
    try {
      await onAnswer(
        requestId,
        behavior,
        message: message,
        always: always,
        dismiss: dismiss,
      );
    } finally {
      if (mounted) setState(() => _answering = false);
    }
  }

  void _sendStructured() {
    final parts = <String>[];
    for (var i = 0; i < _card.questions.length; i++) {
      final question = _card.questions[i];
      final picked = _picked[i] ?? const <String>{};
      if (picked.isEmpty) continue;
      final label = question.header ?? question.question;
      parts.add('$label: ${picked.join(', ')}');
    }
    final free = _text.text.trim();
    if (free.isNotEmpty) parts.add(free);
    if (parts.isEmpty) return;
    _answer('answer', message: parts.join('; '));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final ask = _card.computerAsk;
    final icon = ask != null
        ? Icons.computer_outlined
        : _card.isPermission
        ? Icons.shield_outlined
        : Icons.help_outline;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE5E5EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _card.title.isEmpty ? 'Approval needed' : _card.title,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              if (_card.isLive && widget.onAnswer != null)
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  tooltip: 'Dismiss',
                  onPressed: _answering
                      ? null
                      : () => _card.isPermission
                            ? _answer('deny', message: 'Dismissed by user.')
                            : _answer(
                                'answer',
                                message: questionDismissMessage,
                                dismiss: true,
                              ),
                ),
            ],
          ),
          if (_card.subtitle.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              _card.subtitle,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          if (_card.tool != null) ...[
            const SizedBox(height: 6),
            Chip(
              label: Text(
                _card.tool!,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              visualDensity: VisualDensity.compact,
            ),
          ],
          if (ask != null) _computerAsk(context, ask),
          const SizedBox(height: 4),
          if (!_card.isLive)
            _receipt(context)
          else if (widget.onAnswer == null)
            const SizedBox.shrink()
          else if (_card.isPermission)
            _permissionButtons()
          else
            _questionBody(context),
          if (_answering)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: LinearProgressIndicator(),
            ),
        ],
      ),
    );
  }

  Widget _computerAsk(BuildContext context, ComputerAsk ask) {
    final scheme = Theme.of(context).colorScheme;
    final state = switch (ask.state) {
      'on' => 'On — your ${ask.device} is lending it.',
      'turning-on' => 'Turning on…',
      'failed' => 'Could not turn on from here.',
      'declined' => 'Declined for now.',
      'ended' => 'Ended.',
      _ => 'Answer on your ${ask.device} — ${ask.reason}.',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Icon(Icons.devices_outlined, size: 16, color: scheme.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(state, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }

  Widget _receipt(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final String text;
    final IconData icon;
    if (_card.answered != null) {
      text = _card.answered == 'Denied'
          ? 'Denied'
          : 'Allowed: ${_card.answered}';
      icon = _card.answered == 'Denied'
          ? Icons.cancel_outlined
          : Icons.check_circle_outline;
    } else if (_card.answeredText != null) {
      text = 'Answered: ${_card.answeredText}';
      icon = Icons.check_circle_outline;
    } else if (_card.dismissed) {
      text = 'Dismissed';
      icon = Icons.cancel_outlined;
    } else if (_card.expired) {
      text = 'Expired — needs a fresh proposal';
      icon = Icons.timer_off_outlined;
    } else if (_card.stopped) {
      text = 'Stopped';
      icon = Icons.stop_circle_outlined;
    } else {
      text = 'Settled';
      icon = Icons.check_circle_outline;
    }
    return Row(
      children: [
        Icon(icon, size: 16, color: scheme.primary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: scheme.onSurface.withValues(alpha: 0.75),
            ),
          ),
        ),
      ],
    );
  }

  Widget _permissionButtons() {
    final outbound = _card.outboundRequest != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          onPressed: _live ? () => _answer('allow') : null,
          child: Text(outbound ? 'Allow' : 'Allow once'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _live ? () => _answer('deny') : null,
          child: const Text('Deny'),
        ),
        if (_card.allowSession && !outbound) ...[
          const SizedBox(height: 4),
          TextButton(
            onPressed: _live ? () => _answer('allow', always: true) : null,
            child: const Text('Always allow'),
          ),
        ],
      ],
    );
  }

  Widget _questionBody(BuildContext context) {
    if (_card.questions.isNotEmpty) return _structuredQuestions(context);
    final freeText = !_card.fixedOptions;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_card.options.isNotEmpty)
          for (var i = 0; i < _card.options.length; i++)
            InkWell(
              onTap: _live
                  ? () => _answer('answer', message: _card.options[i])
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 14,
                      backgroundColor: const Color(0xFFF2F2F7),
                      child: Text(
                        String.fromCharCode(65 + (i % 26)),
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF1C1C1E),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(_card.options[i])),
                  ],
                ),
              ),
            ),
        if (freeText) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _text,
                  enabled: _live,
                  decoration: const InputDecoration(
                    hintText: 'Type an answer…',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) {
                    final answer = _text.text.trim();
                    if (answer.isNotEmpty) _answer('answer', message: answer);
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.send),
                tooltip: 'Send answer',
                onPressed: !_live
                    ? null
                    : () {
                        final answer = _text.text.trim();
                        if (answer.isNotEmpty) {
                          _answer('answer', message: answer);
                        }
                      },
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _structuredQuestions(BuildContext context) {
    final freeText =
        !_card.fixedOptions && _card.questions.any((q) => q.custom);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < _card.questions.length; i++) ...[
          if (i > 0) const SizedBox(height: 8),
          Text(
            _card.questions[i].header ?? _card.questions[i].question,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (_card.questions[i].header != null)
            Text(
              _card.questions[i].question,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final option in _card.questions[i].options)
                ChoiceChip(
                  label: Text(option.label),
                  selected: _picked[i]?.contains(option.label) ?? false,
                  onSelected: !_live
                      ? null
                      : (on) => setState(() {
                          final picked = _picked.putIfAbsent(i, () => {});
                          if (_card.questions[i].multiSelect) {
                            on
                                ? picked.add(option.label)
                                : picked.remove(option.label);
                          } else {
                            picked
                              ..clear()
                              ..add(option.label);
                          }
                        }),
                ),
            ],
          ),
        ],
        if (freeText) ...[
          const SizedBox(height: 8),
          TextField(
            controller: _text,
            enabled: _live,
            decoration: const InputDecoration(
              hintText: 'Add your own answer…',
              isDense: true,
              border: OutlineInputBorder(),
            ),
          ),
        ],
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _live ? _sendStructured : null,
            child: const Text('Send answers'),
          ),
        ),
      ],
    );
  }
}
