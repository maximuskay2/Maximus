import 'models.dart';

/// Same bounds as the web client's `LIVE_EVENTS_RETRY_MIN_MS` / `MAX_MS`.
const liveRetryMinMs = 500;
const liveRetryMaxMs = 10000;

/// Delay before reconnect attempt [attempt] (0 is the first retry): 500ms,
/// then doubled, capped at 10s.
int liveRetryDelayMs(int attempt) {
  var exponent = attempt;
  if (exponent < 0) exponent = 0;
  if (exponent > 20) exponent = 20;
  var delay = liveRetryMinMs;
  for (var i = 0; i < exponent; i++) {
    if (delay >= liveRetryMaxMs) return liveRetryMaxMs;
    delay *= 2;
  }
  return delay > liveRetryMaxMs ? liveRetryMaxMs : delay;
}

/// A reconnect whose `since` the server could not replay needs a fresh page.
bool liveEventsNeedSnapshot(String? requestedSince, Object? resumed) =>
    requestedSince != null && resumed != true;

/// Cursor to send on the next connect. A hello carries it in JSON; later
/// frames carry the SSE id.
String? liveEventCursor(LiveEvent event, String? current) {
  if (event.kind == 'hello') {
    final cursor = event.data['cursor'];
    if (cursor is String && cursor.isNotEmpty) return cursor;
    return current;
  }
  final id = event.id;
  if (id != null && id.isNotEmpty) return id;
  return current;
}

/// A dead sign-in stops the reconnect loop and returns the app to sign-in.
bool liveEventsEndSession(Object error) {
  if (error is ApiError) return error.unauthorized || error.status == 403;
  return false;
}

/// Network drops and 5xx reconnect. A bad request does not.
bool liveEventsShouldReconnect(Object error) {
  if (liveEventsEndSession(error)) return false;
  if (error is ApiError && error.status == 400) return false;
  return true;
}
