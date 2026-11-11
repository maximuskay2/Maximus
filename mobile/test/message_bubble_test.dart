import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/message_bubble.dart';

void main() {
  const message = ChatMessage(
    id: 'm1',
    role: 'user',
    kind: 'text',
    text: 'hello',
  );

  Widget bubble({void Function(ChatMessage)? onReply, void Function(ChatMessage)? onReact}) {
    return MaterialApp(
      home: Scaffold(
        body: MessageBubble(
          message: message,
          baseUrl: 'https://h.example',
          headers: const {},
          onReply: onReply,
          onReact: onReact,
        ),
      ),
    );
  }

  testWidgets('reply and react stay hidden until a long press', (tester) async {
    await tester.pumpWidget(bubble(onReply: (_) {}, onReact: (_) {}));
    expect(find.byTooltip('Reply'), findsNothing);
    expect(find.byTooltip('React'), findsNothing);

    await tester.longPress(find.text('hello'));
    await tester.pump();
    expect(find.byTooltip('Reply'), findsOneWidget);
    expect(find.byTooltip('React'), findsOneWidget);

    await tester.tap(find.byTooltip('Reply'));
    await tester.pump();
    expect(find.byTooltip('Reply'), findsNothing);
  });

  testWidgets('sliding a message replies', (tester) async {
    ChatMessage? replied;
    await tester.pumpWidget(bubble(onReply: (message) => replied = message));
    await tester.drag(find.text('hello'), const Offset(80, 0));
    await tester.pump();
    expect(replied?.id, 'm1');
    expect(find.byTooltip('Reply'), findsNothing);
  });
}
