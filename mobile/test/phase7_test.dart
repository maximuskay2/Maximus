import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/settings/account_page.dart';
import 'package:maximus/settings/bot_settings_page.dart';
import 'package:maximus/settings/computer_settings_page.dart';
import 'package:maximus/settings/devices_page.dart';
import 'package:maximus/settings/preferences.dart';
import 'package:maximus/settings/settings_page.dart';
import 'package:maximus/settings/usage_page.dart';
import 'package:maximus/theme/tokens.dart';
import 'package:maximus/workspace/console_account.dart';
import 'package:maximus/workspace/workspace_page.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_api.dart';

Future<AuthState> authWith(FakeApi api) async {
  final store = MemorySessionStore();
  await store.saveServer(
    const ServerRef(id: 'h', name: 'Home', baseUrl: 'https://h.example'),
  );
  final auth = AuthState(store: store, client: api);
  await auth.load();
  return auth;
}

ConsoleAccount consoleWith(FakeApi api) => ConsoleAccount(
  client: api,
  serverId: 'h',
  baseUrl: 'https://h.example',
  storage: const FlutterSecureStorage(),
);

Future<AppPreferences> prefsWith(Map<String, Object> values) async {
  SharedPreferences.setMockInitialValues(values);
  final prefs = AppPreferences();
  await prefs.load();
  return prefs;
}

