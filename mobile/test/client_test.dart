import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';

/// In-process stub of the Maximus server surface the app uses.
Future<HttpServer> startStub() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((request) async {
    final path = request.uri.path;
    final response = request.response..headers.contentType = ContentType.json;
    void write(Object body, {int status = 200}) {
      response.statusCode = status;
      response.write(jsonEncode(body));
      response.close();
    }

    if (path == '/api/health') {
      write({'ok': true});
    } else if (path == '/api/bots' && request.method == 'GET') {
      write({
        'bots': [
          {
            'id': 'b1', 'name': 'Max', 'title': 'Max', 'description': 'd',
            'threadId': 't1', 'notifications': true, 'color': 'ember',
            'avatarUrl': null, 'unread': true,
          },
        ],
      });
    } else if (path == '/api/threads/t1/messages') {
      write({
        'messages': [
          {'id': 'm1', 'role': 'user', 'kind': 'text', 'text': 'hi'},
        ],
        'hasMore': true,
      });
    } else if (path == '/api/bots/b1/messages' && request.method == 'POST') {
      final body = jsonDecode(await utf8.decoder.bind(request).join())
          as Map<String, Object?>;
      write({
        'message': {
          'id': 'm2', 'role': 'user', 'kind': 'text', 'text': body['text'],
        },
      });
    } else if (path == '/api/auth/pair' && request.method == 'POST') {
      response.headers.add('set-cookie', 'maximus_session=abc; Path=/');
      write({
        'token': 'tok-1',
        'session': {'scopes': ['client']},
      });
    } else if (path == '/api/search') {
      write({
        'hits': [
          {'kind': 'message', 'id': 'm1'},
        ],
      });
    } else if (path == '/v1/installations/self/push') {
      response.headers.contentType = ContentType.html;
      response.write('<!doctype html><html></html>');
      await response.close();
    } else if (path == '/api/events') {
      response.headers.contentType =
          ContentType.parse('text/event-stream; charset=utf-8');
      response.write('data: {"kind":"ping"}\n\n');
      await response.close();
    } else {
      write({'error': 'not here', 'code': 'nope'}, status: 404);
    }
  });
  return server;
}

void main() {
  late HttpServer stub;
  late MaximusClient client;
  late String base;

  setUpAll(() async {
    stub = await startStub();
    base = 'http://127.0.0.1:${stub.port}';
    client = MaximusClient();
  });

  tearDownAll(() async {
    client.close();
    await stub.close(force: true);
  });

  test('probe reaches health', () async {
    expect(await client.probe(base), isTrue);
    expect(await client.probe('http://127.0.0.1:1'), isFalse);
  });

  test('lists bots', () async {
    final bots = await client.bots(base);
    expect(bots, hasLength(1));
    expect(bots.first.name, 'Max');
    expect(bots.first.unread, isTrue);
  });

  test('reads a thread page', () async {
    final page = await client.threadMessages(base, 't1');
    expect(page.messages.first.text, 'hi');
    expect(page.hasMore, isTrue);
  });

  test('sends a message', () async {
    final message = await client.sendMessage(base, 'b1', 'hello');
    expect(message.text, 'hello');
  });

  test('pairs and keeps the session cookie', () async {
    final paired = await client.pair(
      base,
      code: 'ABCD-EFGH',
      label: 'test phone',
    );
    expect(paired.token, 'tok-1');
    expect(paired.scopes, ['client']);
  });

  test('searches', () async {
    final hits = await client.search(base, 'hi');
    expect(hits, hasLength(1));
  });

  test('streams events', () async {
    final kinds = <String>[];
    final sub = await client.events(base, (event) => kinds.add(event.kind));
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (kinds.isEmpty && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 25));
    }
    await sub.cancel();
    expect(kinds, ['ping']);
  });

  test('an HTML success is an API error, not a crash', () async {
    expect(
      () => client.pushStatus(base),
      throwsA(
        isA<ApiError>().having(
          (error) => error.message,
          'message',
          'The server returned a page instead of data.',
        ),
      ),
    );
  });

  test('maps error bodies', () async {
    try {
      await client.threadMessages(base, 'nope');
      fail('expected ApiError');
    } on ApiError catch (error) {
      expect(error.status, 404);
      expect(error.message, 'not here');
      expect(error.code, 'nope');
    }
  });
}
