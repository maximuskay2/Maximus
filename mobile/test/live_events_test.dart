import 'package:flutter_test/flutter_test.dart';
import 'package:maximus/api/live_events.dart';
import 'package:maximus/api/models.dart';

void main() {
  test('backoff matches the web client bounds', () {
    expect(liveRetryDelayMs(0), 500);
    expect(liveRetryDelayMs(1), 1000);
    expect(liveRetryDelayMs(2), 2000);
    expect(liveRetryDelayMs(5), 10000);
    expect(liveRetryDelayMs(40), 10000);
  });

  test('a missed cursor asks for a fresh page', () {
    expect(liveEventsNeedSnapshot(null, false), isFalse);
    expect(liveEventsNeedSnapshot('ab:1', true), isFalse);
    expect(liveEventsNeedSnapshot('ab:1', false), isTrue);
    expect(liveEventsNeedSnapshot('ab:1', null), isTrue);
  });

  test('hello and later frames advance the cursor', () {
    expect(
      liveEventCursor(
        const LiveEvent(kind: 'hello', data: {'cursor': 'ab:4', 'resumed': false}),
        null,
      ),
      'ab:4',
    );
    expect(
      liveEventCursor(
        const LiveEvent(kind: 'message', data: {}, id: 'ab:5'),
        'ab:4',
      ),
      'ab:5',
    );
    expect(
      liveEventCursor(const LiveEvent(kind: 'ping', data: {}), 'ab:5'),
      'ab:5',
    );
  });

  test('a dead sign-in stops the loop and a drop reconnects', () {
    expect(liveEventsEndSession(ApiError(401, 'sign in')), isTrue);
    expect(liveEventsEndSession(ApiError(403, 'no')), isTrue);
    expect(liveEventsShouldReconnect(ApiError(401, 'sign in')), isFalse);
    expect(liveEventsShouldReconnect(ApiError(400, 'bad')), isFalse);
    expect(liveEventsShouldReconnect(ApiError(503, 'down')), isTrue);
    expect(liveEventsShouldReconnect(StateError('reset')), isTrue);
  });
}
