/// Phase 10: single version source. The mobile app versions from the root
/// `package.json` (`versionName`), with the build number carried after `+`.
///
///   dart tool/sync_version.dart [--build <n>] [--check]
///
/// `--check` exits 1 when pubspec.yaml disagrees (CI gate); otherwise the
/// pubspec is rewritten, preserving its `+build` unless `--build` is given.
library;

import 'dart:convert';
import 'dart:io';

void main(List<String> args) {
  var build = '';
  var check = false;
  for (var i = 0; i < args.length; i++) {
    if (args[i] == '--check') {
      check = true;
    } else if (args[i] == '--build' && i + 1 < args.length) {
      build = '+${args[++i]}';
    } else {
      stderr.writeln('usage: sync_version.dart [--build <n>] [--check]');
      exit(2);
    }
  }

  final root = Directory.current.path.endsWith('mobile')
      ? Directory.current.parent.path
      : Directory.current.path;
  final pkg =
      jsonDecode(File('$root/package.json').readAsStringSync())
          as Map<String, dynamic>;
  final versionName = pkg['version'] as String;
  if (!RegExp(r'^\d+\.\d+\.\d+$').hasMatch(versionName)) {
    stderr.writeln('package.json version "$versionName" is not x.y.z');
    exit(2);
  }

  final pubspec = File('$root/mobile/pubspec.yaml');
  final text = pubspec.readAsStringSync();
  final match = RegExp(r'^version:\s*([^\s]+)\s*$', multiLine: true)
      .firstMatch(text);
  if (match == null) {
    stderr.writeln('no version: line in mobile/pubspec.yaml');
    exit(2);
  }
  if (build.isEmpty) {
    final plus = match.group(1)!.indexOf('+');
    build = plus >= 0 ? match.group(1)!.substring(plus) : '+1';
  }
  if (!RegExp(r'^\+\d+$').hasMatch(build)) {
    stderr.writeln('build "$build" is not +<int>');
    exit(2);
  }
  final want = 'version: $versionName$build';
  if (check) {
    if (match.group(0) != want) {
      stderr.writeln(
        'pubspec says "${match.group(1)}", want "$versionName$build". '
        'Run dart tool/sync_version.dart from mobile/.',
      );
      exit(1);
    }
    stdout.writeln('version ok: $versionName$build');
    return;
  }
  pubspec.writeAsStringSync(
    text.replaceFirst(match.group(0)!, want),
  );
  stdout.writeln('synced: $want');
}
