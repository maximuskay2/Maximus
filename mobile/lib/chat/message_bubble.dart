import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../theme/tokens.dart';
import 'app_card.dart';
import 'approval_card.dart';
import 'connector_card.dart';
import 'secret_card.dart';
import 'sign_in_card.dart';
import 'voice_note.dart';
import 'widget_card.dart';

/// Loads an attachment image. Injectable so tests avoid the network.
typedef AttachmentImageLoader = Widget Function(
  BuildContext context,
  String url,
  Map<String, String> headers,
);

/// Default network image loader with auth headers.
Widget defaultAttachmentImageLoader(
  BuildContext context,
  String url,
  Map<String, String> headers,
) {
  return ClipRRect(
    borderRadius: BorderRadius.circular(MaxTokens.radiusCard),
    child: Image.network(
      url,
      headers: headers,
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined),
    ),
  );
}

/// One chat message: bubble, markdown body, attachment previews.
/// Slide the bubble to reply. Long-press it to show reply and react.
class MessageBubble extends StatefulWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.baseUrl,
    required this.headers,
    this.imageLoader = defaultAttachmentImageLoader,
    this.onReact,
    this.onReply,
    this.replyToText,
    this.onAnswerCard,
    this.client,
    this.bot,
    this.thread,
    this.onSecretUpdated,
    this.onSignInUpdated,
    this.onConnectorUpdated,
    this.onWidgetUpdated,
  });

  final ChatMessage message;
  final String baseUrl;
  final Map<String, String> headers;
  final AttachmentImageLoader imageLoader;

  /// Toggle a reaction (emoji picker in the thread page).
  final void Function(ChatMessage message)? onReact;

  /// Start a threaded reply.
  final void Function(ChatMessage message)? onReply;

  /// Quoted text of the message this replies to, when known.
  final String? replyToText;

  /// Answer a live approval/question card on this message.
  final CardAnswerer? onAnswerCard;

  /// Needed to save secret / sign-in cards from the phone.
  final MaximusApi? client;
  final BotSummary? bot;
  final ThreadSummary? thread;
  final ValueChanged<SecretRequest>? onSecretUpdated;
  final ValueChanged<SignInRequest>? onSignInUpdated;
  final ValueChanged<ConnectorRequest>? onConnectorUpdated;
  final ValueChanged<ChatWidget>? onWidgetUpdated;

  @override
  State<MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<MessageBubble> {
  static const _replyDistance = 56.0;

  final _bubbleKey = GlobalKey();
  double _drag = 0;
  OverlayEntry? _actions;

  bool get _mine => widget.message.role == 'user';

  bool get _actionable =>
      !widget.message.blank &&
      (widget.onReply != null || widget.onReact != null);

  void _showActions() {
    _hideActions();
    final box = _bubbleKey.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return;
    final origin = box.localToGlobal(Offset.zero);
    final overlay = Overlay.of(context);
    _actions = OverlayEntry(
      builder: (context) {
        final media = MediaQuery.sizeOf(context);
        final below = origin.dy + box.size.height + 4;
        final top = below + 48 > media.height ? origin.dy - 48 : below;
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                onTap: _hideActions,
                behavior: HitTestBehavior.translucent,
              ),
            ),
            Positioned(
              left: _mine ? null : origin.dx,
              right: _mine
                  ? media.width - origin.dx - box.size.width
                  : null,
              top: top,
              child: Material(
                color: const Color(0xFFF2F2F7),
                elevation: 2,
                borderRadius: BorderRadius.circular(22),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (widget.onReply != null)
                      IconButton(
                        icon: const Icon(Icons.reply, size: 18),
                        tooltip: 'Reply',
                        onPressed: () {
                          _hideActions();
                          widget.onReply!(widget.message);
                        },
                      ),
                    if (widget.onReact != null)
                      IconButton(
                        icon: const Icon(Icons.add_reaction_outlined, size: 18),
                        tooltip: 'React',
                        onPressed: () {
                          _hideActions();
                          widget.onReact!(widget.message);
                        },
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
    overlay.insert(_actions!);
  }

  void _hideActions() {
    _actions?.remove();
    _actions = null;
  }

  @override
  void dispose() {
    _hideActions();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final scheme = Theme.of(context).colorScheme;
    final images = [
      for (final a in message.attachments)
        if (a.kind == 'image') a,
    ];
    final audio = [
      for (final a in message.attachments)
        if (a.kind == 'audio') a,
    ];
    final files = [
      for (final a in message.attachments)
        if (a.kind != 'image' && a.kind != 'audio') a,
    ];
    final bubble = Container(
      key: _bubbleKey,
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      constraints: BoxConstraints(
        maxWidth: MediaQuery.sizeOf(context).width * (_mine ? 0.78 : 0.92),
      ),
      decoration: BoxDecoration(
        color: _mine ? const Color(0xFF1C1C1E) : const Color(0xFFF2F2F7),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (message.fromApp != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Sent from ${message.fromApp!.title}',
                style: TextStyle(
                  fontSize: 12,
                  color: (_mine ? scheme.onPrimary : scheme.onSurface)
                      .withValues(alpha: 0.7),
                ),
              ),
            ),
          if (widget.replyToText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '↩ ${widget.replyToText}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontStyle: FontStyle.italic,
                  color: (_mine ? scheme.onPrimary : scheme.onSurface)
                      .withValues(alpha: 0.75),
                ),
              ),
            ),
          for (final image in images)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: widget.imageLoader(
                context,
                '${widget.baseUrl}${image.path}',
                widget.headers,
              ),
            ),
          for (final clip in audio)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: VoiceNote(
                url: '${widget.baseUrl}${clip.path}',
                headers: widget.headers,
                durationMs: clip.durationMs,
              ),
            ),
          if (message.app == null &&
              message.text != null &&
              message.text!.isNotEmpty)
            MarkdownBody(
              data: message.text!,
              styleSheet: MarkdownStyleSheet(
                p: TextStyle(
                  color: _mine ? Colors.white : const Color(0xFF1C1C1E),
                  fontSize: 16,
                  height: 1.35,
                ),
              ),
            ),
          for (final file in files)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.insert_drive_file_outlined,
                    size: 18,
                    color: _mine ? scheme.onPrimary : scheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      file.name ?? file.mime,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: _mine ? scheme.onPrimary : scheme.onSurface,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (message.reactions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Wrap(
                spacing: 4,
                children: [
                  for (final reaction in message.reactions)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: scheme.surface.withValues(alpha: 0.5),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(reaction.emoji),
                    ),
                ],
              ),
            ),
          if (message.card != null)
            ApprovalCard(
              card: message.card!,
              onAnswer: _mine ? null : widget.onAnswerCard,
            ),
          if (message.secret != null &&
              widget.client != null &&
              widget.bot != null &&
              widget.thread != null)
            SecretCard(
              client: widget.client!,
              baseUrl: widget.baseUrl,
              botId: widget.bot!.id,
              threadId: widget.thread!.threadId,
              messageId: message.id,
              secret: message.secret!,
              onUpdated: widget.onSecretUpdated,
            ),
          if (message.signIn != null &&
              widget.client != null &&
              widget.bot != null &&
              widget.thread != null)
            SignInCard(
              client: widget.client!,
              baseUrl: widget.baseUrl,
              bot: widget.bot!,
              thread: widget.thread!,
              messageId: message.id,
              signIn: message.signIn!,
              onUpdated: widget.onSignInUpdated,
            ),
          if (message.connector != null &&
              widget.client != null &&
              widget.bot != null &&
              widget.thread != null)
            ConnectorCard(
              client: widget.client!,
              baseUrl: widget.baseUrl,
              botId: widget.bot!.id,
              threadId: widget.thread!.threadId,
              messageId: message.id,
              connector: message.connector!,
              onUpdated: widget.onConnectorUpdated,
            ),
          if (message.widget != null &&
              widget.client != null &&
              widget.bot != null &&
              widget.thread != null)
            WidgetCard(
              client: widget.client!,
              baseUrl: widget.baseUrl,
              botId: widget.bot!.id,
              threadId: widget.thread!.threadId,
              messageId: message.id,
              widgetData: message.widget!,
              onUpdated: widget.onWidgetUpdated,
            ),
          if (message.app != null &&
              widget.client != null &&
              widget.bot != null &&
              widget.thread != null)
            AppCard(
              client: widget.client!,
              baseUrl: widget.baseUrl,
              botId: widget.bot!.id,
              threadId: widget.thread!.threadId,
              messageId: message.id,
              payload: message.app!,
              fallbackText: message.text,
            ),
          if (message.publishedPage != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                message.publishedPage!.state == 'live'
                    ? 'Page · ${message.publishedPage!.title}'
                    : 'Page · ${message.publishedPage!.title} (${message.publishedPage!.state})',
                style: TextStyle(
                  color: (_mine ? scheme.onPrimary : scheme.onSurface)
                      .withValues(alpha: 0.85),
                ),
              ),
            ),
          if (message.hasCard &&
              message.card == null &&
              message.secret == null &&
              message.signIn == null &&
              message.connector == null &&
              message.widget == null &&
              message.app == null &&
              message.publishedPage == null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                '• card — open on desktop to answer',
                style: TextStyle(
                  fontStyle: FontStyle.italic,
                  color: (_mine ? scheme.onPrimary : scheme.onSurface)
                      .withValues(alpha: 0.7),
                ),
              ),
            ),
        ],
      ),
    );
    final slide = widget.onReply != null && !message.blank;
    return Align(
      alignment: _mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: _actionable ? _showActions : null,
        onHorizontalDragUpdate: slide
            ? (details) {
                setState(() {
                  _drag = (_drag + details.delta.dx).clamp(0, 72);
                });
              }
            : null,
        onHorizontalDragEnd: slide
            ? (_) {
                final reply = _drag >= _replyDistance;
                setState(() => _drag = 0);
                if (reply) widget.onReply!(message);
              }
            : null,
        onHorizontalDragCancel: slide ? () => setState(() => _drag = 0) : null,
        child: Stack(
          alignment: Alignment.centerLeft,
          children: [
            if (_drag > 0)
              Opacity(
                opacity: (_drag / _replyDistance).clamp(0, 1),
                child: const Padding(
                  padding: EdgeInsets.only(left: 4),
                  child: Icon(Icons.reply, size: 18),
                ),
              ),
            Transform.translate(offset: Offset(_drag, 0), child: bubble),
          ],
        ),
      ),
    );
  }
}

class ThinkingBubble extends StatefulWidget {
  const ThinkingBubble({super.key});

  @override
  State<ThinkingBubble> createState() => _ThinkingBubbleState();
}

class _ThinkingBubbleState extends State<ThinkingBubble>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  double _dot(int index) {
    final phase = (_pulse.value + index / 3) % 1;
    final wave = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return 0.35 + 0.65 * wave;
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFF2F2F7),
          borderRadius: BorderRadius.circular(22),
        ),
        child: reduce
            ? const Text(
                'Thinking…',
                style: TextStyle(color: Color(0xFF8E8E93), fontSize: 15),
              )
            : AnimatedBuilder(
                animation: _pulse,
                builder: (context, _) {
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (var i = 0; i < 3; i++)
                        Container(
                          width: 7,
                          height: 7,
                          margin: EdgeInsets.only(left: i == 0 ? 0 : 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFF8E8E93)
                                .withValues(alpha: _dot(i)),
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  );
                },
              ),
      ),
    );
  }
}
