import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/apps/apps_page.dart';
import 'package:maximus/auth/auth_state.dart';

import 'fake_api.dart';

void main() {
  testWidgets('Apps page lists catalog cards, connections, and bot MCP servers', (
    tester,
  ) async {
    final api = FakeApi()
      ..connectorCatalogAnswer = const ConnectorCatalog(
        configured: true,
        cards: [
          ConnectorToolkit(
            slug: 'gmail',
            label: 'Gmail',
            blurb: 'Read and send email.',
            categories: ['communication'],
          ),
          ConnectorToolkit(
            slug: 'github',
            label: 'GitHub',
            blurb: 'Issues and pull requests.',
            categories: ['developer tools'],
          ),
        ],
      )
      ..connectorConnectionsAnswer = {
        'gmail': const ConnectorLink(
          connected: true,
          accounts: [
            ConnectorAccount(
              id: 'acc_1',
              status: 'ACTIVE',
              alias: 'support@maxit.com.ng',
            ),
          ],
        ),
      }
      ..botMcpServersById = {
        'bot_1': const [
          BotMcpServer(name: 'warehouse', enabled: true, on: true),
          BotMcpServer(name: 'tickets', enabled: true, on: false),
        ],
      };

    final auth = AuthState(store: MemorySessionStore(), client: api);

    await tester.pumpWidget(
      MaterialApp(
        home: AppsPage(
          auth: auth,
          baseUrl: 'http://127.0.0.1:8799',
          bots: const [
            BotSummary(
              id: 'bot_1',
              name: 'Ada',
              title: '',
              description: '',
              threadId: 't1',
              notifications: true,
              color: 'ember',
              unread: false,
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Gmail'), findsOneWidget);
    expect(find.text('GitHub'), findsOneWidget);
    expect(find.text('support@maxit.com.ng'), findsOneWidget);
    expect(find.text('1 connected'), findsOneWidget);
    expect(find.text('Connect'), findsOneWidget);
    expect(find.text('Communication'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('warehouse'), findsOneWidget);
    expect(find.textContaining('MCP servers'), findsWidgets);
  });

  testWidgets('Apps page explains when connected apps are not configured', (
    tester,
  ) async {
    final api = FakeApi()
      ..connectorCatalogAnswer = const ConnectorCatalog(
        configured: false,
        cards: [],
      );
    final auth = AuthState(store: MemorySessionStore(), client: api);

    await tester.pumpWidget(
      MaterialApp(
        home: AppsPage(
          auth: auth,
          baseUrl: 'http://127.0.0.1:8799',
          bots: const [],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Connected apps are not set up on this server yet'),
      findsOneWidget,
    );
  });

  test('catalog and link parsers tolerate partial JSON', () {
    final catalog = ConnectorCatalog.fromJson({
      'configured': true,
      'cards': [
        {'slug': 'slack', 'label': 'Slack', 'blurb': 'Channels'},
        {'slug': '', 'label': 'Broken'},
      ],
    });
    expect(catalog.cards, hasLength(1));
    expect(catalog.cards.single.slug, 'slack');

    final link = ConnectorLink.fromJson({
      'connected': true,
      'accounts': [
        {'id': 'a1', 'status': 'ACTIVE', 'alias': 'ops'},
      ],
    });
    expect(link.hasActiveAccount, isTrue);
    expect(link.accounts.single.alias, 'ops');
  });
}
