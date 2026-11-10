/// Parses the pairing links a phone camera can see.
///
/// Two shapes:
/// - Server link: `https://host/pair#code=XXXX-XXXX-XXXX` (printed by
///   `maximus pair`; the app redeems the code via POST /api/auth/pair).
/// - Native link: `maximus://pair?address=...&token=...&code=123456&name=...`
///   (`shared/pairing-link.ts`). The desktop companion E2E token flow is out
///   of scope: when the address is an https origin the app pairs by code.
/// - Bare code: `XXXX-XXXX-XXXX` typed or pasted by hand.
class ParsedPairing {
  const ParsedPairing({this.serverUrl, this.code, this.name});

  /// https origin of the server, or null when the scan carries no address.
  final String? serverUrl;

  /// Pairing code, or null when the scan carries none.
  final String? code;
  final String? name;

  static final _serverCode = RegExp(r'^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$');
  static final _digits6 = RegExp(r'^\d{6}$');

  static String _normalizeCode(String raw) {
    final cleaned = raw.trim().toUpperCase();
    if (_serverCode.hasMatch(cleaned)) return cleaned;
    // Accept pasted codes without dashes.
    final squashed = cleaned.replaceAll('-', '');
    if (RegExp(r'^[A-Z0-9]{12}$').hasMatch(squashed)) {
      return '${squashed.substring(0, 4)}-${squashed.substring(4, 8)}'
          '-${squashed.substring(8, 12)}';
    }
    if (_digits6.hasMatch(cleaned)) return cleaned;
    throw const FormatException('not a pairing code');
  }

  static ParsedPairing? tryParse(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;
    // Bare code.
    try {
      return ParsedPairing(code: _normalizeCode(text));
    } on FormatException {
      // Not a bare code; try link shapes below.
    }
    final uri = Uri.tryParse(text);
    if (uri == null) return null;
    // Server link: https://host/pair#code=XXXX-...
    if ((uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.path == '/pair') {
      final fragment = Uri.splitQueryString(uri.fragment);
      final code = fragment['code'];
      if (code == null) return null;
      try {
        final port = uri.hasPort ? ':${uri.port}' : '';
        return ParsedPairing(
          serverUrl: '${uri.scheme}://${uri.host}$port',
          code: _normalizeCode(code),
        );
      } on FormatException {
        return null;
      }
    }
    // Native link: maximus://pair?address=...&code=...&name=...
    if (uri.scheme == 'maximus' && uri.host == 'pair') {
      final query = uri.queryParameters;
      final address = query['address'];
      final code = query['code'];
      String? serverUrl;
      if (address != null) {
        final dial = Uri.tryParse(address);
        if (dial != null &&
            (dial.scheme == 'https' || dial.scheme == 'http')) {
          serverUrl = address.replaceAll(RegExp(r'/+$'), '');
        }
      }
      String? normalized;
      if (code != null) {
        try {
          normalized = _normalizeCode(code);
        } on FormatException {
          return null;
        }
      }
      if (serverUrl == null && normalized == null) return null;
      return ParsedPairing(
        serverUrl: serverUrl,
        code: normalized,
        name: query['name'],
      );
    }
    return null;
  }
}
