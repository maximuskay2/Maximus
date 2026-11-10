import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/session_store.dart';
import 'package:maximus/auth/auth_state.dart';
import 'package:maximus/automations/computer_page.dart';
import 'package:maximus/automations/routines_page.dart';
import 'package:maximus/phoneapps/executor.dart';
import 'package:maximus/phoneapps/policy.dart';
import 'package:maximus/phoneapps/poller.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

class FakeCalendar implements CalendarDriver {
  final events = <Map<String, Object?>>[
    {
      'id': 'e1',
      'title': 'Standup',
      'start': '2026-11-10T09:00:00.000',
      'end': '2026-11-10T09:15:00.000',
    },
  ];

  @override
  Future<List<Map<String, Object?>>> listEvents({
    required DateTime from,
    required DateTime to,
    String? calendar,
  }) async => [...events];

  @override
  Future<Map<String, Object?>?> getEvent(String id) async {
    for (final e in events) {
      if (e['id'] == id) return e;
    }
    return null;
  }

  @override
  Future<List<Map<String, Object?>>> findFreeTime({
    required DateTime from,
    required DateTime to,
    required int minutes,
  }) async => [
    {'start': from.toIso8601String(), 'end': to.toIso8601String()},
  ];

  @override
  Future<String?> createEvent(Map<String, Object?> fields) async {
    events.add({'id': 'e${events.length + 1}', ...fields});
    return 'e${events.length}';
  }

  @override
  Future<bool> updateEvent(String id, Map<String, Object?> fields) async =>
      events.any((e) => e['id'] == id);

  @override
  Future<bool> deleteEvent(String id) async {
    final before = events.length;
    events.removeWhere((e) => e['id'] == id);
    return events.length < before;
  }

  @override
  Future<bool> respondToInvite(String id, String response) async => false;
}

class FakeContacts implements ContactsDriver {
  @override
  Future<List<Map<String, Object?>>> search(String query) async => [
    {'id': 'c1', 'displayName': 'Ada Lovelace'},
  ];

  @override
  Future<Map<String, Object?>?> get(String id) async =>
      id == 'c1' ? {'id': 'c1', 'displayName': 'Ada Lovelace'} : null;

  @override
  Future<String?> create(Map<String, Object?> fields) async => 'c2';

  @override
  Future<bool> update(String id, Map<String, Object?> fields) async =>
      id == 'c1';
}

class FakeLocation implements LocationDriver {
  @override
  Future<Map<String, Object?>> current() async => {
    'latitude': 37.33,
    'longitude': -122.01,
    'placeName': 'Infinite Loop, Cupertino',
  };
}

class FakeMessages implements MessageDriver {
  final opened = <String>[];

  @override
  Future<bool> sendSms(String to, String text) async {
    opened.add('sms:$to');
    return true;
  }

  @override
  Future<bool> sendWhatsapp(String to, String text) async {
    opened.add('wa:$to');
    return true;
  }
}

PhoneJob job(String tool, [Map<String, Object?> args = const {}]) =>
    PhoneJob(
      id: 'job-1',
      tool: tool,
      arguments: args,
      expiresAt: DateTime.now().millisecondsSinceEpoch + 60000,
    );

Future<AuthState> authWith(FakeApi api) async {
  final store = MemorySessionStore();
  await store.saveServer(
    const ServerRef(id: 'h', name: 'Home', baseUrl: 'https://h.example'),
  );
  final auth = AuthState(store: store, client: api);
  await auth.load();
  return auth;
}

