import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

/// Inline voice-note player for audio attachments.
class VoiceNote extends StatefulWidget {
  const VoiceNote({
    super.key,
    required this.url,
    required this.headers,
    this.durationMs,
  });

  final String url;
  final Map<String, String> headers;
  final int? durationMs;

  @override
  State<VoiceNote> createState() => _VoiceNoteState();
}

class _VoiceNoteState extends State<VoiceNote> {
  AudioPlayer? _player;
  bool _playing = false;

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    final player = _player ??= AudioPlayer();
    if (_playing) {
      await player.pause();
      if (mounted) setState(() => _playing = false);
      return;
    }
    try {
      await player.setUrl(widget.url, headers: widget.headers);
      await player.play();
      if (mounted) setState(() => _playing = true);
      player.playerStateStream.firstWhere(
        (state) => state.processingState == ProcessingState.completed,
      ).then((_) {
        if (mounted) setState(() => _playing = false);
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not play that voice note.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: _toggle,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _playing ? Icons.pause_circle_filled : Icons.play_circle_filled,
              color: scheme.primary,
            ),
            const SizedBox(width: 6),
            const Text('Voice note'),
            if (widget.durationMs != null) ...[
              const SizedBox(width: 6),
              Text(
                '${(widget.durationMs! / 1000).round()}s',
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
