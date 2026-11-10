import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/approval_card.dart';
import 'package:maximus/push/push_service.dart';

import 'fake_api.dart';

class FakeMessaging implements PushMessaging {
  bool granted = true;
  bool asked = true;
  String? token = 'fcm-token-abc12345678';
  final refresh = StreamController<String>.broadcast();
  final foreground = StreamController<PushTap>.broadcast();
  final opened = StreamController<PushTap>.broadcast();
  PushTap? initial;

  @override
  Future<PushPermission> permission() async =>
      !asked ? PushPermission.notAsked : granted ? PushPermission.granted : PushPermission.denied;

  @override
  Future<bool> requestPermission() async {
    asked = true;
    return granted;
  }

  @override
  Future<String?> getToken() async => token;

  @override
  Stream<String> get onTokenRefresh => refresh.stream;

  @override
  Stream<PushTap> get onForeground => foreground.stream;

  @override
  Stream<PushTap> get onOpened => opened.stream;

  @override
  Future<PushTap?> getInitialTap() async => initial;

  void close() {
    refresh.close();
    foreground.close();
    opened.close();
  }
}

Map<String, Object?> permissionCardJson() => {
  'title': 'Run tests?',
  'subtitle': 'Chief wants to run `pnpm test` in ~/app.',
  'options': ['Allow', 'Deny'],
  'requestType': 'permission',
  'requestId': 'req-1',
  'tool': 'run_command',
  'allowSession': true,
};

Map<String, Object?> questionCardJson() => {
  'title': 'Which model?',
  'subtitle': 'Pick the model for this bot.',
  'options': ['Opus', 'Sonnet'],
  'requestType': 'question',
  'requestId': 'req-2',
};

