import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/bots/bot_pages.dart';
import 'package:maximus/chat/composer.dart';
import 'package:maximus/chat/message_bubble.dart';
import 'package:maximus/chat/drafts.dart';
import 'package:maximus/chat/thread_page.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

Widget _themed(Widget home) =>
    MaterialApp(theme: MaxTokens.light(), home: home);

Widget _fakeImage(
  BuildContext context,
  String url,
  Map<String, String> headers,
) => Text('img:$url', textDirection: TextDirection.ltr);

Future<AuthState> _authWith(FakeApi api) async {
  final store = MemorySessionStore();
  await store.saveServer(
    const ServerRef(id: 'h', name: 'Home', baseUrl: 'https://h.example'),
  );
  final auth = AuthState(store: store, client: api);
  await auth.load();
  return auth;
}

void main() {
  testWidgets('composer sends and clears', (tester) async {
    OutgoingMessage? got;
    await tester.pumpWidget(
      _themed(
        Scaffold(
          body: Composer(
            threadId: 't1',
            drafts: DraftStore(memory: {}),
            botNames: const ['Max', 'Scout'],
            onSend: (m) async => got = m,
            onStop: () async {},
            sending: false,
            working: false,
            onAttach: () async => const [],
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'hello bot');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    expect(got?.text, 'hello bot');
    expect(find.text('hello bot'), findsNothing);
  });

  testWidgets('composer draft restores', (tester) async {
    final memory = <String, String>{};
    Widget composer() => _themed(
      Scaffold(
        body: Composer(
          threadId: 't1',
          drafts: DraftStore(memory: memory),
          botNames: const [],
          onSend: (_) async {},
          onStop: () async {},
          sending: false,
          working: false,
          onAttach: () async => const [],
        ),
      ),
    );
    await tester.pumpWidget(composer());
    await tester.enterText(find.byType(TextField), 'unsent draft');
    await tester.pumpWidget(_themed(const Scaffold(body: Text('away'))));
    await tester.pumpWidget(composer());
    await tester.pump();
    expect(find.text('unsent draft'), findsOneWidget);
  });

  testWidgets('composer @ mentions autocomplete', (tester) async {
    await tester.pumpWidget(
      _themed(
        Scaffold(
          body: Composer(
            threadId: 't1',
            drafts: DraftStore(memory: {}),
            botNames: const ['Max', 'Scout'],
            onSend: (_) async {},
            onStop: () async {},
            sending: false,
            working: false,
            onAttach: () async => const [],
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'hey @Sc');
    await tester.pump();
    expect(find.text('Scout'), findsOneWidget);
    await tester.tap(find.text('Scout'));
    await tester.pump();
    expect(find.text('hey @Scout '), findsOneWidget);
  });

  testWidgets('thread applies live message + patch frames', (tester) async {
    final events = StreamController<LiveEvent>.broadcast();
    addTearDown(events.close);
    await tester.pumpWidget(
      _themed(
        ThreadPage(
          client: FakeApi(),
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks.first,
          imageLoader: _fakeImage,
          drafts: DraftStore(memory: {}),
          eventStream: events.stream,
        ),
      ),
    );
    await tester.pumpAndSettle();
    events.add(
      LiveEvent(
        kind: 'message',
        data: {
          'threadId': 't1',
          'message': {
            'id': 'live1',
            'role': 'bot',
            'kind': 'text',
            'text': 'streaming…',
          },
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('streaming'), findsOneWidget);
    // Patch frame updates the same bubble in place.
    events.add(
      LiveEvent(
        kind: 'message.patch',
        data: {
          'threadId': 't1',
          'message': {
            'id': 'live1',
            'role': 'bot',
            'kind': 'text',
            'text': 'streaming… done',
          },
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('done'), findsOneWidget);
    // Other threads are ignored.
    events.add(
      LiveEvent(
        kind: 'message',
        data: {
          'threadId': 'other',
          'message': {'id': 'x', 'role': 'bot', 'kind': 'text', 'text': 'nope'},
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('nope'), findsNothing);
  });

  testWidgets('blank activity rows collapse into one thinking indicator', (
    tester,
  ) async {
    final api = FakeApi();
    final events = StreamController<LiveEvent>();
    addTearDown(events.close);
    await tester.pumpWidget(
      _themed(
        ThreadPage(
          client: api,
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks.first,
          imageLoader: _fakeImage,
          drafts: DraftStore(memory: {}),
          eventStream: events.stream,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ThinkingBubble), findsNothing);

    for (var i = 0; i < 4; i++) {
      events.add(
        LiveEvent(
          kind: 'message',
          data: {
            'threadId': 't1',
            'message': {
              'id': 'act$i',
              'role': 'bot',
              'kind': 'activity',
              'text': '',
            },
          },
        ),
      );
    }
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(ThinkingBubble), findsOneWidget);
    expect(find.byTooltip('Reply'), findsNWidgets(2));

    events.add(
      LiveEvent(
        kind: 'message',
        data: {
          'threadId': 't1',
          'message': {
            'id': 'done',
            'role': 'bot',
            'kind': 'text',
            'text': 'Here is the answer.',
          },
        },
      ),
    );
    await tester.pump();
    expect(find.textContaining('Here is the answer'), findsOneWidget);
    expect(find.byType(ThinkingBubble), findsNothing);
    expect(find.byTooltip('Reply'), findsNWidgets(3));

    events.add(
      LiveEvent(
        kind: 'message',
        data: {
          'threadId': 't1',
          'message': {
            'id': 'dig',
            'role': 'bot',
            'kind': 'digest',
            'text':
                '[digest] · tools: list_dir ×2, search_tool ×2 (from tool previews) · reply: Here is the answer.',
          },
        },
      ),
    );
    await tester.pump();
    expect(find.textContaining('list_dir'), findsNothing);
    expect(find.textContaining('Here is the answer'), findsOneWidget);
    expect(find.byTooltip('Reply'), findsNWidgets(3));
  });

  testWidgets('thread send + stop', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      _themed(
        ThreadPage(
          client: api,
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks.first,
          imageLoader: _fakeImage,
          drafts: DraftStore(memory: {}),
          eventStream: const Stream.empty(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'question for Max');
    await tester.pump();
    await tester.tap(find.byTooltip('Send'));
    // The thinking indicator keeps a ticker running, so this must not
    // wait for the tree to go idle.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(api.sent, ['question for Max']);
    await tester.pump(const Duration(milliseconds: 50));
    // Working state shows Stop.
    expect(find.byTooltip('Stop'), findsOneWidget);
    await tester.tap(find.byTooltip('Stop'));
    await tester.pump();
    expect(api.interrupted, ['t1']);
  });

  testWidgets('bots tab creates a bot', (tester) async {
    final api = FakeApi();
    final auth = await _authWith(api);
    await auth.pair(
      baseUrl: 'https://h.example',
      code: 'AAAA-AAAA-AAAA',
      label: 'test',
    );
    var refreshed = 0;
    await tester.pumpWidget(
      _themed(
        BotsTab(
          auth: auth,
          bots: FakeApi.botsPayload,
          onRefresh: () async => refreshed++,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('New bot'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Helper 2');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(refreshed, 1);
  });

  testWidgets('bot profile edit saves via patchBot', (tester) async {
    final api = FakeApi();
    BotSummary? changed;
    await tester.pumpWidget(
      _themed(
        BotProfilePage(
          client: api,
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          canEdit: true,
          onChanged: (bot) => changed = bot,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Edit bot'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Maximus');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(changed?.name, 'Maximus');
  });

  testWidgets('draft store round-trips per thread', (tester) async {
    final drafts = DraftStore(memory: {});
    expect(await drafts.read('t1'), isNull);
    await drafts.write('t1', 'hello');
    expect(await drafts.read('t1'), 'hello');
    expect(await drafts.read('t2'), isNull);
    await drafts.clear('t1');
    expect(await drafts.read('t1'), isNull);
  });
}
