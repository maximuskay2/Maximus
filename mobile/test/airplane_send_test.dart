import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/drafts.dart';
import 'package:maximus/chat/send_outbox.dart';
import 'package:maximus/chat/thread_page.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

Widget _page(
  FakeApi api, {
  Stream<LiveEvent>? events,
  SendOutbox? outbox,
  Key? key,
}) => MaterialApp(
  theme: MaxTokens.light(),
  home: ThreadPage(
    key: key,
    client: api,
    baseUrl: 'https://h.example',
    bot: FakeApi.botsPayload.first,
    thread: FakeApi.botsPayload.first.tasks.first,
    drafts: DraftStore(memory: {}),
    outbox: outbox ?? SendOutbox(memory: {}),
    eventStream: events ?? const Stream.empty(),
    imageLoader: (_, _, _) => const SizedBox.shrink(),
  ),
);

void main() {
  testWidgets('a failed send is a retry button, not a second optimistic row', (
    tester,
  ) async {
    final api = FakeApi()..failNextSend = true;
    await tester.pumpWidget(_page(api));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).last, 'hello after radio');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();
    await tester.pump();

    expect(find.text('hello after radio'), findsOneWidget);
    expect(find.text('offline'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(api.sent, ['hello after radio']);
    expect(api.sendIds, isNotEmpty);
    expect(api.sendIds.first, isNotNull);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    await tester.pump();
    expect(api.sent, ['hello after radio', 'hello after radio']);
    expect(api.sendIds[0], api.sendIds[1]);
    expect(find.text('hello after radio'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
  });

  testWidgets('a live message replaces the optimistic row instead of duplicating it', (
    tester,
  ) async {
    final events = StreamController<LiveEvent>.broadcast();
    addTearDown(events.close);
    final api = FakeApi();
    await tester.pumpWidget(_page(api, events: events.stream));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).last, 'same line');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();

    events.add(
      LiveEvent(
        kind: 'message',
        data: {
          'threadId': 't1',
          'message': {
            'id': 'server-1',
            'role': 'user',
            'kind': 'text',
            'text': 'same line',
          },
        },
      ),
    );
    await tester.pump();
    expect(find.text('same line'), findsOneWidget);
  });

  testWidgets('hello without a resume cursor reloads missed messages', (
    tester,
  ) async {
    final events = StreamController<LiveEvent>.broadcast();
    addTearDown(events.close);
    final api = FakeApi();
    await tester.pumpWidget(_page(api, events: events.stream));
    await tester.pumpAndSettle();
    expect(api.threadMessageCalls, ['t1']);
    events.add(
      const LiveEvent(kind: 'hello', data: {'cursor': 'ab:1', 'resumed': true}),
    );
    await tester.pump();

    api.extraMessages = [
      ChatMessage.fromJson({
        'id': 'm3',
        'role': 'bot',
        'kind': 'text',
        'text': 'missed while the radio was off',
      }),
    ];
    events.add(
      const LiveEvent(kind: 'hello', data: {'cursor': 'ab:2', 'resumed': false}),
    );
    await tester.pump();
    await tester.pump();
    expect(api.threadMessageCalls.length, greaterThan(1));
    expect(find.text('missed while the radio was off'), findsOneWidget);
  });

  testWidgets('a queued send survives leaving the thread and flushes with the same sendId', (
    tester,
  ) async {
    final memory = <String, String>{};
    final outbox = SendOutbox(memory: memory);
    final api = FakeApi()..failNextSend = true;
    await tester.pumpWidget(_page(api, outbox: outbox));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'queued while offline');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();
    await tester.pump();
    expect(find.text('queued while offline'), findsOneWidget);
    final sendId = api.sendIds.single;
    expect((await outbox.pending('t1')).single.sendId, sendId);

    api.failNextSend = false;
    await tester.pumpWidget(
      _page(
        api,
        outbox: SendOutbox(memory: memory),
        key: const ValueKey('reopen'),
      ),
    );
    for (var i = 0; i < 40; i++) {
      final visible = find.text('queued while offline').evaluate().isNotEmpty;
      final spinning = find.byType(CircularProgressIndicator).evaluate().isNotEmpty;
      if (api.sent.length >= 2 && visible && !spinning) break;
      await tester.pump();
    }
    expect(api.sent.length, greaterThanOrEqualTo(2));
    expect(api.sent.toSet(), {'queued while offline'});
    expect(api.sendIds.toSet(), {sendId});
    expect(find.text('queued while offline'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
  });
}
