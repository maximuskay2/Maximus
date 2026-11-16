import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/approval_card.dart';

import 'fake_api.dart';

void main() {
  testWidgets('Approval card names the bound machine and who approved', (tester) async {
    final api = FakeApi()
      ..assignedMachineId = 'office'
      ..agentOsPayload = const AgentOsMachinesPayload(
        machines: [
          AgentOsMachine(
            id: 'office',
            name: 'Office Mac',
            kind: 'lent_peer',
            online: true,
          ),
        ],
        multiMachine: true,
        selfId: 'self',
      );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ApprovalCard(
            card: const OptionCard(
              title: 'Publish in Canva?',
              subtitle: 'Confirm as you',
              requestType: 'permission',
              requestId: 'r1',
              answered: 'Allow once',
              answeredBy: CardAnsweredBy(kind: 'session', name: 'Ada'),
            ),
            client: api,
            baseUrl: 'http://127.0.0.1:8799',
            botId: 'bot-1',
            threadId: 'thread-1',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('on Office Mac'), findsOneWidget);
    expect(find.textContaining('approved by Ada'), findsOneWidget);
  });
}
