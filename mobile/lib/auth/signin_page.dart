import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'auth_state.dart';

/// Email OTP sign-in against a server.
class SignInPage extends StatefulWidget {
  const SignInPage({super.key, required this.auth});
  final AuthState auth;

  @override
  State<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends State<SignInPage> {
  final _urlController = TextEditingController(text: 'http://127.0.0.1:8799');
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
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
    _urlController.dispose();
    _emailController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  String get _baseUrl => _urlController.text.trim().replaceAll(RegExp(r'/+$'), '');

  Future<void> _start() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.emailStart(_baseUrl, _emailController.text.trim());
      setState(() => _codeSent = true);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // The auth state's client must own the session cookie, so verify
      // through a client it shares: signInWithEmail does the redeem.
      await widget.auth.signInWithEmail(
        baseUrl: _baseUrl,
        email: _emailController.text.trim(),
        code: _codeController.text.trim(),
      );
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in with email')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _urlController,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Server address'),
            onEditingComplete: _loadMethods,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Email',
              hintText: 'you@example.com',
            ),
          ),
          if (_codeSent) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _codeController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'One-time code',
                hintText: '8-digit code',
              ),
            ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : (_codeSent ? _verify : _start),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(_codeSent ? 'Verify code' : 'Send code'),
          ),
          for (final method in _methods)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton(
                onPressed: _busy ? null : () => _provider(method['id']!),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                child: Text('Continue with ${method['label']}'),
              ),
            ),
        ],
      ),
    );
  }
}
