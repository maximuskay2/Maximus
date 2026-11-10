import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../api/models.dart';
import '../theme/tokens.dart';
import 'approval_card.dart';
import 'voice_note.dart';

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
class MessageBubble extends StatelessWidget {
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

  bool get _mine => message.role == 'user';

  @override
  Widget build(BuildContext context) {
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
          if (replyToText != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '↩ $replyToText',
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
              child: imageLoader(context, '$baseUrl${image.path}', headers),
            ),
          for (final clip in audio)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: VoiceNote(
                url: '$baseUrl${clip.path}',
                headers: headers,
                durationMs: clip.durationMs,
              ),
            ),
          if (message.text != null && message.text!.isNotEmpty)
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
              onAnswer: _mine ? null : onAnswerCard,
            )
          else if (message.hasCard)
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
    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (onReply != null)
          IconButton(
            icon: const Icon(Icons.reply, size: 18),
            tooltip: 'Reply',
            onPressed: () => onReply!(message),
          ),
        if (onReact != null)
          IconButton(
            icon: const Icon(Icons.add_reaction_outlined, size: 18),
            tooltip: 'React',
            onPressed: () => onReact!(message),
          ),
      ],
    );
    return Align(
      alignment: _mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: _mine
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          bubble,
          if (!message.blank && (onReply != null || onReact != null)) row,
        ],
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
