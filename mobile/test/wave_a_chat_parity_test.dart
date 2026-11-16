import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/chat/connector_card.dart';
import 'package:maximus/chat/app_card.dart';
import 'package:maximus/chat/widget_card.dart';
import 'package:maximus/theme/tokens.dart';

import 'fake_api.dart';

void main() {
  test('ChatMessage parses connector, widget, outbound, published page', () {
    final message = ChatMessage.fromJson({
      'id': 'm1',
      'role': 'bot',
      'kind': 'widget',
      'connector': {
        'slug': 'gmail',
        'label': 'Gmail',
        'description': 'Read and send mail',
        'status': 'required',
        'resumeKey': 'rk1',
      },
      'widget': {
        'v': 1,
        'root': {
          'type': 'Card',
          'id': 'n1',
          'children': [
            {'type': 'Text', 'id': 'n2', 'value': 'TO testers'},
            {
              'type': 'Markdown',
              'id': 'n3',
              'value': 'Build **25** is ready.',
            },
          ],
          'confirm': {
            'label': 'Send email',
            'action': {'type': 'email.send'},
          },
          'cancel': {
            'label': 'Discard',
            'action': {'type': 'email.discard'},
          },
        },
      },
      'publishedPage': {
        'state': 'live',
        'title': 'Weekly recap',
        'url': 'https://pages.example/recap',
      },
      'card': {
        'title': 'Send on your behalf?',
        'subtitle': 'Post to Linear',
        'options': ['Allow', 'Deny'],
        'requestId': 'req1',
        'tool': 'LINEAR_CREATE_LINEAR_COMMENT',
        'outboundRequest': {
          'tool': 'LINEAR_CREATE_LINEAR_COMMENT',
          'app': 'Linear',
          'calls': [
            {'app': 'Linear', 'label': 'Create comment'},
          ],
        },
      },
    });

    expect(message.connector!.slug, 'gmail');
    expect(message.widget!.confirm!.label, 'Send email');
    expect(message.widget!.lines, contains('TO testers'));
    expect(message.publishedPage!.title, 'Weekly recap');
    expect(message.card!.isPermission, isTrue);
    expect(message.card!.outboundRequest!.app, 'Linear');
    expect(message.blank, isFalse);
  });

  testWidgets('widget card posts confirm Send/Discard', (tester) async {
    final api = FakeApi();
    final widgetData = ChatWidget(
      rootType: 'Card',
      lines: const ['Hi all — build 25 is ready.'],
      confirm: const ChatWidgetButton(
        label: 'Send email',
        actionType: 'email.send',
      ),
      cancel: const ChatWidgetButton(
        label: 'Discard',
        actionType: 'email.discard',
      ),
    );
    ChatWidget? updated;
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: Scaffold(
          body: WidgetCard(
            client: api,
            baseUrl: 'https://h.example',
            botId: 'b1',
            threadId: 't1',
            messageId: 'm1',
            widgetData: widgetData,
            onUpdated: (next) => updated = next,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Send email'), findsOneWidget);
    await tester.tap(find.text('Send email'));
    await tester.pumpAndSettle();
    expect(api.widgetActionWrites.single['ref'], 'confirm');
    expect(updated!.settled!.tone, 'confirm');
  });

  testWidgets('connector card authorize + dismiss', (tester) async {
    final api = FakeApi();
    final connector = ConnectorRequest(
      slug: 'gmail',
      label: 'Gmail',
      description: 'So I can read mail',
      status: 'required',
      resumeKey: 'rk',
    );
    ConnectorRequest? updated;
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: Scaffold(
          body: ConnectorCard(
            client: api,
            baseUrl: 'https://h.example',
            botId: 'b1',
            threadId: 't1',
            messageId: 'm1',
            connector: connector,
            onUpdated: (next) => updated = next,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect'), findsOneWidget);
    await tester.tap(find.byTooltip('Not now'));
    await tester.pumpAndSettle();
    expect(api.connectorCardWrites.single['action'], 'dismiss');
    expect(updated!.dismissed, isTrue);
  });

  test('ChatMessage parses show_html app rows and sent-from', () {
    final message = ChatMessage.fromJson({
      'id': 'm2',
      'role': 'bot',
      'kind': 'app',
      'text': 'Pick a slot',
      'app': {
        'v': 1,
        'source': 'html',
        'title': 'Booking',
        'doc': 'doc-1',
        'rev': 0,
        'bytes': 24,
        'border': true,
        'height': 240,
      },
    });
    expect(message.app!.title, 'Booking');
    expect(message.app!.frameHeight, 240);
    expect(message.blank, isFalse);
    final sent = ChatMessage.fromJson({
      'id': 'm3',
      'role': 'user',
      'kind': 'text',
      'text': '3pm',
      'fromApp': {'messageId': 'm2', 'title': 'Booking'},
    });
    expect(sent.fromApp!.title, 'Booking');
  });

  testWidgets('app card fetches the document and mounts the frame', (tester) async {
    final api = FakeApi()
      ..appDocument = const ChatAppDocument(
        messageId: 'm2',
        rev: 0,
        srcdoc: '<p>Pick a slot</p>',
        csp: "default-src 'none'",
        canMessage: true,
        canOpenLinks: false,
      );
    await tester.pumpWidget(
      MaterialApp(
        theme: MaxTokens.light(),
        home: Scaffold(
          body: AppCard(
            client: api,
            baseUrl: 'https://h.example',
            botId: 'b1',
            threadId: 't1',
            messageId: 'm2',
            payload: const ChatAppPayload(
              source: 'html',
              title: 'Booking',
              doc: 'doc-1',
              rev: 0,
              bytes: 24,
              border: true,
              height: 200,
            ),
            frameBuilder: (context, doc, height) => Text(doc.srcdoc),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text('Booking'), findsOneWidget);
    expect(find.text('<p>Pick a slot</p>'), findsOneWidget);
  });
}
