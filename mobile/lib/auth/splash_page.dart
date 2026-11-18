import 'dart:async';

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
    this.minDuration = const Duration(milliseconds: 900),
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
  late final AnimationController _fade;

  @override
  void initState() {
    super.initState();
    _fade = AnimationController(
      vsync: this,
      duration: MaxTokens.motionMedium,
    )..forward();
  }

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final reduce = MediaQuery.disableAnimationsOf(context);
    final paper = dark ? MaxTokens.darkSurface : MaxTokens.paper;
    final ink = dark ? MaxTokens.darkInkText : MaxTokens.ink;
    final mark = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox.square(
          dimension: 96,
          child: Image(
            image: AssetImage('assets/brand/bull-avatar.png'),
            fit: BoxFit.contain,
            filterQuality: FilterQuality.high,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Maximus',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 28,
            height: 1.1,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.6,
            color: ink,
          ),
        ),
      ],
    );

    return Scaffold(
      backgroundColor: paper,
      body: Semantics(
        label: 'Maximus',
        child: Center(
          child: reduce
              ? mark
              : FadeTransition(
                  opacity: CurvedAnimation(parent: _fade, curve: Curves.easeOut),
                  child: mark,
                ),
        ),
      ),
    );
  }
}
