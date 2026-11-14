import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/credential_patch.dart';
import 'package:maximus/chat/secret_card.dart';
import 'package:maximus/chat/sign_in_card.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

void main() {
  test('ChatMessage parses secret and signIn cards', () {
    final message = ChatMessage.fromJson({
      'id': 'm1',
      'role': 'bot',
      'kind': 'text',
      'text': 'Connect your mailbox',
      'secret': {
        'target': 'customSecret',
        'label': 'Email',
        'description': 'So I can send mail',
        'placeholder': 'Password',
        'requestKey': 'rk',
        'delivery': 'email',
        'address': 'me@shop.example',
      },
      'signIn': {
        'url': 'https://mail.example/login',
        'site': 'mail.example',
        'place': 'browser',
        'reason': 'Need the inbox',
      },
    });
    expect(message.secret, isNotNull);
    expect(message.secret!.email, isTrue);
    expect(message.secret!.isLive, isTrue);
    expect(message.signIn!.site, 'mail.example');
    expect(message.blank, isFalse);
  });

  test('credential patches cover common providers', () {
    expect(configPatchForCredential('anthropicApiKey', 'sk-ant'), {
      'anthropic': {'key': 'sk-ant', 'everyClaudeBot': false},
    });
    expect(configPatchForCredential('openaiApiKey', 'sk'), {
      'openai': {'key': 'sk'},
    });
    expect(isCustomOrEmailTarget('customSecret', 'email'), isTrue);
  });

  testWidgets('secret card saves email to the API', (tester) async {
    final api = FakeApi();
    final secret = SecretRequest(
      target: 'customSecret',
      label: 'Email',
      description: 'So I can send mail',
      placeholder: 'Password',
      requestKey: 'rk',
      delivery: 'email',
      address: 'me@shop.example',
    );
    SecretRequest? updated;
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: Scaffold(
          body: SecretCard(
            client: api,
            baseUrl: 'https://h.example',
            botId: 'b1',
            threadId: 't1',
            messageId: 'm1',
            secret: secret,
            onUpdated: (next) => updated = next,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Save securely'), findsOneWidget);
    await tester.enterText(find.byType(TextField).last, 's3cret ');
    await tester.tap(find.text('Save securely'));
    await tester.pumpAndSettle();
    expect(api.secretCardWrites.single['address'], 'me@shop.example');
    expect(api.secretCardWrites.single['value'], 's3cret ');
    expect(updated?.provided, isTrue);
  });

  testWidgets('sign-in card settles done', (tester) async {
    final api = FakeApi();
    final bot = FakeApi.botsPayload.first;
    final thread = ThreadSummary(threadId: 't1', title: 'Chat', createdAt: 0);
    SignInRequest? updated;
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: Scaffold(
          body: SignInCard(
            client: api,
            baseUrl: 'https://h.example',
            bot: bot,
            thread: thread,
            messageId: 'm2',
            signIn: const SignInRequest(
              url: 'https://mail.example/login',
              site: 'mail.example',
              place: 'browser',
            ),
            onUpdated: (next) => updated = next,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(api.signInCardWrites.single['action'], 'done');
    expect(updated?.done, isTrue);
  });
}
