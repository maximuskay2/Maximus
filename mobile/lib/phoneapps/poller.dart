import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'executor.dart';
import 'policy.dart';

/// Asks the person about one job; true runs it. The host shows the
/// permission card and resolves when they answer (or it expires).
typedef JobApprover =
    Future<bool> Function(PhoneJob job, {required bool isWrite});

/// Polls the server for phone jobs while the app runs in the foreground,
/// applies the per-tool policy, and reports outcomes. One poll loop per
/// server; stopping unregisters nothing (registration persists).
class PhoneJobPoller extends ChangeNotifier {
  PhoneJobPoller({
    required this.client,
    required this.baseUrl,
    required this.executor,
    required this.policies,
    FlutterSecureStorage? storage,
    this.jobTimeout = const Duration(seconds: 40),
  }) : _storage = storage ?? const FlutterSecureStorage();

  final MaximusApi client;
  final String baseUrl;
  final PhoneToolExecutor executor;
  final PhonePolicyStore policies;
  final FlutterSecureStorage _storage;

  /// Local execution budget per job (server allows 45 s).
  final Duration jobTimeout;

  /// Injected by the host (permission cards). Null denies ask-policies.
  JobApprover? approver;

  bool _running = false;
  bool get running => _running;

  int _completed = 0;
  int get completed => _completed;

  String? _lastError;
  String? get lastError => _lastError;

  bool _foreground = true;

  /// The phone keeps polling only while the person can see it.
  set foreground(bool value) {
    _foreground = value;
    if (!value) notifyListeners();
  }

  /// Stable install id for PUT /api/phones/self (one per app install).
  /// Falls back to a session id when secure storage is unavailable
  /// (locked keychain, tests): polling still works, registration just
  /// looks like a fresh install next launch.
  Future<String> installId() async {
    if (_sessionInstall != null) return _sessionInstall!;
    const key = 'maximus.phone.install';
    try {
      final existing = await _storage.read(key: key);
      if (existing != null && existing.length >= 8) return existing;
      final fresh =
          '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-'
          '${baseUrl.hashCode.abs().toRadixString(36)}';
      await _storage.write(key: key, value: fresh);
      return fresh;
    } catch (_) {
      return _sessionInstall =
          'session-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}';
    }
  }

  String? _sessionInstall;

  /// Starts the loop; safe to call repeatedly.
  void start() {
    if (_running) return;
    _running = true;
    notifyListeners();
    unawaited(_loop());
  }

  void stop() {
    _running = false;
    notifyListeners();
  }

  Future<void> _loop() async {
    while (_running) {
      if (!_foreground) {
        await Future<void>.delayed(const Duration(seconds: 2));
        continue;
      }
      try {
        final job = await client.pollPhoneJob(baseUrl);
        if (!_running) return;
        if (job == null) {
          // The server normally holds the request (long poll); when it
          // answers fast with nothing to do, pause so we never spin.
          await Future<void>.delayed(const Duration(seconds: 1));
          continue;
        }
        await _handle(job);
      } on ApiError catch (error) {
        _lastError = error.status == 404
            ? 'Register this phone first.'
            : error.message;
        notifyListeners();
        // Back off before the next poll; a 404 (unregistered) waits
        // longer so a removed phone does not spin.
        await Future<void>.delayed(
          Duration(seconds: error.status == 404 ? 30 : 5),
        );
      } catch (_) {
        await Future<void>.delayed(const Duration(seconds: 5));
      }
    }
  }

  Future<void> _handle(PhoneJob job) async {
    final rules = await policies.read();
    final policy = rules[job.tool] ?? ToolPolicy.ask;
    if (policy == ToolPolicy.never) {
      await _complete(job, const PhoneOutcome.fail('Turned off on this phone.', code: 'denied'));
      return;
    }
    if (policy == ToolPolicy.ask) {
      final approver = this.approver;
      final allowed = approver == null
          ? false
          : await approver(job, isWrite: isPhoneWrite(job.tool));
      if (!_running || !_foreground) {
        await _complete(
          job,
          const PhoneOutcome.fail(
            'The app left the foreground.',
            code: 'foreground_required',
          ),
        );
        return;
      }
      if (!allowed) {
        await _complete(job, const PhoneOutcome.fail('Declined on this phone.', code: 'denied'));
        return;
      }
    }
    if (!await client.leasePhoneJob(baseUrl, job.id)) return;
    PhoneOutcome outcome;
    try {
      outcome = await executor.execute(job).timeout(
        jobTimeout,
        onTimeout: () => const PhoneOutcome.fail(
          'The phone took too long.',
          code: 'timeout',
        ),
      );
    } catch (error) {
      outcome = PhoneOutcome.fail('The phone could not run that: $error');
    }
    await _complete(job, outcome);
  }

  Future<void> _complete(PhoneJob job, PhoneOutcome outcome) async {
    try {
      await client.completePhoneJob(
        baseUrl,
        job.id,
        ok: outcome.ok,
        result: outcome.result,
        error: outcome.error,
        code: outcome.code,
      );
      _completed++;
      _lastError = null;
    } on ApiError catch (error) {
      _lastError = error.message;
    } finally {
      notifyListeners();
    }
  }

  /// This phone's platform string for registration.
  static String get platform => Platform.isIOS ? 'ios' : 'android';
}
