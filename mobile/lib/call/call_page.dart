import 'dart:async';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../system/live_activities.dart';
import 'call_controller.dart';
import 'rtc.dart';

/// Full-screen live voice call: bot identity, on-line indicator, elapsed
/// time, mute/speaker/hangup. The call starts on open (the open tap is the
/// explicit mic consent) and hangs up when the page closes.
class CallPage extends StatefulWidget {
  const CallPage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
    required this.thread,
    this.rtc,
    this.controller,
    this.liveActivities,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;
  final ThreadSummary thread;

  /// Injectable media + controller for tests.
  final RtcDriver? rtc;
  final CallController? controller;

  /// Lock-screen activity driver; null keeps the call in-app only.
  final LiveActivities? liveActivities;

  @override
  State<CallPage> createState() => _CallPageState();
}

class _CallPageState extends State<CallPage> {
  late final CallController _calls;
  Timer? _ticker;
  Duration _elapsed = Duration.zero;
  bool _liveActive = false;

  @override
  void initState() {
    super.initState();
    _calls =
        widget.controller ??
        CallController(
          rtc: widget.rtc ?? WebrtcDriver(),
          client: widget.client,
          baseUrl: widget.baseUrl,
        );
    _calls.addListener(_onChange);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      final startedAt = _calls.call?.startedAt;
      if (startedAt != null && startedAt > 0 && mounted) {
        setState(() {
          _elapsed = DateTime.now().difference(
            DateTime.fromMillisecondsSinceEpoch(startedAt),
          );
        });
        _syncLiveActivity();
      }
    });
    _calls.start(botId: widget.bot.id, threadId: widget.thread.threadId);
  }

  void _onChange() {
    if (!mounted) return;
    setState(() {});
    _syncLiveActivity();
    if (_calls.phase == CallPhase.ended || _calls.phase == CallPhase.failed) {
      // Let the outcome read for a beat, then leave.
      Future<void>.delayed(const Duration(milliseconds: 1400)).then((_) {
        if (mounted &&
            (_calls.phase == CallPhase.ended ||
                _calls.phase == CallPhase.failed)) {
          Navigator.of(context).maybePop();
        }
      });
    }
  }

  /// Mirrors the call to the lock screen / Dynamic Island. Best-effort:
  /// channel failures never disturb the call.
  Future<void> _syncLiveActivity() async {
    final live = widget.liveActivities;
    if (live == null) return;
    final phase = _calls.phase;
    if (phase == CallPhase.ended ||
        phase == CallPhase.failed ||
        phase == CallPhase.ending) {
      if (_liveActive) {
        _liveActive = false;
        await live.end();
      }
      return;
    }
    final status = switch (phase) {
      CallPhase.idle => 'idle',
      CallPhase.starting => 'connecting',
      CallPhase.live => _calls.muted ? 'muted' : 'live',
      _ => 'live',
    };
    final caption = phase == CallPhase.live && !_calls.hearing
        ? 'Connected…'
        : _statusText;
    if (_liveActive) {
      await live.update(
        status: status,
        caption: caption,
        elapsedSeconds: _elapsed.inSeconds,
      );
    } else if (phase != CallPhase.idle) {
      _liveActive = await live.start(
        kind: 'call',
        botName: widget.bot.name,
        caption: caption,
      );
    }
  }

  @override
  void dispose() {
    if (_liveActive) {
      _liveActive = false;
      widget.liveActivities?.end();
    }
    _ticker?.cancel();
    _calls.removeListener(_onChange);
    final calls = _calls;
    final owned = widget.controller == null;
    unawaited(() async {
      await calls.end(silent: true);
      if (owned) calls.dispose();
    }());
    super.dispose();
  }

  String get _statusText {
    return switch (_calls.phase) {
      CallPhase.idle => 'Ready',
      CallPhase.starting => 'Connecting…',
      CallPhase.live => _calls.hearing ? 'Live' : 'Connected…',
      CallPhase.ending => 'Hanging up…',
      CallPhase.ended => 'Call ended',
      CallPhase.failed => _calls.notice ?? 'Call failed',
    };
  }

  String _clock(Duration elapsed) {
    final total = elapsed.inSeconds.clamp(0, 359999);
    final minutes = (total ~/ 60).toString().padLeft(2, '0');
    final seconds = (total % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final live = _calls.phase == CallPhase.live;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Live call'),
        leading: IconButton(
          icon: const Icon(Icons.expand_more),
          tooltip: 'Back to chat',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              CircleAvatar(
                radius: 48,
                child: Text(
                  widget.bot.name.isEmpty ? '?' : widget.bot.name[0],
                  style: Theme.of(context).textTheme.displaySmall,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                widget.bot.name,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 4),
              Text(
                widget.thread.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
              const SizedBox(height: 16),
              // The on-line indicator: green pulse + Live + elapsed clock.
              // Failure text wraps; a single-line row overflows the phone.
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _PulseDot(active: live),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      _statusText,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: live ? Colors.green : null,
                      ),
                    ),
                  ),
                  if (live) ...[
                    const SizedBox(width: 8),
                    Text(
                      _clock(_elapsed),
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ],
              ),
              if (_calls.phase == CallPhase.failed &&
                  _calls.failure == CallFailure.needsKey)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: FilledButton.tonal(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('Back to chat'),
                  ),
                ),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _CallButton(
                    icon: _calls.muted ? Icons.mic_off : Icons.mic,
                    label: _calls.muted ? 'Unmute' : 'Mute',
                    onPressed: !live
                        ? null
                        : () => _calls.setMuted(!_calls.muted),
                  ),
                  _CallButton(
                    icon: _calls.speaker
                        ? Icons.volume_up
                        : Icons.volume_down_outlined,
                    label: 'Speaker',
                    onPressed: !live
                        ? null
                        : () => _calls.setSpeaker(!_calls.speaker),
                  ),
                  _CallButton(
                    icon: Icons.call_end,
                    label: 'End',
                    danger: true,
                    onPressed:
                        live ||
                            _calls.phase == CallPhase.starting
                        ? () => _calls.end()
                        : null,
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.active});
  final bool active;

  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.active) {
      return Container(
        width: 12,
        height: 12,
        decoration: BoxDecoration(
          color: Theme.of(
            context,
          ).colorScheme.onSurface.withValues(alpha: 0.3),
          shape: BoxShape.circle,
        ),
      );
    }
    return FadeTransition(
      opacity: Tween(
        begin: 1.0,
        end: 0.35,
      ).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
      child: Container(
        width: 12,
        height: 12,
        decoration: const BoxDecoration(
          color: Colors.green,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

class _CallButton extends StatelessWidget {
  const _CallButton({
    required this.icon,
    required this.label,
    this.onPressed,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton.filled(
          iconSize: 28,
          style: danger
              ? IconButton.styleFrom(backgroundColor: scheme.error)
              : null,
          onPressed: onPressed,
          icon: Icon(icon),
        ),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.labelMedium),
      ],
    );
  }
}
