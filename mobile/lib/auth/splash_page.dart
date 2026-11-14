import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Cold-start brand screen: holds until [ready] and a short beat have passed,
/// then reveals [child]. Matches Ember & Paper so the native launch handoff
/// does not flash white.
class SplashGate extends StatefulWidget {
  const SplashGate({
    super.key,
    required this.ready,
    required this.child,
    this.minDuration = const Duration(milliseconds: 1100),
  });

  final bool ready;
  final Widget child;
  final Duration minDuration;

  @override
  State<SplashGate> createState() => _SplashGateState();
}

class _SplashGateState extends State<SplashGate> {
  late final DateTime _started = DateTime.now();
  bool _showChild = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(SplashGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.ready && !oldWidget.ready) _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    if (!widget.ready || _showChild) return;
    final elapsed = DateTime.now().difference(_started);
    final wait = widget.minDuration - elapsed;
    if (wait <= Duration.zero) {
      setState(() => _showChild = true);
      return;
    }
    _timer = Timer(wait, () {
      if (mounted) setState(() => _showChild = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_showChild) return widget.child;
    return const SplashPage();
  }
}

class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _motion;

  @override
  void initState() {
    super.initState();
    _motion = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..forward();
  }

  @override
  void dispose() {
    _motion.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final reduce = MediaQuery.disableAnimationsOf(context);
    final paper = dark ? MaxTokens.darkSurface : MaxTokens.paper;
    final ink = dark ? MaxTokens.darkInkText : MaxTokens.ink;

    return Scaffold(
      backgroundColor: paper,
      body: AnimatedBuilder(
        animation: _motion,
        builder: (context, _) {
          final t = reduce ? 1.0 : Curves.easeOutCubic.transform(_motion.value);
          final glow = reduce
              ? 0.22
              : (0.12 + 0.18 * math.sin(_motion.value * math.pi));
          final markScale = reduce ? 1.0 : (0.86 + 0.14 * t);
          final markOpacity = reduce ? 1.0 : t.clamp(0.0, 1.0);
          final copyOpacity = reduce
              ? 1.0
              : Curves.easeOut.transform(((_motion.value - 0.28) / 0.55).clamp(0.0, 1.0));
          final copyLift = reduce ? 0.0 : (14 * (1 - copyOpacity));

          return Stack(
            fit: StackFit.expand,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: const Alignment(0, -0.18),
                    radius: 1.05,
                    colors: [
                      MaxTokens.ember.withValues(alpha: glow),
                      paper,
                    ],
                    stops: const [0.0, 0.72],
                  ),
                ),
              ),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 28),
                  child: Column(
                    children: [
                      const Spacer(flex: 5),
                      Opacity(
                        opacity: markOpacity,
                        child: Transform.scale(
                          scale: markScale,
                          child: const _SplashMark(size: 148),
                        ),
                      ),
                      const SizedBox(height: 28),
                      Opacity(
                        opacity: copyOpacity,
                        child: Transform.translate(
                          offset: Offset(0, copyLift),
                          child: Column(
                            children: [
                              Text(
                                'Maximus',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 42,
                                  height: 1.05,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: -1.2,
                                  color: ink,
                                ),
                              ),
                              const SizedBox(height: 10),
                              Text(
                                'Your proactive AI teammate',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 16,
                                  height: 1.35,
                                  fontWeight: FontWeight.w500,
                                  letterSpacing: 0.1,
                                  color: dark
                                      ? MaxTokens.darkMutedText
                                      : MaxTokens.lightMutedText,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const Spacer(flex: 6),
                      Opacity(
                        opacity: copyOpacity * 0.55,
                        child: Text(
                          'MaximusBot',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 1.6,
                            color: dark
                                ? MaxTokens.darkMutedText
                                : MaxTokens.lightMutedText,
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SplashMark extends StatelessWidget {
  const _SplashMark({required this.size});
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: MaxTokens.ember.withValues(alpha: 0.28),
              blurRadius: 36,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Image.asset(
          'assets/brand/bull-avatar.png',
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }
}
