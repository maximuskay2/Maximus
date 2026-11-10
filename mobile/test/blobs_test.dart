import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/theme/blobs.dart';

void main() {
  testWidgets('every body paints a face', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 120));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: ColoredBox(
          color: Colors.white,
          child: Row(
            children: [
              for (final shape in blobShapes)
                BotBlob(color: 'pink', seed: 'ada-$shape', shape: shape, size: 36),
            ],
          ),
        ),
      ),
    );
    expect(find.byType(BotBlob), findsNWidgets(blobShapes.length));
    await expectLater(
      find.byType(Row),
      matchesGoldenFile('goldens/bot_faces.png'),
    );
  });
}
