import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Connect-apps card — authorize Composio/MCP, poll until connected, resume.
class ConnectorCard extends StatefulWidget {
  const ConnectorCard({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.botId,
    required this.threadId,
    required this.messageId,
    required this.connector,
    this.onUpdated,
  });

  final MaximusApi client;
  final String baseUrl;
  final String botId;
  final String threadId;
  final String messageId;
  final ConnectorRequest connector;
  final ValueChanged<ConnectorRequest>? onUpdated;

  @override
  State<ConnectorCard> createState() => _ConnectorCardState();
}

class _ConnectorCardState extends State<ConnectorCard>
    with WidgetsBindingObserver {
  bool _busy = false;
  String? _error;
  Timer? _poll;
  String? _authUrl;

  ConnectorRequest get _connector => widget.connector;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (_connector.authorizing) _startPoll();
  }

  @override
  void didUpdateWidget(covariant ConnectorCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_connector.authorizing && _poll == null) {
      _startPoll();
    } else if (!_connector.authorizing) {
      _poll?.cancel();
      _poll = null;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _connector.authorizing) {
      unawaited(_checkConnected());
    }
  }

  void _startPoll() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 4), (_) {
      unawaited(_checkConnected());
    });
  }

  Future<void> _checkConnected() async {
    try {
      final connected = await widget.client.connectorCardStatus(
        widget.baseUrl,
        widget.botId,
        widget.messageId,
        threadId: widget.threadId,
      );
      if (connected && mounted) {
        _poll?.cancel();
        _poll = null;
        widget.onUpdated?.call(_connector.copyWith(status: 'connected'));
      }
    } catch (_) {}
  }

  Future<void> _connect() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final url = _authUrl ??
          await widget.client.authorizeConnectorCard(
            widget.baseUrl,
            widget.botId,
            widget.messageId,
            threadId: widget.threadId,
          );
      _authUrl = url;
      final uri = Uri.tryParse(url);
      if (uri == null) throw StateError('Invalid authorization URL');
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) throw StateError('Could not open the authorization page');
      widget.onUpdated?.call(_connector.copyWith(status: 'authorizing'));
      _startPoll();
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resume() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.client.resumeConnectorCard(
        widget.baseUrl,
        widget.botId,
        widget.messageId,
        threadId: widget.threadId,
      );
      widget.onUpdated?.call(_connector.copyWith(resumed: true));
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _dismiss() async {
    setState(() => _busy = true);
    try {
      await widget.client.dismissConnectorCard(
        widget.baseUrl,
        widget.botId,
        widget.messageId,
        threadId: widget.threadId,
      );
      widget.onUpdated?.call(_connector.copyWith(dismissed: true));
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_connector.gone) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    if (_connector.stopped && !_connector.connected) {
      return _line(context, '${_connector.label} · stopped');
    }
    if (_connector.connected) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          children: [
            Icon(Icons.check_circle_outline, size: 18, color: scheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${_connector.label} · connected'
                '${_connector.resumed ? ' · continuing' : ''}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            if (!_connector.resumed && !_connector.stopped)
              TextButton(
                onPressed: _busy ? null : _resume,
                child: const Text('Continue'),
              ),
          ],
        ),
      );
    }
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFE5E5EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.extension_outlined, size: 20, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _connector.label,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              if (!_busy)
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  tooltip: 'Not now',
                  onPressed: _dismiss,
                ),
            ],
          ),
          if (_connector.description.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              _connector.description,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          if (_error != null || _connector.error != null) ...[
            const SizedBox(height: 6),
            Text(
              _error ?? _connector.error!,
              style: TextStyle(color: scheme.error, fontSize: 13),
            ),
          ],
          const SizedBox(height: 10),
          if (_connector.authorizing)
            Row(
              children: [
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Waiting for you to finish signing in…',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : _connect,
                  child: const Text('Open again'),
                ),
              ],
            )
          else
            FilledButton(
              onPressed: _busy ? null : _connect,
              child: Text(_connector.isMcp ? 'Sign in' : 'Connect'),
            ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: LinearProgressIndicator(),
            ),
        ],
      ),
    );
  }

  Widget _line(BuildContext context, String text) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(text, style: Theme.of(context).textTheme.bodySmall),
    );
  }
}
