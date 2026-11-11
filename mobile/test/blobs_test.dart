import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/theme/blobs.dart';

void main() {
  testWidgets('BotBlob paints the colorizable bull', (tester) async {
    await tester.binding.setSurfaceSize(const Size(200, 80));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      const MaterialApp(
        home: ColoredBox(
          color: Colors.white,
          child: Row(
            children: [
              BotBlob(color: 'pink', seed: 'ada', size: 36),
              BotBlob(color: 'green', seed: 'ada', size: 36),
              BotBlob(color: 'blue', seed: 'ada', size: 36),
            ],
          ),
        ),
      ),
    );
    expect(find.byType(BotBlob), findsNWidgets(3));
    expect(find.byType(Image), findsNWidgets(3));
  });
}