void main() {
  // Widget tests must never touch the real secure-storage platform:
  // its method channel never answers in flutter_tester (hang), while
  // plain unit tests merely throw MissingPluginException.
  setUp(() => FakeSecureStoragePlatform.install());

  test('console models parse the worker shapes tolerantly', () {
    final membership = ConsoleMembership.tryFrom({
      'workspace': 'acme',
      'displayName': 'Acme',
      'plan': 'team',
      'status': 'active',
      'role': 'admin',
    })!;
    expect(membership.admin, isTrue);
    expect(ConsoleMembership.tryFrom({'role': 'admin'}), isNull);
    expect(ConsoleMembership.tryFrom({'workspace': 'x', 'role': 'root'}), isNull);

    final seats = WorkspaceSeats.fromJson({
      'seats': {
        'admins': 1,
        'members': 2,
        'pendingInvites': 1,
        'roster': [
          {'userId': 'u1', 'email': 'o@x.test', 'role': 'admin'},
          {'bogus': true},
        ],
        'invites': [
          {'id': 'i1', 'email': 'n@x.test', 'role': 'member'},
        ],
      },
    });
    expect(seats.roster, hasLength(1));
    expect(seats.invites.single.email, 'n@x.test');

    final spend = WorkspaceSpend.fromJson({
      'spend': {
        'period': '2026-11',
        'spent': 12.5,
        'allowance': 50,
        'remaining': 37.5,
        'overage': 0,
      },
    });
    expect(spend.remaining, 37.5);

    final providers = WorkspaceProvider.listFrom({
      'providers': {
        'claude': {
          'mode': 'bundled',
          'models': ['sonnet'],
        },
        'Bogus-ID': {'mode': 'off'},
      },
      'routing': {
        'claude': {'allowed': true, 'via': 'bundled'},
      },
    });
    expect(providers, hasLength(1));
    expect(providers.single.allowed, isTrue);

    final report = UsageReport.fromJson({
      'from': '2026-11-01',
      'to': '2026-11-30',
      'groupBy': 'bot',
      'groups': [
        {'key': 'b1', 'label': 'Max', 'turns': 3, 'input': 10, 'output': 5},
      ],
      'total': {'key': 'total', 'label': 'Total', 'turns': 3},
      'billing': {'currency': 'USD'},
    });
    expect(report.groups.single.label, 'Max');
    expect(report.currency, 'USD');
  });

  test('console account signs in, persists, and signs out', () async {
    final account = consoleWith(FakeApi());
    await account.load();
    expect(account.signedIn, isFalse);

    await account.startSignIn('owner@example.test');
    expect(account.error, isNull);

    expect(
      await account.verifyCode('owner@example.test', '123456'),
      isTrue,
    );
    expect(account.signedIn, isTrue);
    expect(account.memberships.single.workspace, 'acme');

    // A second instance reads the persisted token.
    final again = consoleWith(FakeApi());
    await again.load();
    expect(again.signedIn, isTrue);

    await again.signOut();
    expect(again.signedIn, isFalse);
  });

  test('preferences round-trip theme, haptics, language, zone', () async {
    final prefs = await prefsWith({});
    expect(prefs.theme, ThemeMode.system);
    expect(prefs.haptics, isTrue);

    await prefs.setTheme(ThemeMode.dark);
    await prefs.setHaptics(false);
    await prefs.setLanguage('de');
    await prefs.setTimeZone('Europe/Berlin');
    await prefs.setWorkspace('acme');

    final again = await prefsWith({
      'maximus.prefs.theme': 'dark',
      'maximus.prefs.haptics': false,
      'maximus.prefs.language': 'de',
      'maximus.prefs.timeZone': 'Europe/Berlin',
      'maximus.prefs.workspace': 'acme',
    });
    expect(again.theme, ThemeMode.dark);
    expect(again.haptics, isFalse);
    expect(again.language, 'de');
    expect(again.timeZone, 'Europe/Berlin');
    expect(again.workspace, 'acme');
  });

  testWidgets('workspace page signs in then shows spend, seats, AIs', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 2000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = FakeApi();
    final account = consoleWith(api);
    await account.load();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: WorkspacePage(
          account: account,
          baseUrl: 'https://h.example',
          prefs: await prefsWith({}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Your Maximus workspace'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'owner@example.test');
    await tester.tap(find.text('Email me a code'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), '123456');
    await tester.tap(find.text('Verify code'));
    await tester.pumpAndSettle();

    expect(find.text('Acme'), findsWidgets);
    expect(find.textContaining('\$12.50'), findsWidgets);
    expect(find.text('dev@example.test'), findsOneWidget);
    expect(find.text('new@example.test'), findsOneWidget);
    expect(find.text('claude'), findsOneWidget);

    // Provider mode change writes through.
    await tester.scrollUntilVisible(find.text('claude'), 200);
    await tester.tap(find.text('Bundled').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Off').last);
    await tester.pumpAndSettle();
    expect(
      api.providerWrites.any(
        (w) => w['id'] == 'claude' && w['mode'] == 'off',
      ),
      isTrue,
    );
  });

  testWidgets('workspace invite sheet sends and copies the token', (
    tester,
  ) async {
    final api = FakeApi();
    final account = consoleWith(api);
    await account.load();
    await account.verifyCode('owner@example.test', '123456');
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: WorkspacePage(
          account: account,
          baseUrl: 'https://h.example',
          prefs: await prefsWith({}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Invite'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'new2@example.test');
    await tester.tap(find.text('Send invite'));
    await tester.pumpAndSettle();
    expect(
      api.inviteWrites.any((w) => w['email'] == 'new2@example.test'),
      isTrue,
    );
  });

  testWidgets('settings hub lists every section', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: SettingsPage(
          auth: await authWith(api),
          baseUrl: 'https://h.example',
          serverName: 'Home',
          bots: FakeApi.botsPayload,
          prefs: await prefsWith({}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    for (final label in ['Account', 'Devices', 'Usage', 'Bot computer']) {
      expect(find.text(label), findsWidgets, reason: label);
    }
    await tester.drag(find.byType(ListView), const Offset(0, -1200));
    await tester.pumpAndSettle();
    for (final label in [
      'Appearance',
      'Haptics',
      'Language',
      'Time zone',
      'Feedback',
    ]) {
      expect(find.text(label), findsWidgets, reason: label);
    }
    await tester.drag(find.byType(ListView), const Offset(0, 1200));
    await tester.pumpAndSettle();
    expect(find.text('Max'), findsWidgets);
  });

  testWidgets('account page shows session and signs out', (tester) async {
    final api = FakeApi();
    final auth = await authWith(api);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: AccountPage(
          auth: auth,
          baseUrl: 'https://h.example',
          serverName: 'Home',
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('e2e-phone'), findsOneWidget);
    expect(find.text('owner@example.test'), findsOneWidget);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out').last);
    await tester.pumpAndSettle();
    expect(api.loggedOut, isTrue);
    expect(auth.active, isNull);
  });

  testWidgets('devices page lists and revokes', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: DevicesPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('This iPhone'), findsOneWidget);
    expect(find.text('MacBook'), findsOneWidget);

    await tester.tap(find.byTooltip('Remove').at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(api.revokedSessions, contains('sess-2'));
  });

  testWidgets('usage page shows the month total and bots', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: UsagePage(client: FakeApi(), baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Muse ration'), findsOneWidget);
    expect(find.textContaining('2823 Spark tokens'), findsOneWidget);
    expect(find.text('This month'), findsOneWidget);
    expect(find.text('\$1.25'), findsWidgets);
    expect(find.text('Max'), findsOneWidget);
  });

  testWidgets('bot settings patches only changed fields', (tester) async {
    final api = FakeApi();
    final bot = FakeApi.botsPayload.first;
    BotSummary? saved;
    final saving = FakeApiSaving(api, (b) => saved = b);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotSettingsPage(
          client: saving,
          baseUrl: 'https://h.example',
          bot: bot,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Autonomy'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '${bot.name} v2');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved, isNotNull);
    expect(api.lastBotPatch?['name'], '${bot.name} v2');
    expect(api.lastBotPatch?.containsKey('title'), isFalse);
  });

  testWidgets('bot computer runs lifecycle actions', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotComputerPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('running'), findsWidgets);

    await tester.tap(find.text('Stop'));
    await tester.pumpAndSettle();
    expect(api.computerActions, contains('stop'));

    await tester.scrollUntilVisible(find.text('Reset disk'), 200);
    await tester.tap(find.text('Reset disk'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(api.computerActions, contains('remove'));
  });

  testWidgets('a missing desktop offers prepare instead of start', (tester) async {
    final api = FakeApi();
    api.computerPayload = const BotComputerStatus(
      available: true,
      state: 'missing',
      container: 'missing',
      image: false,
      detail: 'Prepare the Cua desktop image with Driver 0.37.0',
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotComputerPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('missing'), findsNothing);
    expect(find.text('No desktop yet'), findsOneWidget);
    expect(find.text('Start'), findsNothing);

    await tester.tap(find.text('Prepare desktop'));
    await tester.pumpAndSettle();
    expect(api.computerActions, ['pull']);
  });

  testWidgets('a dead driver explains itself and can be restarted', (tester) async {
    final api = FakeApi();
    api.computerPayload = const BotComputerStatus(
      available: true,
      state: 'running',
      container: 'running',
      image: true,
      detail:
          'The Local VM desktop failed to start: Command failed: docker exec cua-driver status\nCua Driver daemon is not running',
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotComputerPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text("Driver isn't running"), findsOneWidget);
    expect(find.textContaining('docker exec'), findsNothing);
    expect(find.text('Browser'), findsOneWidget);

    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(api.computerActions, ['stop', 'start']);

    await tester.tap(find.text('Browser'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Add a bot first'), findsOneWidget);
  });

  testWidgets('a tap on the desktop picture is sent as a click', (tester) async {
    const png = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0x0f, 0x00, 0x00,
      0x01, 0x01, 0x01, 0x00, 0x1b, 0xe8, 0x1a, 0xe5,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ];
    final api = FakeApi()..computerScreenshot = Uint8List.fromList(png);
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotComputerPage(client: api, baseUrl: 'https://h.example'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Type on the desktop', skipOffstage: false), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('desktop-picture')));
    await tester.tap(find.byKey(const Key('desktop-picture')));
    await tester.pumpAndSettle();
    expect(api.desktopInputs, isNotEmpty);
    expect(api.desktopInputs.first['action'], 'click');

    final typeField = find.widgetWithText(TextField, 'Type on the desktop', skipOffstage: false);
    await tester.ensureVisible(typeField);
    await tester.enterText(typeField, 'hello');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(
      api.desktopInputs.any((a) => a['action'] == 'type' && a['text'] == 'hello'),
      isTrue,
    );
  });

  testWidgets('the browser tab lists the pages the bot has open', (tester) async {
    final api = FakeApi()
      ..browserFrames = [
        {'type': 'ready', 'viewerId': 'v1'},
        {
          'type': 'tabs',
          'tabs': [
            {
              'tabId': 't1',
              'title': 'Inbox',
              'url': 'https://mail.example/',
              'active': true,
            },
            {
              'tabId': 't2',
              'title': 'Docs',
              'url': 'https://docs.example/',
              'active': false,
            },
          ],
        },
      ];
    const bot = BotSummary(
      id: 'b1',
      name: 'Chief',
      title: '',
      description: '',
      threadId: 't1',
      notifications: true,
      color: 'ember',
      unread: false,
    );
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: BotComputerPage(
          client: api,
          baseUrl: 'https://h.example',
          bots: const [bot],
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Browser'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Inbox'), findsOneWidget);
    expect(find.text('Docs'), findsOneWidget);

    await tester.tap(find.text('Docs'));
    await tester.pump();
    expect(
      api.browserActions.any(
        (action) => action['type'] == 'tab-select' && action['tabId'] == 't2',
      ),
      isTrue,
    );
  });
}

/// Wraps FakeApi.patchBot to capture the saved bot.
class FakeApiSaving extends FakeApi {
  FakeApiSaving(this.inner, this.onSave);

  final FakeApi inner;
  final void Function(BotSummary bot) onSave;

  @override
  Future<BotSummary> patchBot(
    String baseUrl,
    String botId,
    Map<String, Object?> patch,
  ) async {
    final saved = await inner.patchBot(baseUrl, botId, patch);
    onSave(saved);
    return saved;
  }
}
