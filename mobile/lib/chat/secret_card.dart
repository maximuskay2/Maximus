import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import 'credential_patch.dart';

/// Secure credential / mailbox card — same save path as desktop SecretRequestCard.
class SecretCard extends StatefulWidget {
  const SecretCard({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.botId,
    required this.threadId,
    required this.messageId,
    required this.secret,
    this.onUpdated,
  });

  final MaximusApi client;
  final String baseUrl;
  final String botId;
  final String threadId;
  final String messageId;
  final SecretRequest secret;
  final ValueChanged<SecretRequest>? onUpdated;

  @override
  State<SecretCard> createState() => _SecretCardState();
}

class _SecretCardState extends State<SecretCard> {
  late final _value = TextEditingController();
  late final _address = TextEditingController(text: widget.secret.address ?? '');
  bool _saving = false;
  bool _needsServer = false;
  String? _error;
  final _imapHost = TextEditingController();
  final _imapPort = TextEditingController(text: '993');
  final _smtpHost = TextEditingController();
  final _smtpPort = TextEditingController(text: '465');
  final _username = TextEditingController();

  SecretRequest get _secret => widget.secret;

  @override
  void dispose() {
    _value.dispose();
    _address.dispose();
    _imapHost.dispose();
    _imapPort.dispose();
    _smtpHost.dispose();
    _smtpPort.dispose();
    _username.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    final value = _value.text;
    if (value.trim().isEmpty && !_secret.email) return;
    if (_secret.email && _address.text.trim().isEmpty) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      if (isCustomOrEmailTarget(_secret.target, _secret.delivery)) {
        await widget.client.saveSecretCard(
          widget.baseUrl,
          widget.botId,
          widget.messageId,
          threadId: widget.threadId,
          value: value,
          address: _secret.email ? _address.text.trim() : null,
          server: _needsServer
              ? {
                  'imapHost': _imapHost.text.trim(),
                  'imapPort': int.tryParse(_imapPort.text.trim()) ?? 993,
                  'smtpHost': _smtpHost.text.trim(),
                  'smtpPort': int.tryParse(_smtpPort.text.trim()) ?? 465,
                  if (_username.text.trim().isNotEmpty)
                    'username': _username.text.trim(),
                }
              : null,
        );
      } else if (isOnePasswordTarget(_secret.target)) {
        await widget.client.saveOnePasswordToken(widget.baseUrl, value.trim());
        await widget.client.settleSecretCard(
          widget.baseUrl,
          widget.botId,
          widget.messageId,
          threadId: widget.threadId,
          action: 'provided',
        );
      } else {
        final patch = configPatchForCredential(_secret.target, value.trim());
        if (patch == null) {
          throw StateError('This credential must be saved on desktop for now.');
        }
        await widget.client.putConfig(widget.baseUrl, patch);
        await widget.client.settleSecretCard(
          widget.baseUrl,
          widget.botId,
          widget.messageId,
          threadId: widget.threadId,
          action: 'provided',
        );
      }
      _value.clear();
      widget.onUpdated?.call(_secret.copyWith(provided: true));
    } on ApiError catch (error) {
      final needs = error.details?['needsServer'] == true;
      setState(() {
        _error = error.message;
        if (needs) _needsServer = true;
      });
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _dismiss() async {
    try {
      await widget.client.settleSecretCard(
        widget.baseUrl,
        widget.botId,
        widget.messageId,
        threadId: widget.threadId,
        action: 'dismiss',
      );
      widget.onUpdated?.call(_secret.copyWith(dismissed: true));
    } catch (error) {
      setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (_secret.superseded) {
      return _settled(context, '${_secret.label} · replaced by a newer request');
    }
    if (_secret.stopped && !_secret.provided) {
      return _settled(context, '${_secret.label} · turn stopped');
    }
    if (_secret.provided || _secret.dismissed) {
      final label = _secret.provided
          ? '${_secret.label} saved'
          : _secret.label;
      final status = _secret.dismissed
          ? 'not now'
          : _secret.resumed
              ? 'bot continuing'
              : 'saved';
      return _settled(context, '$label · $status');
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
                Icon(Icons.lock_outline, size: 18, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _secret.label,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                TextButton(
                  onPressed: _saving ? null : _dismiss,
                  child: const Text('Not now'),
                ),
              ],
            ),
            if (_secret.description.isNotEmpty || (_secret.reason?.isNotEmpty ?? false)) ...[
              const SizedBox(height: 4),
              Text(
                _secret.reason?.isNotEmpty == true
                    ? _secret.reason!
                    : _secret.description,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
              ),
            ],
            if (_secret.email) ...[
              const SizedBox(height: 10),
              TextField(
                controller: _address,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Email address',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              if (_needsServer) ...[
                const SizedBox(height: 8),
                TextField(
                  controller: _imapHost,
                  decoration: const InputDecoration(
                    labelText: 'IMAP host',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _imapPort,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'IMAP port',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _smtpHost,
                  decoration: const InputDecoration(
                    labelText: 'SMTP host',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _smtpPort,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'SMTP port',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _username,
                  decoration: const InputDecoration(
                    labelText: 'Username (if different)',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ],
            const SizedBox(height: 10),
            TextField(
              controller: _value,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              decoration: InputDecoration(
                labelText: _secret.email ? 'Password' : _secret.placeholder.isEmpty
                    ? 'Secret'
                    : _secret.placeholder,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.lock, size: 16),
                  label: Text(_saving ? 'Saving…' : 'Save securely'),
                ),
                if (_secret.helpUrl.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () {
                      final uri = Uri.tryParse(_secret.helpUrl);
                      if (uri != null) {
                        launchUrl(uri, mode: LaunchMode.externalApplication);
                      }
                    },
                    child: const Text('Where to get it'),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _secret.email
                  ? 'Stored for the email connector. The bot never sees the password.'
                  : 'Stored on this server. The bot never sees the secret.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
            ),
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
