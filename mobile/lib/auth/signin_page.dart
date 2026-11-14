import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../gallery/gallery_page.dart';
import 'auth_state.dart';

const _serverOverride = String.fromEnvironment('MAXIMUS_SERVER');

/// The server this phone signs in to. Nobody types an address.
/// Release/profile → `https://app.meetnote.cc`. Debug → local harness.
/// Optional `--dart-define=MAXIMUS_SERVER=…` overrides both (CI / sideload).
String accountServerUrl() {
  if (_serverOverride.isNotEmpty) return _serverOverride;
  if (kDebugMode) return EndpointPreset.local.url;
  return EndpointPreset.production.url;
}

/// Email OTP sign-in against a server.
class SignInPage extends StatefulWidget {
  const SignInPage({
    super.key,
    required this.auth,
    this.initialBaseUrl,
    this.creating = false,
  });
  final AuthState auth;
  final String? initialBaseUrl;
  final bool creating;

  @override
  State<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends State<SignInPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  late bool _creating = widget.creating;
  String? _error;
  List<Map<String, String>> _methods = const [];

  MaximusApi get _client => widget.auth.client;

  @override
  void initState() {
    super.initState();
    _loadMethods();
  }

  Future<void> _loadMethods() async {
    try {
      final methods = await _client.signInMethods(_baseUrl);
      if (mounted) setState(() => _methods = methods);
    } catch (_) {
      if (mounted) setState(() => _methods = const []);
    }
  }

  Future<void> _provider(String id) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final url = await _client.oauthStart(_baseUrl, id);
      final opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        setState(() => _error = 'The sign-in page could not be opened.');
      }
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  String get _baseUrl =>
      (widget.initialBaseUrl ?? accountServerUrl()).replaceAll(RegExp(r'/+$'), '');

  Future<void> _submit() async {
    final password = _passwordController.text;
    if (password.length < 8) {
      setState(() => _error = 'Use at least 8 characters.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_creating) {
        await widget.auth.signUpWithPassword(
          baseUrl: _baseUrl,
          email: _emailController.text.trim(),
          password: password,
        );
      } else {
        await widget.auth.signInWithPassword(
          baseUrl: _baseUrl,
          email: _emailController.text.trim(),
          password: password,
        );
      }
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _switchMode() {
    setState(() {
      _creating = !_creating;
      _error = null;
    });
  }

  InputDecoration _field(String label, {String? hint, Widget? prefix, Widget? suffix}) {
    final scheme = Theme.of(context).colorScheme;
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: prefix,
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
    final title = _creating ? 'Create account' : 'Sign in';
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 32),
          children: [
            if (Navigator.canPop(context))
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
            Text(title, style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text(
              _creating
                  ? 'One account works on this phone, the web app, and the desktop.'
                  : 'Use the email and password for your Maximus account.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 28),
            TextField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              decoration: _field(
                'Email',
                hint: 'you@example.com',
                prefix: const Icon(Icons.mail_outline),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passwordController,
              obscureText: _obscure,
              autofillHints: [
                _creating ? AutofillHints.newPassword : AutofillHints.password,
              ],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _busy ? null : _submit(),
              decoration: _field(
                'Password',
                hint: 'At least 8 characters',
                prefix: const Icon(Icons.lock_outline),
                suffix: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                  tooltip: _obscure ? 'Show password' : 'Hide password',
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: scheme.error.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Text(_error!, style: TextStyle(color: scheme.error)),
                  ),
                ),
              ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy ? null : _submit,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: _busy
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(title),
            ),
            if (_methods.isNotEmpty) ...[
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: TextStyle(color: scheme.onSurfaceVariant)),
                  ),
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                ],
              ),
              for (final method in _methods)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => _provider(method['id']!),
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    child: Text('Continue with ${method['label']}'),
                  ),
                ),
            ],
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    _creating ? 'Already have an account?' : 'New here?',
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : _switchMode,
                  child: Text(_creating ? 'Sign in' : 'Create account'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