void main() {
  test('routine schedule summaries read naturally', () {
    Routine routine(Map<String, Object?> schedule) => Routine(
      id: 'r',
      name: 'n',
      prompt: 'p',
      botId: 'b',
      enabled: true,
      schedule: schedule,
    );
    expect(
      routine({'type': 'daily', 'time': '08:00'}).scheduleSummary,
      'Daily 08:00',
    );
    expect(
      routine({
        'type': 'daily',
        'time': '08:00',
        'weekdays': [1, 2, 3, 4, 5],
      }).scheduleSummary,
      'Daily 08:00 MTWTF',
    );
    expect(
      routine({'type': 'interval', 'everyMinutes': 30}).scheduleSummary,
      'Every 30 min',
    );
    expect(
      routine({'type': 'interval', 'everyMinutes': 120}).scheduleSummary,
      'Every 2 h',
    );
    expect(routine({'type': 'once'}).scheduleSummary, 'Once');
  });

  testWidgets('routines page lists, pauses, and runs now', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: RoutinesPage(
          auth: await authWith(api),
          baseUrl: 'https://h.example',
          bots: FakeApi.botsPayload,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Morning brief'), findsOneWidget);
    expect(find.textContaining('Daily 08:00'), findsOneWidget);

    // Detail sheet with history + actions.
    await tester.tap(find.byTooltip('Details'));
    await tester.pumpAndSettle();
    expect(find.text('History'), findsOneWidget);
    expect(find.text('All quiet.'), findsOneWidget);
    await tester.tap(find.text('Run now'));
    await tester.pumpAndSettle();
    expect(api.routineRunsPayload.first.manual, isTrue);

    await tester.tap(find.text('Pause'));
    await tester.pumpAndSettle();
    expect(api.routinesPayload.first.enabled, isFalse);
  });

  testWidgets('routines page creates a daily schedule', (tester) async {
    final api = FakeApi();
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: RoutinesPage(
          auth: await authWith(api),
          baseUrl: 'https://h.example',
          bots: FakeApi.botsPayload,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('New'));
    await tester.pumpAndSettle();
    // The name field is the first text field in the sheet.
    await tester.enterText(find.byType(TextField).first, 'Evening check');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Check in on open work.',
    );
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(api.routinesPayload.any((r) => r.name == 'Evening check'), isTrue);
  });

  testWidgets('computer page renders frames and takes over', (tester) async {
    // 1x1 PNG frame.
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
    final api = FakeApi()
      ..browserFrames = [
        {'type': 'ready', 'viewerId': 'v1'},
        {
          'type': 'frame',
          'seq': 7,
          'data': base64Encode(png),
          'format': 'jpeg',
          'metadata': {'deviceWidth': 800, 'deviceHeight': 600},
        },
        {'type': 'url', 'url': 'https://example.com/login'},
        {'type': 'control', 'held': false, 'owned': false, 'controlling': false},
      ];
    final bot = FakeApi.botsPayload.first;
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: ComputerPage(
          client: api,
          baseUrl: 'https://h.example',
          bot: bot,
          thread: ThreadSummary(
            threadId: bot.threadId,
            title: bot.name,
            createdAt: 0,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('https://example.com/login'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    // Frames are acked by sequence.
    expect(
      api.browserActions.any(
        (a) => a['type'] == 'ack' && a['seq'] == 7 && a['viewerId'] == 'v1',
      ),
      isTrue,
    );
    await tester.tap(find.text('Take over'));
    await tester.pumpAndSettle();
    expect(
      api.browserActions.any(
        (a) => a['type'] == 'take' && a['viewerId'] == 'v1',
      ),
      isTrue,
    );
    await tester.enterText(find.byType(TextField).at(1), 'hello');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(
      api.browserActions.any(
        (a) => a['type'] == 'input_keyboard' && a['text'] == 'hello',
      ),
      isTrue,
    );
  });

  test('executor runs calendar reads and writes', () async {
    final executor = PhoneToolExecutor(
      capabilities: const {'calendar'},
      calendar: FakeCalendar(),
    );
    final list = await executor.execute(
      job('PHONE_LIST_EVENTS', {
        'from': '2026-11-10T00:00:00.000',
        'to': '2026-11-11T00:00:00.000',
      }),
    );
    expect(list.ok, isTrue);
    expect((list.result as Map)['events'], hasLength(1));

    final missing = await executor.execute(job('PHONE_GET_EVENT', {'id': 'zz'}));
    expect(missing.ok, isFalse);
    expect(missing.code, 'not_found');

    final created = await executor.execute(
      job('PHONE_CREATE_EVENT', {'title': 'Lunch'}),
    );
    expect(created.ok, isTrue);

    final denied = await PhoneToolExecutor(
      capabilities: const {},
      calendar: FakeCalendar(),
    ).execute(job('PHONE_LIST_EVENTS', {'from': 'x', 'to': 'y'}));
    expect(denied.ok, isFalse);
    expect(denied.code, 'denied');

    final unknown = await executor.execute(job('PHONE_FLY'));
    expect(unknown.ok, isFalse);
    expect(unknown.code, 'unsupported');
  });

  test('executor runs contacts, location, messages', () async {
    final messages = FakeMessages();
    final executor = PhoneToolExecutor(
      capabilities: const {'contacts', 'location', 'messages'},
      contacts: FakeContacts(),
      location: FakeLocation(),
      messages: messages,
    );
    final found = await executor.execute(
      job('PHONE_SEARCH_CONTACTS', {'query': 'ada'}),
    );
    expect(
      ((found.result as Map)['contacts'] as List).single['displayName'],
      'Ada Lovelace',
    );
    final where = await executor.execute(job('PHONE_GET_LOCATION'));
    expect((where.result as Map)['placeName'], contains('Cupertino'));
    final sms = await executor.execute(
      job('PHONE_SEND_MESSAGE', {'to': '+1555', 'text': 'hi'}),
    );
    expect(sms.ok, isTrue);
    expect(messages.opened, ['sms:+1555']);

    final poi = await executor.execute(
      job('PHONE_FIND_PLACES_NEARBY', {'query': 'coffee'}),
    );
    expect(poi.ok, isFalse);
    expect(poi.code, 'unsupported');
  });

  test('policy store round-trips per tool', () async {
    final dir = await Directory.systemTemp.createTemp('maximus-policy');
    try {
      final store = PhonePolicyStore(dir: dir);
      expect(await store.read(), isEmpty);
      await store.write('PHONE_CREATE_EVENT', ToolPolicy.always);
      await store.write('PHONE_DELETE_EVENT', ToolPolicy.never);
      final back = await store.read();
      expect(back['PHONE_CREATE_EVENT'], ToolPolicy.always);
      expect(back['PHONE_DELETE_EVENT'], ToolPolicy.never);
      expect(back['PHONE_LIST_EVENTS'], isNull);
    } finally {
      await dir.delete(recursive: true);
    }
  });

  test('poller honors never, asks, and completes', () async {
    final api = FakeApi();
    final dir = await Directory.systemTemp.createTemp('maximus-poller');
    try {
      final policies = PhonePolicyStore(dir: dir);
      await policies.write('PHONE_DELETE_EVENT', ToolPolicy.never);
      await policies.write('PHONE_LIST_EVENTS', ToolPolicy.always);
      final poller = PhoneJobPoller(
        client: api,
        baseUrl: 'https://h.example',
        executor: PhoneToolExecutor(
          capabilities: const {'calendar'},
          calendar: FakeCalendar(),
        ),
        policies: policies,
        storage: const FlutterSecureStorage(),
      );
      // never → denied without approval, without execution.
      var asked = false;
      poller.approver = (job, {required bool isWrite}) async {
        asked = true;
        return true;
      };
      Future<void> waitForResults(int count) async {
        final deadline = DateTime.now().add(const Duration(seconds: 10));
        while (api.phoneResults.length < count) {
          if (DateTime.now().isAfter(deadline)) break;
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
      }

      poller.start();
      api.nextPhoneJob = job('PHONE_DELETE_EVENT', {'id': 'e1'});
      await waitForResults(1);
      expect(asked, isFalse);
      expect(api.phoneResults.single.$2, isFalse);
      expect(api.phoneResults.single.$5, 'denied');

      // always → runs straight through.
      api.nextPhoneJob = job('PHONE_LIST_EVENTS', {
        'from': '2026-11-10T00:00:00.000',
        'to': '2026-11-11T00:00:00.000',
      });
      await waitForResults(2);
      expect(asked, isFalse);
      expect(api.phoneResults.last.$2, isTrue);

      // ask → approver decides; denial completes denied.
      api.nextPhoneJob = job('PHONE_CREATE_EVENT', {'title': 'x'});
      poller.approver = (job, {required bool isWrite}) async {
        asked = true;
        return false;
      };
      await waitForResults(3);
      expect(asked, isTrue);
      expect(api.phoneResults.last.$2, isFalse);
      expect(api.phoneResults.last.$5, 'denied');

      poller.stop();
      poller.dispose();
      expect((await poller.installId()).length, greaterThan(8));
    } finally {
      await dir.delete(recursive: true);
    }
  });

  test('phone register/unregister round-trips through the fake', () async {
    final api = FakeApi();
    expect(await api.phoneSelf('https://h.example'), isNull);
    final phone = await api.registerPhone(
      'https://h.example',
      installId: 'install-1',
      name: 'Test phone',
      platform: 'ios',
      appVersion: '0.1.0',
      timeZone: 'PST',
      capabilities: const {'calendar': 'full'},
    );
    expect(phone!.name, 'Test phone');
    expect((await api.phoneSelf('https://h.example'))!.key, 'session:test');
    expect(await api.unregisterPhone('https://h.example'), isTrue);
    expect(await api.phoneSelf('https://h.example'), isNull);
  });
}