void main() {
  test('card parses from a message and round-trips', () {
    final message = ChatMessage.fromJson({
      'id': 'm1',
      'role': 'bot',
      'kind': 'text',
      'text': 'Need you.',
      'card': permissionCardJson(),
    });
    expect(message.hasCard, isTrue);
    expect(message.card, isNotNull);
    expect(message.card!.isLive, isTrue);
    expect(message.card!.isPermission, isTrue);
    final back = ChatMessage.fromJson(
      message.toJson().cast<String, Object?>(),
    );
    expect(back.card!.requestId, 'req-1');
    expect(back.card!.tool, 'run_command');
    expect(back.card!.allowSession, isTrue);
  });

  test('settled cards are not live', () {
    for (final json in [
      {'answered': 'Allowed'},
      {'answeredText': 'Sonnet'},
      {'dismissed': true},
      {'expired': true},
      {'stopped': true},
    ]) {
      final card = OptionCard.fromJson({
        'title': 't',
        'subtitle': 's',
        'requestId': 'r',
        ...json,
      });
      expect(card.isLive, isFalse, reason: '$json');
    }
  });

  test('structured questions and computer asks parse', () {
    final card = OptionCard.fromJson({
      'title': 't',
      'subtitle': 's',
      'requestType': 'question',
      'requestId': 'r',
      'questionRequest': {
        'version': 1,
        'questions': [
          {
            'question': 'Ship it?',
            'header': 'Ship',
            'multiSelect': true,
            'options': [
              {'label': 'Yes', 'description': 'do it'},
              {'label': 'No'},
            ],
          },
        ],
      },
      'computerAsk': {
        'need': 'screen',
        'reason': 'closed',
        'device': 'Mac',
        'state': 'asking',
      },
    });
    expect(card.questions, hasLength(1));
    expect(card.questions.first.options, hasLength(2));
    expect(card.questions.first.multiSelect, isTrue);
    expect(card.computerAsk!.device, 'Mac');
    final back = OptionCard.fromJson(
      card.toJson().cast<String, Object?>(),
    );
    expect(back.questions.first.header, 'Ship');
    expect(back.computerAsk!.reason, 'closed');
  });

  Future<void> noop(
    String requestId,
    String behavior, {
    String? message,
    bool always = false,
    bool dismiss = false,
  }) async {}

  Widget wrap(OptionCard card, CardAnswerer? onAnswer) => MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: ApprovalCard(card: card, onAnswer: onAnswer),
      ),
    ),
  );

  testWidgets('permission card offers allow once, deny, always allow',
      (tester) async {
    final calls = <List<Object?>>[];
    Future<void> answer(
      String requestId,
      String behavior, {
      String? message,
      bool always = false,
      bool dismiss = false,
    }) async {
      calls.add([requestId, behavior, message, always, dismiss]);
    }

    final card = OptionCard.fromJson(permissionCardJson());
    await tester.pumpWidget(wrap(card, answer));
    expect(find.text('Run tests?'), findsOneWidget);
    expect(find.text('run_command'), findsOneWidget);

    await tester.tap(find.text('Allow once'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Deny'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Always allow'));
    await tester.pumpAndSettle();
    expect(calls, [
      ['req-1', 'allow', null, false, false],
      ['req-1', 'deny', null, false, false],
      ['req-1', 'allow', null, true, false],
    ]);
  });

  testWidgets('hides always allow when the session cannot remember it',
      (tester) async {
    final card = OptionCard.fromJson({
      ...permissionCardJson(),
      'allowSession': false,
      'requestId': 'req-x',
    });
    await tester.pumpWidget(
      wrap(card, noop),
    );
    expect(find.text('Always allow'), findsNothing);
  });

  testWidgets('question options answer on tap, free text sends too',
      (tester) async {
    final calls = <List<Object?>>[];
    Future<void> answer(
      String requestId,
      String behavior, {
      String? message,
      bool always = false,
      bool dismiss = false,
    }) async {
      calls.add([requestId, behavior, message, always, dismiss]);
    }

    await tester.pumpWidget(
      wrap(OptionCard.fromJson(questionCardJson()), answer),
    );
    await tester.tap(find.text('Opus'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Sonnet please');
    await tester.tap(find.byTooltip('Send answer'));
    await tester.pumpAndSettle();
    expect(calls, [
      ['req-2', 'answer', 'Opus', false, false],
      ['req-2', 'answer', 'Sonnet please', false, false],
    ]);
  });

  testWidgets('structured questions compose a labeled answer', (tester) async {
    String? sent;
    Future<void> answer(
      String requestId,
      String behavior, {
      String? message,
      bool always = false,
      bool dismiss = false,
    }) async {
      sent = message;
    }

    final card = OptionCard.fromJson({
      'title': 't',
      'subtitle': 's',
      'requestType': 'question',
      'requestId': 'r',
      'questionRequest': {
        'version': 1,
        'questions': [
          {
            'question': 'Ship it?',
            'header': 'Ship',
            'options': [
              {'label': 'Yes'},
              {'label': 'No'},
            ],
          },
          {
            'question': 'When?',
            'options': [
              {'label': 'Now'},
              {'label': 'Later'},
            ],
          },
        ],
      },
    });
    await tester.pumpWidget(wrap(card, answer));
    await tester.tap(find.text('Yes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Later'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send answers'));
    await tester.pumpAndSettle();
    expect(sent, 'Ship: Yes; When?: Later');
  });

  testWidgets('dismiss closes a question unanswered', (tester) async {
    final calls = <List<Object?>>[];
    Future<void> answer(
      String requestId,
      String behavior, {
      String? message,
      bool always = false,
      bool dismiss = false,
    }) async {
      calls.add([requestId, behavior, message, always, dismiss]);
    }

    await tester.pumpWidget(
      wrap(OptionCard.fromJson(questionCardJson()), answer),
    );
    await tester.tap(find.byTooltip('Dismiss'));
    await tester.pumpAndSettle();
    expect(calls.single[0], 'req-2');
    expect(calls.single[1], 'answer');
    expect(calls.single[3], false);
    expect(calls.single[4], isTrue);
    expect(
      (calls.single[2]! as String).toLowerCase(),
      contains('without answering'),
    );
  });

  testWidgets('settled cards render a receipt, not buttons', (tester) async {
    final cases = <Map<String, Object?>, String>{
      {'answered': 'Allowed'}: 'Allowed: Allowed',
      {'answered': 'Denied'}: 'Denied',
      {'answeredText': 'Sonnet'}: 'Answered: Sonnet',
      {'dismissed': true}: 'Dismissed',
      {'expired': true}: 'Expired — needs a fresh proposal',
      {'stopped': true}: 'Stopped',
    };
    for (final entry in cases.entries) {
      final card = OptionCard.fromJson({
        'title': 't',
        'subtitle': 's',
        'requestId': 'r',
        ...entry.key,
      });
      await tester.pumpWidget(wrap(card, noop));
      expect(find.text(entry.value), findsOneWidget, reason: '${entry.key}');
      expect(find.text('Allow once'), findsNothing);
    }
  });

  testWidgets('computer ask names the device that must answer', (tester) async {
    final card = OptionCard.fromJson({
      'title': 't',
      'subtitle': 's',
      'requestType': 'permission',
      'requestId': 'r',
      'computerAsk': {
        'need': 'screen',
        'reason': 'closed',
        'device': 'Mac',
        'state': 'asking',
      },
    });
    await tester.pumpWidget(wrap(card, noop));
    expect(find.textContaining('your Mac'), findsOneWidget);
  });

  test('push client methods round-trip through the fake', () async {
    final fake = FakeApi();
    expect(
      await fake.registerPush(
        'http://x',
        token: 'tok',
        platform: 'ios',
        deviceName: 'phone',
      ),
      isTrue,
    );
    final status = await fake.pushStatus('http://x');
    expect(status.configured, isTrue);
    expect(status.devices, hasLength(1));
    expect(await fake.setPushEnabled('http://x', false), isFalse);
    expect(await fake.unregisterPush('http://x', 'tok'), isTrue);
    expect(await fake.unregisterPush('http://x', 'tok'), isFalse);
  });

  test('push controller registers, routes taps, and stops', () async {
    final messaging = FakeMessaging();
    final controller = PushController(messaging: messaging);
    final fake = FakeApi();
    final foreground = <PushTap>[];
    final taps = <PushTap>[];
    controller.onForeground = foreground.add;
    controller.onTap = taps.add;

    await controller.ensureStarted(fake, 'http://x');
    expect(controller.state, PushState.on);
    expect(controller.fingerprint, '12345678');
    expect(fake.pushTokens, ['fcm-token-abc12345678']);

    messaging.foreground.add(
      const PushTap(title: 'Hi', data: {'threadId': 't1'}),
    );
    messaging.opened.add(
      const PushTap(title: 'Hi', data: {'threadId': 't2'}),
    );
    await pumpEventQueue();
    expect(foreground.single.threadId, 't1');
    expect(taps.single.threadId, 't2');

    messaging.refresh.add('fcm-token-new');
    await pumpEventQueue();
    expect(fake.pushTokens.last, 'fcm-token-new');

    await controller.stop();
    expect(controller.state, PushState.idle);
    expect(fake.pushTokens, isNot(contains('fcm-token-new')));
    controller.dispose();
    messaging.close();
  });

  test('push controller reports denied and unavailable', () async {
    final denied = FakeMessaging()..granted = false;
    final noGrant = PushController(messaging: denied);
    await noGrant.ensureStarted(FakeApi(), 'http://x');
    expect(noGrant.state, PushState.denied);

    final noToken = FakeMessaging()..token = null;
    final unavailable = PushController(messaging: noToken);
    await unavailable.ensureStarted(FakeApi(), 'http://x');
    expect(unavailable.state, PushState.unavailable);
    noGrant.dispose();
    unavailable.dispose();
    denied.close();
    noToken.close();
  });

  test('push controller prompts instead of asking on its own', () async {
    final messaging = FakeMessaging()..asked = false;
    final controller = PushController(messaging: messaging);
    final fake = FakeApi();
    await controller.ensureStarted(fake, 'http://x');
    expect(controller.state, PushState.prompt);
    expect(messaging.asked, isFalse);
    expect(fake.pushTokens, isEmpty);

    await controller.enable();
    expect(messaging.asked, isTrue);
    expect(controller.state, PushState.on);
    expect(fake.pushTokens, hasLength(1));
    controller.dispose();
    messaging.close();
  });

  test('push controller flips the global switch', () async {
    final messaging = FakeMessaging();
    final controller = PushController(messaging: messaging);
    final fake = FakeApi();
    await controller.ensureStarted(fake, 'http://x');
    expect(await controller.setGlobal(false), isFalse);
    expect(controller.state, PushState.off);
    expect(await controller.setGlobal(true), isTrue);
    expect(controller.state, PushState.on);
    controller.dispose();
    messaging.close();
  });
}
