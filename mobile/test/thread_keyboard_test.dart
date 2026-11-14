import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/chat/drafts.dart';
import 'package:maximus/chat/thread_page.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

void main() {
  testWidgets('tapping the transcript dismisses the composer keyboard', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: ThreadPage(
          client: FakeApi(),
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks.first,
          drafts: DraftStore(memory: {}),
          imageLoader: (_, _, _) => const SizedBox.shrink(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final editable = find.byType(EditableText).last;
    final node = tester.widget<EditableText>(editable).focusNode!;

    await tester.tap(find.byType(TextField).last);
    await tester.pump();
    expect(node.hasFocus, isTrue);

    await tester.tap(find.textContaining('Morning brief').first);
    await tester.pump();
    expect(node.hasFocus, isFalse);
  });
}
