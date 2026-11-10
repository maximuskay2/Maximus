import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Per-tool policy on this phone: ask every time, always run, or never.
enum ToolPolicy { ask, always, never }

ToolPolicy toolPolicyFrom(String? value) => switch (value) {
  'always' => ToolPolicy.always,
  'never' => ToolPolicy.never,
  _ => ToolPolicy.ask,
};

String toolPolicyName(ToolPolicy policy) => switch (policy) {
  ToolPolicy.ask => 'ask',
  ToolPolicy.always => 'always',
  ToolPolicy.never => 'never',
};

/// Persists per-tool policies as JSON in the app support directory
/// (this phone's rules; the server keeps per-bot grants separately).
class PhonePolicyStore {
  PhonePolicyStore({this.dir});

  final Directory? dir;

  
  Future<File> _file() async {
    final resolved = dir ?? await getApplicationSupportDirectory();
    return File('${resolved.path}/maximus-phone-policy.json');
  }

  Future<Map<String, ToolPolicy>> read() async {
    try {
      final file = await _file();
      if (!await file.exists()) return {};
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map) return {};
      return {
        for (final e in decoded.entries)
          if (e.key is String) e.key as String: toolPolicyFrom(e.value as String?),
      };
    } catch (_) {
      return {};
    }
  }

  Future<void> write(String tool, ToolPolicy policy) async {
    final policies = await read();
    policies[tool] = policy;
    try {
      final file = await _file();
      await file.writeAsString(
        jsonEncode({
          for (final e in policies.entries) e.key: toolPolicyName(e.value),
        }),
        flush: true,
      );
    } catch (_) {}
  }
}
