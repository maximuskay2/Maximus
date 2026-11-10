import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme/tokens.dart';
import '../system/live_activities.dart';
import 'dictation.dart';
import 'drafts.dart';

/// Message to send: text plus already-uploaded attachment refs.
class OutgoingMessage {
  const OutgoingMessage({
    required this.text,
    this.attachments = const [],
    this.replyToId,
  });

  final String text;
  final List<UploadedAttachment> attachments;
  final String? replyToId;
}

/// Chat composer: autosaved draft, @mention autocomplete, attachments,
/// reply context, send/stop button. Uploads via [onPickFiles].
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.threadId,
    required this.drafts,
    required this.botNames,
    required this.onSend,
    required this.onStop,
    required this.sending,
    required this.working,
    this.replyTo,
    this.onClearReply,
    required this.onAttach,
    this.maxAttachmentBytes = 25 * 1024 * 1024,
    this.speech,
    this.initialText,
    this.autoDictate = false,
    this.liveActivities,
    this.liveBotName,
    this.hintText = 'Message…  (@ to mention)',
    this.onCall,
  });

  final String threadId;
  final DraftStore drafts;
  final List<String> botNames;
  final Future<void> Function(OutgoingMessage) onSend;
  final Future<void> Function() onStop;
  final bool sending;
  final bool working;
  final ChatMessage? replyTo;
  final VoidCallback? onClearReply;

  /// Picks + uploads files (thread page implements via file_picker + API).
  final Future<List<UploadedAttachment>> Function() onAttach;
  final int maxAttachmentBytes;

  /// Speech driver for dictation; null in tests that skip the mic.
  /// When set, a mic button appears next to Send.
  final SpeechDriver? speech;

  /// Prefilled text (Siri links); a saved draft wins over this.
  final String? initialText;

  /// Starts dictation on open (Siri dictate links).
  final bool autoDictate;

  /// Lock-screen activity driver; null keeps dictation in-app only.
  final LiveActivities? liveActivities;

  /// Bot name shown on the lock-screen activity.
  final String? liveBotName;

  /// Placeholder, for example "Ask Max".
  final String hintText;

  /// Opens a live call when the field is empty.
  final VoidCallback? onCall;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  final List<UploadedAttachment> _attachments = [];
  bool _uploading = false;
  String? _mentionQuery;
  DictationController? _dictation;

  @override
  void initState() {
    super.initState();
    widget.drafts.read(widget.threadId).then((draft) {
      if (!mounted) return;
      if (draft != null && draft.isNotEmpty) {
        _controller.text = draft;
      } else if (widget.initialText != null &&
          widget.initialText!.isNotEmpty) {
        _controller.text = widget.initialText!;
      }
    });
    _controller.addListener(_onChanged);
    final speech = widget.speech;
    if (speech != null) {
      _dictation = DictationController(driver: speech)
        ..onTranscript = (text) {
          _controller.value = TextEditingValue(
            text: text,
            selection: TextSelection.collapsed(offset: text.length),
          );
        }
        ..addListener(_onDictation);
    }
  }

  DateTime? _listenStarted;

  void _onDictation() {
    if (mounted) setState(() {});
    _syncLiveActivity();
  }

  /// Mirrors the dictation session to the lock screen. Best-effort:
  /// failures never disturb typing.
  Future<void> _syncLiveActivity() async {
    final live = widget.liveActivities;
    final botName = widget.liveBotName;
    final dictation = _dictation;
    if (live == null || botName == null || dictation == null) return;
    if (dictation.listening) {
      _listenStarted ??= DateTime.now();
      final elapsed = DateTime.now()
          .difference(_listenStarted!)
          .inSeconds;
      if (_liveActive) {
        await live.update(
          status: 'listening',
          caption: _controller.text.isEmpty
              ? 'Listening…'
              : _controller.text,
          elapsedSeconds: elapsed,
        );
      } else {
        _liveActive = await live.start(
          kind: 'dictate',
          botName: botName,
          caption: 'Listening…',
        );
      }
    } else if (_liveActive) {
      _liveActive = false;
      _listenStarted = null;
      await live.end();
    }
  }

  bool _liveActive = false;


  @override
  void didUpdateWidget(covariant Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.threadId != widget.threadId) {
      widget.drafts.write(oldWidget.threadId, _controller.text);
      _controller.clear();
      _attachments.clear();
      widget.drafts.read(widget.threadId).then((draft) {
        if (draft != null && mounted) _controller.text = draft;
      });
    }
  }

  @override
  void dispose() {
    if (_liveActive) {
      _liveActive = false;
      widget.liveActivities?.end();
    }
    widget.drafts.write(widget.threadId, _controller.text);
    _dictation?.dispose();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged() {
    widget.drafts.write(widget.threadId, _controller.text);
    final text = _controller.text;
    final selection = _controller.selection.baseOffset;
    String? query;
    if (selection > 0) {
      final at = text.lastIndexOf('@', selection - 1);
      if (at >= 0) {
        final after = text.substring(at + 1, selection);
        if (!after.contains(RegExp(r'\s')) && after.length <= 30) {
          query = after;
        }
      }
    }
    if (query != _mentionQuery) setState(() => _mentionQuery = query);
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty && _attachments.isEmpty) return;
    final outgoing = OutgoingMessage(
      text: text,
      attachments: List.of(_attachments),
      replyToId: widget.replyTo?.id,
    );
    _controller.clear();
    _attachments.clear();
    await widget.drafts.clear(widget.threadId);
    widget.onClearReply?.call();
    await widget.onSend(outgoing);
  }

  Future<void> _pick() async {
    setState(() => _uploading = true);
    try {
      final picked = await widget.onAttach();
      if (mounted) setState(() => _attachments.addAll(picked));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  List<String> get _mentionMatches {
    final query = (_mentionQuery ?? '').toLowerCase();
    return [
      for (final name in widget.botNames)
        if (name.toLowerCase().startsWith(query)) name,
    ].take(5).toList();
  }

  void _insertMention(String name) {
    final text = _controller.text;
    final selection = _controller.selection.baseOffset;
    final at = text.lastIndexOf('@', selection - 1);
    if (at < 0) return;
    final next = '${text.substring(0, at)}@$name ${text.substring(selection)}';
    _controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: at + name.length + 2),
    );
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final canSend =
        (_controller.text.trim().isNotEmpty || _attachments.isNotEmpty) &&
        !widget.sending &&
        !_uploading;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_mentionQuery != null && _mentionMatches.isNotEmpty)
          Material(
            color: scheme.surfaceContainerHighest,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(12),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 180),
              child: ListView(
              shrinkWrap: true,
              children: [
                for (final name in _mentionMatches)
                  ListTile(
                    dense: true,
                    leading: CircleAvatar(
                      radius: 14,
                      child: Text(name.isEmpty ? '?' : name[0]),
                    ),
                    title: Text(name),
                    onTap: () => _insertMention(name),
                  ),
              ],
              ),
            ),
          ),
        if (widget.replyTo != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            color: scheme.surfaceContainerHighest,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Replying to: ${widget.replyTo!.text ?? widget.replyTo!.kind}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: widget.onClearReply,
                ),
              ],
            ),
          ),
        if (_attachments.isNotEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Wrap(
              spacing: 8,
              children: [
                for (final attachment in _attachments)
                  Chip(
                    label: Text(
                      attachment.path.split('/').last,
                      overflow: TextOverflow.ellipsis,
                    ),
                    onDeleted: () => setState(
                      () => _attachments.remove(attachment),
                    ),
                  ),
              ],
            ),
          ),
        if (_dictation?.listening == true)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: scheme.error,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  'Listening… tap the mic to stop',
                  style: TextStyle(
                    color: scheme.error,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        if (_dictation?.error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Text(
              _dictation!.error!,
              style: TextStyle(color: scheme.error, fontSize: 12),
            ),
          ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                _ComposerCircle(
                  tooltip: 'Attach',
                  onPressed: _uploading ? null : _pick,
                  child: _uploading
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add, size: 22),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    focusNode: _focus,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: widget.hintText,
                      filled: true,
                      fillColor: const Color(0xFFF2F2F7),
                      border: const OutlineInputBorder(
                        borderRadius: BorderRadius.all(Radius.circular(24)),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                if (_dictation != null)
                  IconButton(
                    onPressed: _uploading
                        ? null
                        : () => _dictation!.toggle(
                              baseText: _controller.text,
                            ),
                    icon: Icon(
                      _dictation!.listening
                          ? Icons.mic_off_outlined
                          : Icons.mic_none_outlined,
                      color: _dictation!.listening ? scheme.error : null,
                    ),
                    tooltip: _dictation!.listening
                        ? 'Stop dictation'
                        : 'Dictate',
                  ),
                if (widget.working)
                  _ComposerCircle(
                    filled: true,
                    tooltip: 'Stop',
                    onPressed: widget.onStop,
                    child: const Icon(Icons.stop, color: Colors.white, size: 20),
                  )
                else if (canSend)
                  _ComposerCircle(
                    filled: true,
                    tooltip: 'Send',
                    onPressed: _send,
                    child: const Icon(
                      Icons.arrow_upward,
                      color: Colors.white,
                      size: 20,
                    ),
                  )
                else
                  _ComposerCircle(
                    filled: true,
                    tooltip: 'Voice call',
                    onPressed: widget.onCall,
                    child: const Icon(
                      Icons.graphic_eq,
                      color: Colors.white,
                      size: 20,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ComposerCircle extends StatelessWidget {
  const _ComposerCircle({
    required this.child,
    required this.tooltip,
    this.onPressed,
    this.filled = false,
  });

  final Widget child;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: filled ? MaxTokens.ember : const Color(0xFFF2F2F7),
        foregroundColor: filled ? Colors.white : MaxTokens.ink,
        fixedSize: const Size(40, 40),
        shape: const CircleBorder(),
      ),
      icon: child,
    );
  }
}
