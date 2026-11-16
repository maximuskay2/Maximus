import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/settings/machines_page.dart';

import 'fake_api.dart';

FakeApi machinesApi() => FakeApi()
  ..assignedMachineId = 'self'
  ..agentOsPayload = const AgentOsMachinesPayload(
    machines: [
      AgentOsMachine(
        id: 'self',
        name: 'Cloud home',
        kind: 'cloud_home',
        online: true,
      ),
      AgentOsMachine(
        id: 'office',
        name: 'Office Mac',
        kind: 'lent_peer',
        online: false,
      ),
      AgentOsMachine(
        id: 'studio',
        name: 'Studio',
        kind: 'lent_peer',
        online: true,
      ),
    ],
    multiMachine: true,
    selfId: 'self',
  );

void main() {
  testWidgets('Named computers shows the bound machine and an asleep Office Mac', (tester) async {
    final api = machinesApi();
    await tester.pumpWidget(
      MaterialApp(
        home: MachinesPage(
          client: api,
          baseUrl: 'http://127.0.0.1:8799',
          threadId: 'thread-1',
          botId: 'bot-1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Named computers'), findsOneWidget);
    expect(find.text('Cloud home'), findsOneWidget);
    expect(find.text('Office Mac'), findsOneWidget);
    expect(find.text('Asleep'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsOneWidget);

    await tester.tap(find.text('Office Mac'));
    await tester.pump();
    expect(
      find.text(
        'Office Mac is asleep. This thread waits here — it will not run on the phone\'s cloud. Wake that computer, then try again.',
      ),
      findsWidgets,
    );
    expect(api.assignedMachineId, 'office');
    expect(api.routedMachines, isEmpty);
  });

  testWidgets('Named computers binds a live desktop for the next turn', (tester) async {
    final api = machinesApi();
    await tester.pumpWidget(
      MaterialApp(
        home: MachinesPage(
          client: api,
          baseUrl: 'http://127.0.0.1:8799',
          threadId: 'thread-1',
          botId: 'bot-1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Studio'));
    await tester.pump();
    await tester.pump();
    expect(api.assignedMachineId, 'studio');
    expect(api.routedMachines, ['studio']);
    expect(find.text('Studio will run the next approved action.'), findsOneWidget);
  });

  testWidgets('Named computers lets a phone approve Canva without computer-use', (tester) async {
    final api = machinesApi();
    await tester.pumpWidget(
      MaterialApp(
        home: MachinesPage(
          client: api,
          baseUrl: 'http://127.0.0.1:8799',
          threadId: 'thread-1',
          botId: 'bot-1',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('canva · browser'), findsOneWidget);
    await tester.tap(find.text('publish'));
    await tester.pumpAndSettle();
    expect(find.text('Send publish to canva as you?'), findsOneWidget);
    await tester.tap(find.text('Approve'));
    await tester.pump();
    await tester.pump();
    expect(api.invokedPlugins, [
      {
        'mode': 'browser',
        'app': 'canva',
        'action': 'publish',
        'confirm': true,
        'threadId': 'thread-1',
        'botId': 'bot-1',
      },
    ]);
    expect(find.text('canva publish as you'), findsOneWidget);
  });

  testWidgets('Named computers waits when Canva approval finds Office Mac asleep', (tester) async {
    final api = machinesApi()
      ..invokePluginError = const ApiError(
        503,
        'Office Mac is asleep. Wake that computer, then try again.',
      );
    await tester.pumpWidget(
      MaterialApp(
        home: MachinesPage(
          client: api,
          baseUrl: 'http://127.0.0.1:8799',
          threadId: 'thread-1',
          botId: 'bot-1',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('publish'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Approve'));
    await tester.pump();
    await tester.pump();
    expect(
      find.text('Office Mac is asleep. Wake that computer, then try again.'),
      findsOneWidget,
    );
  });
}
