import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/settings/preferences.dart';
import 'fake_api.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/bots/bot_pages.dart';
import 'package:maximus/chat/thread_page.dart';
import 'package:maximus/home/home_page.dart';
import 'package:maximus/search/search_page.dart';
import 'package:maximus/theme/tokens.dart';

Widget _themed(Widget home) =>
    MaterialApp(theme: MaxTokens.light(), home: home);

Widget _fakeImage(BuildContext context, String url, Map<String, String> headers) =>
    Text('img:$url', textDirection: TextDirection.ltr);

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
  testWidgets('inbox lists bots and the latest thread', (tester) async {
    await tester.pumpWidget(_themed(HomePage(auth: await _authWith(FakeApi()), prefs: AppPreferences())));
    await tester.pumpAndSettle();
    expect(find.text('Max'), findsOneWidget);
    expect(find.text('Scout'), findsOneWidget);
    expect(find.text('Morning brief'), findsOneWidget);
    expect(find.text('Search'), findsOneWidget);
  });

  testWidgets('an expired session opens sign-in', (tester) async {
    final store = MemorySessionStore();
    await store.saveServer(const ServerRef(
      id: 'h',
      name: 'Home',
      baseUrl: 'https://h.example',
      companionToken: 'maximus_sess_old',
    ));
    final auth = AuthState(store: store, client: FakeApi(unauthorizedBots: true));
    await auth.load();
    await tester.pumpWidget(_themed(HomePage(auth: auth, prefs: AppPreferences())));
    await tester.pumpAndSettle();
    expect(auth.needsSignIn, isTrue);
    expect(auth.active?.companionToken, isNull);
    expect(find.text('Retry'), findsNothing);
  });

  testWidgets('home shows the error state with retry', (tester) async {
    await tester.pumpWidget(
      _themed(HomePage(auth: await _authWith(FakeApi(failBots: true)), prefs: AppPreferences())),
    );
    await tester.pumpAndSettle();
    expect(find.text('down'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('apps sheet opens the bots directory', (tester) async {
    await tester.pumpWidget(_themed(HomePage(auth: await _authWith(FakeApi()), prefs: AppPreferences())));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.grid_view_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bots & rooms'));
    await tester.pumpAndSettle();
    expect(find.text('Bots'), findsOneWidget);
    expect(find.text('Max'), findsWidgets);
    expect(find.text('Scout'), findsWidgets);
  });

  testWidgets('bots tab scrolls many rooms without overflowing',
      (tester) async {
    final api = FakeApi()
      ..groupsPayload = [
        for (var i = 0; i < 20; i++)
          GroupSummary(id: 'g$i', name: 'Room $i', threadId: 'tg$i'),
      ];
    final auth = await _authWith(api);
    await tester.pumpWidget(
      _themed(BotsTab(auth: auth, bots: FakeApi.botsPayload, onRefresh: () async {})),
    );
    await tester.pumpAndSettle();
    expect(find.text('Rooms'), findsOneWidget);
    // The last room is reachable by scrolling, not laid out past the edge
    // (a RenderFlex overflow fails this test on settle).
    await tester.drag(find.text('Room 0'), const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(find.text('Room 19'), findsOneWidget);
  });

  testWidgets('bot profile pins and archives via swipe', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      _themed(
        BotProfilePage(
          client: api,
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.text('Morning brief'), const Offset(400, 0));
    await tester.pumpAndSettle();
    expect(
      api.patches.any(
        (p) => p['threadId'] == 't1' && p['pinned'] == true,
      ),
      isTrue,
    );
    await tester.drag(find.text('Pinned plan'), const Offset(-400, 0));
    await tester.pumpAndSettle();
    expect(
      api.patches.any(
        (p) => p['threadId'] == 't2' && p.containsKey('archivedAt'),
      ),
      isTrue,
    );
    expect(find.text('Pinned plan'), findsNothing);
  });

  testWidgets('bot profile library aggregates attachments', (tester) async {
    await tester.pumpWidget(
      _themed(
        BotProfilePage(
          client: FakeApi(),
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Library'));
    await tester.pumpAndSettle();
    expect(find.text('chart.png'), findsOneWidget);
  });

  testWidgets('thread page renders transcript + image loader', (tester) async {
    await tester.pumpWidget(
      _themed(
        ThreadPage(
          client: FakeApi(),
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks.first,
          imageLoader: _fakeImage,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('there'), findsOneWidget);
    expect(find.textContaining('Morning brief is ready'), findsOneWidget);
    expect(
      find.textContaining('img:https://h.example/api/a/1.png'),
      findsOneWidget,
    );
  });

  testWidgets('thread page shows the empty state', (tester) async {
    await tester.pumpWidget(
      _themed(
        ThreadPage(
          client: FakeApi(),
          baseUrl: 'https://h.example',
          bot: FakeApi.botsPayload.first,
          thread: FakeApi.botsPayload.first.tasks[1],
          imageLoader: _fakeImage,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No messages yet'), findsOneWidget);
  });

  testWidgets('search page searches and lists hits', (tester) async {
    await tester.pumpWidget(
      _themed(SearchPage(client: FakeApi(), baseUrl: 'https://h.example')),
    );
    await tester.enterText(find.byType(SearchBar), 'hi');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(find.text('hi there'), findsOneWidget);
    expect(find.text('Max'), findsOneWidget);
  });
}
