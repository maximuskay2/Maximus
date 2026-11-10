/// Phase 9: `maximus://` links from Siri, Shortcuts, and the Action
/// button. Hosts: bots, thread, dictate, call.
class AppLink {
  const AppLink._(this.kind, {this.botName, this.text, this.threadId});

  /// bots — open the bots tab.
  static const bots = AppLink._(AppLinkKind.bots);

  final AppLinkKind kind;

  /// Bot display name (matched case-insensitively at open time).
  final String? botName;

  /// Prefilled message (thread links).
  final String? text;

  /// Exact thread to open when known.
  final String? threadId;

  static AppLink? parse(Uri uri) {
    if (uri.scheme != 'maximus') return null;
    switch (uri.host) {
      case 'bots':
        return bots;
      case 'thread':
        return AppLink._(
          AppLinkKind.thread,
          botName: _query(uri, 'bot'),
          text: _query(uri, 'text'),
          threadId: _query(uri, 'thread'),
        );
      case 'dictate':
        return AppLink._(
          AppLinkKind.dictate,
          botName: _query(uri, 'bot'),
          threadId: _query(uri, 'thread'),
        );
      case 'call':
        return AppLink._(
          AppLinkKind.call,
          botName: _query(uri, 'bot'),
          threadId: _query(uri, 'thread'),
        );
      default:
        return null;
    }
  }

  static String? _query(Uri uri, String name) {
    final value = uri.queryParameters[name]?.trim();
    return value == null || value.isEmpty ? null : value;
  }

  @override
  String toString() =>
      'AppLink($kind, botName: $botName, threadId: $threadId)';
}

enum AppLinkKind { bots, thread, dictate, call }
