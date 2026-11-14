import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Bot widget with confirm/cancel (email draft Send/Discard and similar).
class WidgetCard extends StatefulWidget {
  const WidgetCard({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.botId,
    required this.threadId,
    required this.messageId,
    required this.widgetData,
    this.onUpdated,
  });

  final MaximusApi client;
  final String baseUrl;
  final String botId;
  final String threadId;
  final String messageId;
  final ChatWidget widgetData;
  final ValueChanged<ChatWidget>? onUpdated;

  @override
  State<WidgetCard> createState() => _WidgetCardState();
}

class _WidgetCardState extends State<WidgetCard> {
  bool _busy = false;
  String? _error;

  ChatWidget get _data => widget.widgetData;

  Future<void> _press(ChatWidgetButton button, String tone) async {
    if (_busy || !_data.isLive) return;
    if (button.actionType == 'open_url') {
      // Payload is not stored on the simplified button; ignore here.
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final ref = button.ref ?? (tone == 'confirm' ? 'confirm' : 'cancel');
    try {
      await widget.client.sendWidgetAction(
        widget.baseUrl,
        widget.botId,
        threadId: widget.threadId,
        messageId: widget.messageId,
        ref: ref,
        rev: _data.rev,
      );
      widget.onUpdated?.call(
        _data.copyWith(
          settled: ChatWidgetSettled(
            ref: ref,
            label: button.label,
            tone: tone,
          ),
        ),
      );
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final settled = _data.settled;
    if (settled != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          children: [
            Icon(
              settled.tone == 'cancel'
                  ? Icons.cancel_outlined
                  : Icons.check_circle_outline,
              size: 18,
              color: scheme.primary,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                settled.label,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      );
    }
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
        children: [
          if (_data.title != null) ...[
            Text(
              _data.title!,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
          ],
          for (final line in _data.lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: MarkdownBody(
                data: line,
                onTapLink: (text, href, title) {
                  if (href == null) return;
                  final uri = Uri.tryParse(href);
                  if (uri != null) {
                    unawaitedLaunch(uri);
                  }
                },
                styleSheet: MarkdownStyleSheet(
                  p: const TextStyle(
                    color: Color(0xFF1C1C1E),
                    fontSize: 15,
                    height: 1.35,
                  ),
                ),
              ),
            ),
          if (_error != null) ...[
            Text(_error!, style: TextStyle(color: scheme.error, fontSize: 13)),
            const SizedBox(height: 6),
          ],
          if (_data.confirm != null || _data.cancel != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (_data.confirm != null)
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _press(_data.confirm!, 'confirm'),
                      child: Text(_data.confirm!.label),
                    ),
                  ),
                if (_data.confirm != null && _data.cancel != null)
                  const SizedBox(width: 8),
                if (_data.cancel != null)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => _press(_data.cancel!, 'cancel'),
                      child: Text(_data.cancel!.label),
                    ),
                  ),
              ],
            ),
          ],
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: LinearProgressIndicator(),
            ),
        ],
      ),
    );
  }
}

void unawaitedLaunch(Uri uri) {
  launchUrl(uri, mode: LaunchMode.externalApplication);
}
