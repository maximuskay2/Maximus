import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/models.dart';
import 'package:maximus/api/sse.dart';

Future<List<LiveEvent>> parseLines(List<String> lines) async {
  final parser = SseParser();
  final seen = <LiveEvent>[];
  final sub = parser.events.listen(seen.add);
  for (final line in lines) {
    parser.addLine(line);
  }
  parser.addLine('');
  await Future<void>.delayed(Duration.zero);
  await sub.cancel();
  await parser.close();
  return seen;
}

void main() {
  test('parses a single JSON event', () async {
    final events = await parseLines([
      'event: message',
      'data: {"kind":"message","id":"m1"}',
    ]);
    expect(events, hasLength(1));
    expect(events.first.kind, 'message');
    expect(events.first.data['id'], 'm1');
  });

  test('joins multi-line data blocks', () async {
    final events = await parseLines([
      'data: {"kind":"note",',
      'data: "text":"hi"}',
    ]);
    expect(events, hasLength(1));
    expect(events.first.kind, 'note');
  });

  test('ignores comments and retry fields', () async {
    final events = await parseLines([
      ': heartbeat',
      'retry: 3000',
      'data: {"kind":"ping"}',
    ]);
    expect(events, hasLength(1));
    expect(events.first.kind, 'ping');
  });

  test('a browser frame keeps the event name as its type', () {
    final frame = browserLiveFrame(
      const LiveEvent(kind: 'ready', data: {'viewerId': 'v1'}),
    );
    expect(frame['type'], 'ready');
    expect(frame['viewerId'], 'v1');
    final kept = browserLiveFrame(
      const LiveEvent(kind: 'message', data: {'type': 'frame', 'seq': 1}),
    );
    expect(kept['type'], 'frame');
  });

  test('falls back to the event name without a kind', () async {
    final events = await parseLines(['event: presence', 'data: {"n":1}']);
    expect(events.first.kind, 'presence');
  });

  test('keeps malformed payloads as text', () async {
    final events = await parseLines(['data: not-json{{{']);
    expect(events.first.data['text'], 'not-json{{{');
  });

  test('dispatches separate frames', () async {
    final events = await parseLines([
      'data: {"kind":"a"}',
      '',
      'data: {"kind":"b"}',
    ]);
    expect([for (final e in events) e.kind], ['a', 'b']);
  });

  test('bindLines routes socket errors to onError', () async {
    final parser = SseParser();
    Object? seen;
    final controller = StreamController<List<int>>();
    bindLines(
      controller.stream,
      parser,
      onError: (error) => seen = error,
    );
    controller.addError(HttpException('boom'));
    await pumpEventQueue();
    expect(seen, isA<HttpException>());
    await controller.close();
  });

  test('bindLines without onError closes quietly', () async {
    final parser = SseParser();
    final controller = StreamController<List<int>>();
    var done = false;
    parser.events.listen((_) {}, onDone: () => done = true);
    bindLines(controller.stream, parser);
    controller.addError(HttpException('boom'));
    await pumpEventQueue();
    expect(done, isTrue);
    await controller.close();
  });
}
