import 'package:flutter/material.dart';

import '../api/models.dart';
import '../auth/auth_state.dart';

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
    final active = widget.auth.active;
    if (active == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(
          'This phone forgets ${widget.serverName} and its session ends.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Stay'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.auth.client.logout(widget.baseUrl);
    } on ApiError {
      // The local forget below is what matters; a dead server
      // must never trap the phone.
    }
    await widget.auth.removeServer(active.id);
    if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
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
                  Text(_error!),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _load,
                    child: const Text('Retry'),
                  ),
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
