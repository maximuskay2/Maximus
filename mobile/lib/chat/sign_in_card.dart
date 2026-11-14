import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../automations/computer_page.dart';

/// Website sign-in request — Done / Cancel / open browser / save login.
class SignInCard extends StatefulWidget {
  const SignInCard({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
    required this.thread,
    required this.messageId,
    required this.signIn,
    this.onUpdated,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;
  final ThreadSummary thread;
  final String messageId;
  final SignInRequest signIn;
  final ValueChanged<SignInRequest>? onUpdated;

  @override
  State<SignInCard> createState() => _SignInCardState();
}

class _SignInCardState extends State<SignInCard> {
  bool _busy = false;
  bool _saving = false;
  String? _error;
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _totp = TextEditingController();

  SignInRequest get _card => widget.signIn;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _totp.dispose();
    super.dispose();
  }

  Future<void> _settle(String action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.settleSignInCard(
        widget.baseUrl,
        widget.bot.id,
        widget.messageId,
        threadId: widget.thread.threadId,
        action: action,
      );
      widget.onUpdated?.call(
        action == 'done'
            ? _card.copyWith(done: true)
            : _card.copyWith(cancelled: true),
      );
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open() async {
    if (_card.place == 'browser') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ComputerPage(
            client: widget.client,
            baseUrl: widget.baseUrl,
            bot: widget.bot,
            thread: widget.thread,
          ),
        ),
      );
      return;
    }
    final uri = Uri.tryParse(_card.url);
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _saveLogin() async {
    if (_busy) return;
    if (_username.text.trim().isEmpty || _password.text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.saveSignInLogin(
        widget.baseUrl,
        widget.bot.id,
        widget.messageId,
        threadId: widget.thread.threadId,
        username: _username.text.trim(),
        password: _password.text,
        totp: _totp.text.trim().isEmpty ? null : _totp.text.trim(),
      );
      _password.clear();
      widget.onUpdated?.call(
        _card.copyWith(savedLogin: _card.site, done: true),
      );
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (_card.answeredInChat) {
      return _settled(context, '${_card.site} · answered in chat');
    }
    if (_card.superseded || (_card.stopped && _card.isLive)) {
      return _settled(
        context,
        '${_card.site} · ${_card.superseded ? 'replaced' : 'turn stopped'}',
      );
    }
    if (!_card.isLive) {
      final status = _card.savedLogin != null
          ? 'login saved for ${_card.savedLogin}'
          : _card.done
              ? 'signed in'
              : _card.cancelled
                  ? 'cancelled'
                  : 'done';
      return _settled(context, '${_card.site} · $status');
    }

    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.login, size: 18, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Sign in',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _card.site,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (_card.reason != null && _card.reason!.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                '“${_card.reason}” — ${widget.bot.name}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontStyle: FontStyle.italic,
                    ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              _whereCopy(),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
            ),
            if (_saving) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _username,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Username',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _password,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Password',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _totp,
                decoration: const InputDecoration(
                  labelText: 'One-time code (optional)',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  FilledButton(
                    onPressed: _busy ? null : _saveLogin,
                    child: Text(_busy ? 'Saving…' : 'Save login'),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() => _saving = false),
                    child: const Text('Cancel'),
                  ),
                ],
              ),
            ] else ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: _busy ? null : () => _settle('cancel'),
                    child: const Text('Cancel'),
                  ),
                  OutlinedButton(
                    onPressed: _busy ? null : _open,
                    child: const Text('Open'),
                  ),
                  if (_card.place == 'browser')
                    OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() => _saving = true),
                      child: const Text('Save login'),
                    ),
                  FilledButton(
                    onPressed: _busy ? null : () => _settle('done'),
                    child: Text(_busy ? 'Working…' : 'Done'),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Password stays on the server. The bot never sees it.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 6),
              Text(
                _error!,
                style: TextStyle(color: scheme.error, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _whereCopy() {
    final name = widget.bot.name;
    return switch (_card.place) {
      'browser' => '$name needs you signed in in its browser.',
      'vm' || 'cloud' || 'local' =>
        '$name needs you signed in on the bot computer.',
      _ => '$name needs you signed in on ${_card.site}.',
    };
  }

  Widget _settled(BuildContext context, String text) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              fontStyle: FontStyle.italic,
            ),
      ),
    );
  }
}
