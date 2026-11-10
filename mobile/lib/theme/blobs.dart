import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Faces the create sheet can save. Ids match the desktop mascot bodies.
const blobShapes = [
  'blob',
  'circle',
  'squircle',
  'capsule',
  'drop',
  'shield',
  'hexagon',
  'diamond',
  'star',
  'cursor',
];

/// Named colors the harness accepts on `PATCH /api/bots/:id`.
const blobColorNames = [
  'green',
  'blue',
  'red',
  'orange',
  'purple',
  'pink',
  'yellow',
  'teal',
  'cyan',
  'coral',
  'silver',
  'chrome',
];

const blobPalette = <String, Color>{
  'green': Color(0xFF22C55E),
  'blue': Color(0xFF3B82F6),
  'red': Color(0xFFEF4444),
  'orange': Color(0xFFF97316),
  'purple': Color(0xFF8B5CF6),
  'pink': Color(0xFFFF2D87),
  'yellow': Color(0xFFF5B942),
  'teal': Color(0xFF14B8A6),
  'cyan': Color(0xFF06B6D4),
  'coral': Color(0xFFF43F5E),
  'silver': Color(0xFF9CA3AF),
  'chrome': Color(0xFF4B5563),
  'ember': Color(0xFFC2410C),
  'ink': Color(0xFF14110B),
  'brown': Color(0xFF8D6E63),
};

Color blobColor(String name) => blobPalette[name] ?? const Color(0xFF14110B);

String shapeFor(String? stored, String seed) {
  if (stored != null && blobShapes.contains(stored)) return stored;
  return blobShapes[seed.hashCode.abs() % blobShapes.length];
}

/// A character face: shaded body, pupils, and a mouth that stays put for a seed.
class BotBlob extends StatelessWidget {
  const BotBlob({
    super.key,
    required this.color,
    required this.seed,
    this.shape,
    this.size = 52,
  });

  final String color;
  final String seed;
  final String? shape;
  final double size;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.square(size),
      painter: _BlobPainter(
        color: blobColor(color),
        shape: shapeFor(shape, seed),
        face: seed.hashCode.abs(),
      ),
    );
  }
}

class _BlobPainter extends CustomPainter {
  _BlobPainter({required this.color, required this.shape, required this.face});

  final Color color;
  final String shape;
  final int face;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final path = _outline(shape, rect);
    canvas.save();
    canvas.clipPath(path);
    canvas.drawPath(
      path,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color.lerp(color, Colors.white, 0.32)!,
            color,
            Color.lerp(color, const Color(0xFF14110B), 0.22)!,
          ],
          stops: const [0, 0.42, 1],
        ).createShader(rect),
    );
    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(rect.center.dx - rect.width * 0.14, rect.top + rect.height * 0.26),
        width: rect.width * 0.36,
        height: rect.height * 0.2,
      ),
      Paint()..color = const Color(0x47FFFFFF),
    );
    _eyes(canvas, rect);
    _mouth(canvas, rect);
    canvas.restore();
  }

  void _eyes(Canvas canvas, Rect rect) {
    final w = rect.width * 0.15;
    final h = rect.height * 0.2;
    final y = rect.center.dy - rect.height * 0.05;
    final gap = rect.width * 0.14;
    final gaze = ((face % 5) - 2) * rect.width * 0.012;
    final white = Paint()..color = Colors.white;
    final pupil = Paint()..color = const Color(0xFF14110B);
    for (final side in const [-1.0, 1.0]) {
      final center = Offset(rect.center.dx + side * gap, y);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromCenter(center: center, width: w, height: h),
          Radius.circular(w),
        ),
        white,
      );
      final look = center + Offset(gaze, h * 0.08);
      canvas.drawCircle(look, w * 0.26, pupil);
      canvas.drawCircle(
        look + Offset(-w * 0.08, -h * 0.1),
        math.max(0.6, w * 0.09),
        white,
      );
    }
  }

  void _mouth(Canvas canvas, Rect rect) {
    final kind = face % 4;
    final y = rect.center.dy + rect.height * 0.2;
    final w = rect.width * (kind == 1 ? 0.22 : 0.16);
    final ink = Paint()
      ..color = const Color(0xEBFFFFFF)
      ..style = kind == 3 ? PaintingStyle.fill : PaintingStyle.stroke
      ..strokeWidth = math.max(1.1, rect.width * 0.038)
      ..strokeCap = StrokeCap.round;
    if (kind == 3) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(rect.center.dx, y),
          width: w * 0.72,
          height: w * 0.5,
        ),
        ink,
      );
      return;
    }
    final path = Path()
      ..moveTo(rect.center.dx - w, y)
      ..quadraticBezierTo(
        rect.center.dx,
        y + rect.height * (kind == 2 ? 0.035 : 0.09),
        rect.center.dx + w,
        y,
      );
    canvas.drawPath(path, ink);
  }

  @override
  bool shouldRepaint(covariant _BlobPainter old) {
    if (old.color != color || old.shape != shape) return true;
    // Flutter hot reload leaves a field added to a live painter null, and the
    // getter throws before the new painter can replace it.
    try {
      return old.face != face;
    } catch (_) {
      return true;
    }
  }
}

