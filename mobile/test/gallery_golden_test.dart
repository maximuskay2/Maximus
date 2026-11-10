import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/gallery/gallery_page.dart';
import 'package:maximus/theme/tokens.dart';

void main() {
  Future<void> pumpGallery(
    WidgetTester tester, {
    required ThemeData theme,
    required Size surface,
  }) async {
    await tester.binding.setSurfaceSize(surface);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(theme: theme, home: const GalleryPage()),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('gallery matches the light golden', (tester) async {
    await pumpGallery(
      tester,
      theme: MaxTokens.light(),
      surface: const Size(390, 1400),
    );
    await expectLater(
      find.byType(GalleryPage),
      matchesGoldenFile('goldens/gallery_light.png'),
    );
  });

  testWidgets('gallery matches the dark golden', (tester) async {
    await pumpGallery(
      tester,
      theme: MaxTokens.dark(),
      surface: const Size(390, 1400),
    );
    await expectLater(
      find.byType(GalleryPage),
      matchesGoldenFile('goldens/gallery_dark.png'),
    );
  });
}
