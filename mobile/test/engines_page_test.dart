import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/engines/engines_page.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

void main() {
  test('EngineInstance parses snapshot and auth method', () {
    final engine = EngineInstance.tryFrom({
      'instanceId': 'meta',
      'driverKind': 'meta',
      'displayName': 'Meta',
      'access': 'api',
      'snapshot': {'state': 'unavailable', 'reason': 'No API key'},
      'authentication': {'method': 'device-code', 'signOut': true},
    });
    expect(engine, isNotNull);
    expect(engine!.needsKey, isTrue);
    expect(engine.canSignIn, isTrue);
    expect(engine.displayName, 'Meta');
  });

  testWidgets('engines page lists engines and opens add endpoint', (tester) async {
    final api = FakeApi()
      ..instancesPayload = const [
        EngineInstance(
          instanceId: 'openai',
          driverKind: 'openai-compat',
          displayName: 'OpenAI',
          state: 'unavailable',
          reason: 'No API key',
          access: 'api',
        ),
        EngineInstance(
          instanceId: 'claude',
          driverKind: 'claudeAgent',
          displayName: 'Claude',
          state: 'available',
          access: 'subscription',
          authMethod: 'paste-code',
        ),
      ];
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: EnginesPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('OpenAI'), findsOneWidget);
    expect(find.text('Claude'), findsOneWidget);
    expect(find.text('Add key'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.tap(find.text('Add endpoint'));
    await tester.pumpAndSettle();
    expect(find.text('Base URL'), findsOneWidget);
  });

  testWidgets('engines page saves an API key', (tester) async {
    final api = FakeApi()
      ..instancesPayload = const [
        EngineInstance(
          instanceId: 'openrouter',
          driverKind: 'openai-compat',
          displayName: 'OpenRouter',
          state: 'unavailable',
          reason: 'No API key',
          access: 'api',
        ),
      ];
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: EnginesPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add key'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'sk-or-v1-test');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(api.configWrites.single['openrouter'], {'key': 'sk-or-v1-test'});
  });

  testWidgets('chat-only engines page shows owner-only', (tester) async {
    final api = FakeApi()
      ..sessionInfoPayload = const AuthSessionInfo(
        kind: 'session',
        scopes: ['client'],
        id: 'sess-client',
        label: 'Member phone',
        email: 'member@example.test',
      );
    final store = MemorySessionStore();
    await store.saveServer(
      const ServerRef(
        id: 'h',
        name: 'Home',
        baseUrl: 'https://h.example',
        companionToken: 'tok',
      ),
    );
    final auth = AuthState(store: store, client: api);
    await auth.load();
    expect(auth.isChatOnly, isTrue);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: EnginesPage(
          client: api,
          baseUrl: 'https://h.example',
          auth: auth,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Owner only'), findsOneWidget);
    expect(find.text('Add endpoint'), findsNothing);
    expect(find.textContaining('admin scope'), findsNothing);
  });
}
