import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Component gallery: proves every design token in light/dark/dynamic-type.
/// Phase 0 home screen; the real home replaces it in Phase 1.
class GalleryPage extends StatelessWidget {
  const GalleryPage({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Maximus · Gallery')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const MaximusMark(size: 56),
          const SizedBox(height: 12),
          Text('Ember & Paper', style: Theme.of(context).textTheme.displaySmall),
          Text(
            'One token set drives light, dark, and dynamic type.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          const _Section('Actions'),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(onPressed: () {}, child: const Text('Send')),
              OutlinedButton(onPressed: () {}, child: const Text('Discard')),
              TextButton(onPressed: () {}, child: const Text('Retry')),
            ],
          ),
          const _Section('Chat bubbles'),
          const _Bubble(mine: false, text: 'Morning brief is ready: 3 mails need you.'),
          const _Bubble(mine: true, text: 'Show me the first one.'),
          const _Section('Cards'),
          Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: scheme.primary,
                child: Text('M', style: TextStyle(color: scheme.onPrimary)),
              ),
              title: const Text('Max'),
              subtitle: const Text('working · replying in #general'),
              trailing: const Chip(label: Text('unread')),
            ),
          ),
          const _Section('Approval card'),
          Card(
            color: scheme.surfaceContainerHighest,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Send campaign draft?', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      FilledButton(onPressed: () {}, child: const Text('Allow once')),
                      const SizedBox(width: 8),
                      OutlinedButton(onPressed: () {}, child: const Text('Deny')),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const _Section('Input'),
          const TextField(
            decoration: InputDecoration(
              hintText: 'Message Max…',
              suffixIcon: Icon(Icons.mic_outlined),
            ),
          ),
          const _Section('Presence'),
          Wrap(
            spacing: 8,
            children: [
              Chip(
                avatar: const Icon(Icons.circle, size: 12, color: Colors.green),
                label: const Text('idle'),
              ),
              Chip(
                avatar: Icon(Icons.circle, size: 12, color: scheme.primary),
                label: const Text('working'),
              ),
              Chip(
                avatar: Icon(Icons.circle, size: 12, color: scheme.error),
                label: const Text('waiting on you'),
              ),
            ],
          ),
          const _Section('Toggles'),
          SwitchListTile(
            value: true,
            onChanged: (_) {},
            title: const Text('Notifications'),
          ),
          SwitchListTile(
            value: false,
            onChanged: (_) {},
            title: const Text('Haptics'),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 20, bottom: 8),
      child: Text(title, style: Theme.of(context).textTheme.titleSmall),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.mine, required this.text});
  final bool mine;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(
          color: mine ? scheme.primary : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(MaxTokens.radiusBubble),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: mine ? scheme.onPrimary : scheme.onSurface,
          ),
        ),
      ),
    );
  }
}

/// Two-tone Maximus M: paper stroke + ember crossbar on ink.
class MaximusMark extends StatelessWidget {
  const MaximusMark({super.key, this.size = 48});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: SizedBox.square(
        dimension: size,
        child: CustomPaint(painter: _MarkPainter()),
      ),
    );
  }
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final bg = Paint()..color = MaxTokens.ink;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Offset.zero & size,
        const Radius.circular(12),
      ),
      bg,
    );
    final paper = Paint()
      ..color = MaxTokens.paper
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.11
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(w * 0.22, h * 0.78)
      ..lineTo(w * 0.22, h * 0.24)
      ..lineTo(w * 0.5, h * 0.55)
      ..lineTo(w * 0.78, h * 0.24)
      ..lineTo(w * 0.78, h * 0.78);
    canvas.drawPath(path, paper);
    final ember = Paint()
      ..color = MaxTokens.emberBright
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.09
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(
      Offset(w * 0.22, h * 0.78),
      Offset(w * 0.78, h * 0.78),
      ember,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
