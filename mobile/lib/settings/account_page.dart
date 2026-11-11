import 'package:flutter/material.dart';

import '../api/models.dart';
import '../auth/auth_state.dart';
import '../auth/session_actions.dart';

/// Phase 7: who this phone is to the server, plus sign-out.
class AccountPage extends StatefulWidget {
  const AccountPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.serverName,
  });

  final AuthState auth;
  final String baseUrl;
  final String serverName;

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  AuthSessionInfo? _info;
  bool _loading = true;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final info = await widget.auth.client.authSession(widget.baseUrl);
      if (mounted) setState(() => _info = info);
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _signOut() async {
    setState(() => _busy = true);
    await signOutOfActiveServer(context, widget.auth);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(_error!, textAlign: TextAlign.center),
                  ),
                  const SizedBox(height: 16),
                  SessionActions(
                    auth: widget.auth,
                    baseUrl: widget.baseUrl,
                  ),
                  const SizedBox(height: 8),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.only(bottom: 32),
              children: [
                ListTile(
                  leading: const Icon(Icons.dns_outlined),
                  title: Text(widget.serverName),
                  subtitle: Text(widget.baseUrl),
                ),
                ListTile(
                  leading: const Icon(Icons.phone_android_outlined),
                  title: Text(info?.label ?? 'This phone'),
                  subtitle: Text(
                    info == null
                        ? ''
                        : '${info.kind} · ${info.scopes.join(', ')}',
                  ),
                ),
                if (info?.email != null)
                  ListTile(
                    leading: const Icon(Icons.mail_outline),
                    title: Text(info!.email!),
                    subtitle: const Text('Verified sign-in'),
                  ),
                if (info?.expiresAt != null)
                  ListTile(
                    leading: const Icon(Icons.timelapse_outlined),
                    title: const Text('Session ends'),
                    subtitle: Text(
                      DateTime.fromMillisecondsSinceEpoch(
                        info!.expiresAt!,
                      ).toLocal().toString().split('.').first,
                    ),
                  ),
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: FilledButton.tonal(
                    onPressed: _busy ? null : _signOut,
                    child: Text(_busy ? 'Signing out…' : 'Sign out'),
                  ),
                ),
              ],
            ),
    );
  }
}
