import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/chat/drafts.dart';
import 'package:maximus/chat/thread_page.dart';
import 'package:maximus/system/app_link.dart';
import 'package:maximus/system/deep_link_router.dart';
import 'package:maximus/system/live_activities.dart';

import 'fake_api.dart';

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
  group('AppLink.parse', () {
    test('bots', () {
      final link = AppLink.parse(Uri.parse('maximus://bots'));
      expect(link, isNotNull);
      expect(link!.kind, AppLinkKind.bots);
    });

    test('thread with prefill', () {
      final link = AppLink.parse(
        Uri.parse('maximus://thread?thread=t2&text=hello%20there'),
      );
      expect(link!.kind, AppLinkKind.thread);
      expect(link.threadId, 't2');
      expect(link.text, 'hello there');
    });

    test('dictate by bot name', () {
      final link = AppLink.parse(
        Uri.parse('maximus://dictate?bot=Scout'),
      );
      expect(link!.kind, AppLinkKind.dictate);
      expect(link.botName, 'Scout');
    });

    test('call prefers thread over name', () {
      final link = AppLink.parse(
        Uri.parse('maximus://call?thread=t1&bot=Max'),
      );
      expect(link!.kind, AppLinkKind.call);
      expect(link.threadId, 't1');
    });

    test('share prefills composer text', () {
      final link = AppLink.parse(
        Uri.parse('maximus://share?text=look%20at%20this'),
      );
      expect(link!.kind, AppLinkKind.share);
      expect(link.text, 'look at this');
    });

    test('rejects other schemes and hosts', () {
      expect(AppLink.parse(Uri.parse('https://bots')), isNull);
      expect(AppLink.parse(Uri.parse('maximus://nope')), isNull);
    });

    test('blank query values become null', () {
      final link = AppLink.parse(Uri.parse('maximus://dictate?bot=%20'));
      expect(link!.botName, isNull);
    });
  });

  group('resolveBotName', () {
    final bots = FakeApi.botsPayload;

    test('exact match wins', () {
      expect(resolveBotName(bots, 'Max')!.id, 'b1');
    });

    test('case-insensitive + prefix + substring', () {
      expect(resolveBotName(bots, 'scout')!.id, 'b2');
      expect(resolveBotName(bots, 'sco')!.id, 'b2');
      expect(resolveBotName(bots, 'cou')!.id, 'b2');
    });

    test('no match and empty input', () {
      expect(resolveBotName(bots, 'Nobody'), isNull);
      expect(resolveBotName(bots, '  '), isNull);
      expect(resolveBotName(const [], 'Max'), isNull);
    });
  });

  group('LiveActivities channel', () {
    late List<MethodCall> calls;

    setUp(() {
      TestWidgetsFlutterBinding.ensureInitialized();
      calls = [];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel('maximus/live_activities'),
            (call) async {
              calls.add(call);
              return call.method == 'start' ? true : null;
            },
          );
    });

    test('start sends kind + bot + caption', () async {
      final live = LiveActivities(supportedOverride: true);
      expect(
        await live.start(
          kind: 'dictate',
          botName: 'Scout',
          caption: 'Listening…',
        ),
        isTrue,
      );
      expect(calls.single.method, 'start');
      expect(
        calls.single.arguments,
        {'kind': 'dictate', 'botName': 'Scout', 'caption': 'Listening…'},
      );
    });

    test('update omits nulls; end + syncBots send shapes', () async {
      final live = LiveActivities(supportedOverride: true);
      await live.update(status: 'live', elapsedSeconds: 7);
      expect(calls.single.arguments, {
        'status': 'live',
        'elapsedSeconds': 7,
      });
      await live.end();
      expect(calls.last.method, 'end');
      await live.syncBots(const [
        ['b1', 'Max'],
      ]);
      expect(calls.last.arguments, {
        'bots': const [
          ['b1', 'Max'],
        ],
      });
    });

    test('unsupported hosts never touch the channel', () async {
      final live = LiveActivities(supportedOverride: false);
      expect(
        await live.start(kind: 'call', botName: 'Max'),
        isFalse,
      );
      await live.update(status: 'live');
      await live.end();
      await live.syncBots(const [
        ['b1', 'Max'],
      ]);
      expect(calls, isEmpty);
    });
  });

  group('DeepLinkRouter', () {
    testWidgets('bots link opens the bots list', (tester) async {
      final router = DeepLinkRouter(
        auth: await _authWith(FakeApi()),
        live: LiveActivities(supportedOverride: false),
        drafts: DraftStore(memory: {}),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => router.open(context, AppLink.bots),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(find.text('Bots'), findsOneWidget);
      expect(find.text('Max'), findsOneWidget);
    });

    testWidgets('thread link opens with prefill', (tester) async {
      final router = DeepLinkRouter(
        auth: await _authWith(FakeApi()),
        live: LiveActivities(supportedOverride: false),
        drafts: DraftStore(memory: {}),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => router.open(
                context,
                AppLink.parse(
                  Uri.parse('maximus://thread?thread=t2&text=hello'),
                )!,
              ),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(find.byType(ThreadPage), findsOneWidget);
      expect(find.text('hello'), findsOneWidget);
    });

    testWidgets('dictate link resolves bot name', (tester) async {
      final router = DeepLinkRouter(
        auth: await _authWith(FakeApi()),
        live: LiveActivities(supportedOverride: false),
        drafts: DraftStore(memory: {}),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => router.open(
                context,
                AppLink.parse(Uri.parse('maximus://dictate?bot=scout'))!,
              ),
              child: const Text('go'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      final page = tester.widget<ThreadPage>(find.byType(ThreadPage));
      expect(page.bot.name, 'Scout');
      expect(page.autoDictate, isTrue);
    });

    testWidgets('unknown thread explains instead of hanging', (
      tester,
    ) async {
      final router = DeepLinkRouter(
        auth: await _authWith(FakeApi()),
        live: LiveActivities(supportedOverride: false),
        drafts: DraftStore(memory: {}),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => router.open(
                  context,
                  AppLink.parse(Uri.parse('maximus://thread?thread=gone'))!,
                ),
                child: const Text('go'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('go'));
      await tester.pump();
      expect(find.text('Could not find that conversation.'), findsOneWidget);
    });

    testWidgets('signed-out link waits, then flush opens it', (
      tester,
    ) async {
      final store = MemorySessionStore();
      final auth = AuthState(store: store, client: FakeApi());
      await auth.load();
      final router = DeepLinkRouter(
        auth: auth,
        live: LiveActivities(supportedOverride: false),
      );
      late BuildContext captured;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              captured = context;
              return const Text('welcome');
            },
          ),
        ),
      );
      final opened = await router.open(captured, AppLink.bots);
      expect(opened, isFalse);
      expect(router.pending, isNotNull);
      // Sign-in activates a server; the pending link flushes.
      await store.saveServer(
        const ServerRef(id: 'h', name: 'Home', baseUrl: 'https://h.example'),
      );
      await auth.load();
      await tester.pump();
      // Not awaited: open() resolves when the pushed route pops.
      unawaited(router.flush(captured));
      await tester.pumpAndSettle();
      expect(router.pending, isNull);
      expect(find.text('Bots'), findsOneWidget);
    });
  });
}
