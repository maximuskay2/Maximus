import 'package:flutter/material.dart';

/// Face ids the create sheet can still send. Desktop now paints one bull for all of them.
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

/// Colorizable bull avatar. [shape] is kept for API round-trips; every shape paints the same bull.
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
    final tint = blobColor(color);
    return SizedBox(
      width: size,
      height: size,
      child: ColorFiltered(
        // Impeller treats BlendMode.color as a page-sized tint, so a green bot turns the home screen green.
        colorFilter: ColorFilter.mode(tint, BlendMode.srcIn),
        child: Image.asset(
          'assets/brand/bull-avatar.png',
          width: size,
          height: size,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
          gaplessPlayback: true,
        ),
      ),
    );
  }
}