Path _outline(String shape, Rect rect) {
  final inset = rect.deflate(rect.width * 0.04);
  switch (shape) {
    case 'circle':
      return Path()..addOval(inset);
    case 'squircle':
      return Path()..addRRect(
        RRect.fromRectAndRadius(inset, Radius.circular(inset.width * 0.32)),
      );
    case 'capsule':
      return Path()..addRRect(
        RRect.fromRectAndRadius(inset, Radius.circular(inset.width)),
      );
    case 'drop':
      return _polygon(inset, 3, rotation: -math.pi / 2);
    case 'shield':
      return _polygon(inset, 5, rotation: -math.pi / 2);
    case 'hexagon':
      return _polygon(inset, 6, rotation: math.pi / 6);
    case 'diamond':
      return _polygon(inset, 4, rotation: 0);
    case 'star':
      return _star(inset);
    case 'cursor':
      return _polygon(inset, 3, rotation: -math.pi / 2);
    case 'blob':
    default:
      return _blob(inset);
  }
}

Path _blob(Rect rect) {
  final c = rect.center;
  final rx = rect.width * 0.48;
  final ry = rect.height * 0.44;
  final path = Path();
  const steps = 48;
  for (var i = 0; i <= steps; i++) {
    final t = i / steps * math.pi * 2;
    final wobble = 1 + 0.08 * math.sin(3 * t) + 0.05 * math.cos(5 * t);
    final p = Offset(
      c.dx + math.cos(t) * rx * wobble,
      c.dy + math.sin(t) * ry * wobble,
    );
    if (i == 0) {
      path.moveTo(p.dx, p.dy);
    } else {
      path.lineTo(p.dx, p.dy);
    }
  }
  path.close();
  return path;
}

Path _polygon(Rect rect, int sides, {required double rotation}) {
  final c = rect.center;
  final r = rect.shortestSide / 2;
  final path = Path();
  for (var i = 0; i < sides; i++) {
    final t = rotation + i * math.pi * 2 / sides;
    final p = Offset(c.dx + math.cos(t) * r, c.dy + math.sin(t) * r);
    if (i == 0) {
      path.moveTo(p.dx, p.dy);
    } else {
      path.lineTo(p.dx, p.dy);
    }
  }
  path.close();
  return path;
}

Path _star(Rect rect) {
  final c = rect.center;
  final outer = rect.shortestSide / 2;
  final inner = outer * 0.48;
  final path = Path();
  for (var i = 0; i < 10; i++) {
    final t = -math.pi / 2 + i * math.pi / 5;
    final r = i.isEven ? outer : inner;
    final p = Offset(c.dx + math.cos(t) * r, c.dy + math.sin(t) * r);
    if (i == 0) {
      path.moveTo(p.dx, p.dy);
    } else {
      path.lineTo(p.dx, p.dy);
    }
  }
  path.close();
  return path;
}
