import 'dart:async';
import 'dart:convert';

import 'models.dart';

/// Minimal SSE parser for `/api/events`: splits `event:`/`data:` frames,
/// JSON-decodes the payload, and surfaces `{kind, ...payload}` live events.
/// Multi-line data blocks are joined with `\n` per the SSE spec; comment
/// lines (`: ...`) and the retry field are ignored.
class SseParser {
  final StreamController<LiveEvent> _events =
      StreamController<LiveEvent>.broadcast();
  final StringBuffer _data = StringBuffer();
  String _event = 'message';
  bool _hasData = false;

  Stream<LiveEvent> get events => _events.stream;

  void addLine(String line) {
    if (line.isEmpty) {
      _dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat
    final colon = line.indexOf(':');
    final field = (colon < 0 ? line : line.substring(0, colon)).trim();
    final value = colon < 0
        ? ''
        : line.substring(colon + 1).replaceFirst(RegExp('^ '), '');
    switch (field) {
      case 'event':
        _event = value;
        break;
      case 'data':
        if (_hasData) _data.writeln();
        _data.write(value);
        _hasData = true;
        break;
      default:
        break; // retry, id, and unknown fields are ignored
    }
  }

  void _dispatch() {
    if (!_hasData) {
      _event = 'message';
      return;
    }
    final raw = _data.toString();
    _data.clear();
    _hasData = false;
    final name = _event;
    _event = 'message';
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?>) {
        final kind = decoded['kind'] as String? ?? name;
        _events.add(LiveEvent(kind: kind, data: decoded));
      } else {
        _events.add(
          LiveEvent(kind: name, data: {'value': decoded}),
        );
      }
    } catch (_) {
      _events.add(LiveEvent(kind: name, data: {'text': raw}));
    }
  }

  Future<void> close() => _events.close();
}

/// The browser stream puts its message name on the SSE `event:` line and
/// leaves it out of the JSON. Viewers switch on `type`, so put the name back.
Map<String, Object?> browserLiveFrame(LiveEvent event) {
  final frame = Map<String, Object?>.from(event.data);
  final named = frame['type'];
  if (named is! String || named.isEmpty) frame['type'] = event.kind;
  return frame;
}

/// Binds a UTF-8 line stream (e.g. an HTTP response body) to an [SseParser].
///
/// Socket errors (server hangup, client close) route to [onError] so they
/// never surface as unhandled async errors; without a handler the parser
/// just closes.
StreamSubscription<String> bindLines(
  Stream<List<int>> bytes,
  SseParser parser, {
  void Function(Object error)? onError,
}) {
  return bytes
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen(
        parser.addLine,
        onError: (Object error) {
          if (onError != null) {
            onError(error);
          }
          parser.close();
        },
        onDone: () {
          parser.addLine('');
        },
      );
}
