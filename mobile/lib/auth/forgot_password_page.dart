import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../gallery/gallery_page.dart';
import 'auth_state.dart';
import 'signin_page.dart';

final _emailPattern = RegExp(r'^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$');
final _bareToken = RegExp(r'^[a-f0-9]{32}\.[A-Za-z0-9_-]{40,}$');

/// The token from a reset link, a pasted URL, or the token itself.
String? passwordResetToken(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  final uri = Uri.tryParse(trimmed);
  if (uri != null && uri.hasScheme) {
    final token = uri.queryParameters['token']?.trim();
    if (token != null && token.isNotEmpty) return token;
  }
  final embedded = RegExp(r'(?:^|[?&])token=([^&\s]+)').firstMatch(trimmed);
  if (embedded != null) {
    final token = Uri.decodeComponent(embedded.group(1)!).trim();
    if (token.isNotEmpty) return token;
  }
  if (_bareToken.hasMatch(trimmed)) return trimmed;
  return null;
}

class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({
    super.key,
    required this.auth,
    this.initialBaseUrl,
    this.initialEmail = '',
    this.initialToken,
  });

  final AuthState auth;
  final String? initialBaseUrl;
  final String initialEmail;
  final String? initialToken;

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  late final TextEditingController _email = TextEditingController(text: widget.initialEmail);
  final _link = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _sent = false;
  bool _done = false;
  bool _obscure = true;
  String? _error;

  MaximusApi get _client => widget.auth.client;

  String get _baseUrl =>
      (widget.initialBaseUrl ?? accountServerUrl()).replaceAll(RegExp(r'/+$'), '');

  @override
  void initState() {
    super.initState();
    final token = widget.initialToken?.trim() ?? '';
    if (token.isNotEmpty) {
      _link.text = token;
      _sent = true;
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _link.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (!_emailPattern.hasMatch(email)) {
      setState(() => _error = 'Enter the email on the account.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.requestPasswordReset(_baseUrl, email);
      if (mounted) setState(() => _sent = true);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final token = passwordResetToken(_link.text);
    if (token == null) {
      setState(() => _error = 'Paste the reset link from the email.');
      return;
    }
    if (_password.text.length < 8) {
      setState(() => _error = 'Use at least 8 characters.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.resetPassword(_baseUrl, token: token, password: _password.text);
      if (mounted) setState(() => _done = true);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  InputDecoration _field(String label, {String? hint, Widget? suffix}) {
    final scheme = Theme.of(context).colorScheme;
    return InputDecoration(
      labelText: label,
      hintText: hint,
      suffixIcon: suffix,
      filled: true,
      fillColor: scheme.surfaceContainerHighest,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 32),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: IconButton(
                onPressed: _busy ? null : () => Navigator.of(context).maybePop(),
                icon: const Icon(Icons.arrow_back),
                tooltip: 'Back',
              ),
            ),
            const SizedBox(height: 8),
            const MaximusMark(size: 56),
            const SizedBox(height: 20),
            Text('Reset password', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(
              _done
                  ? 'Your password is saved. Sign in with it on this phone, the web app, and the desktop.'
                  : 'We email a one-time link when this address has a password account.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 28),
            if (_done)
              FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                child: const Text('Back to sign in'),
              )
            else ...[
              if (!_sent) ...[
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _busy ? null : _send(),
                  decoration: _field('Email', hint: 'you@example.com'),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _send,
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  child: _busy
                      ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Email reset link'),
                ),
              ] else ...[
                Text(
                  'If an account exists for ${_email.text.trim()}, the link is on its way. Open it, or paste it here and choose a new password.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _link,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: _field('Reset link'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: _obscure,
                  autofillHints: const [AutofillHints.newPassword],
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _busy ? null : _reset(),
                  decoration: _field(
                    'New password',
                    hint: 'At least 8 characters',
                    suffix: IconButton(
                      onPressed: () => setState(() => _obscure = !_obscure),
                      icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      tooltip: _obscure ? 'Show password' : 'Hide password',
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _reset,
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  child: _busy
                      ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Save password'),
                ),
              ],
            ],
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!, style: TextStyle(color: scheme.error)),
              ),
          ],
        ),
      ),
    );
  }
}
