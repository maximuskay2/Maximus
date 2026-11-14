import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../auth/auth_state.dart';
import '../auth/session_actions.dart';

/// Connect your own LLM keys and provider accounts on this server.
class EnginesPage extends StatefulWidget {
  const EnginesPage({
    super.key,
    required this.client,
    required this.baseUrl,
    this.auth,
  });

  final MaximusApi client;
  final String baseUrl;
  final AuthState? auth;

  @override
  State<EnginesPage> createState() => _EnginesPageState();
}

class _EnginesPageState extends State<EnginesPage> {
  List<EngineInstance> _engines = const [];
  bool _loading = true;
  String? _error;
  String? _busyId;

  bool get _ownerOnly {
    final auth = widget.auth;
    return auth != null && auth.isChatOnly;
  }

  @override
  void initState() {
    super.initState();
    if (_ownerOnly) {
      _loading = false;
    } else {
      _reload();
    }
  }

  Future<void> _reload() async {
    if (_ownerOnly) {
      setState(() {
        _loading = false;
        _error = null;
        _engines = const [];
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final engines = await widget.client.listInstances(
        widget.baseUrl,
        fresh: true,
      );
      if (!mounted) return;
      setState(() {
        _engines = engines;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  Map<String, Object?>? _keyPatch(EngineInstance engine, String key) {
    final byId = switch (engine.instanceId) {
      'openai' => {'openai': {'key': key}},
      'openaiCompat' => {'openaiCompat': {'key': key}},
      'openrouter' => {'openrouter': {'key': key}},
      'claudeApi' => {'anthropic': {'key': key}},
      'xaiApi' || 'grok' => {'xai': {'key': key}},
      'mistral' => {'mistral': {'key': key}},
      'cerebras' => {'cerebras': {'key': key}},
      'groq' => {'groq': {'key': key}},
      'greenference' => {'greenference': {'key': key}},
      'meta' => {'meta': {'key': key}},
      'kimiApi' => {'kimi': {'key': key}},
      'deepseek' => {'deepseek': {'key': key}},
      'opencodeGo' => {'opencodeGo': {'apiKey': key}},
      _ => null,
    };
    if (byId != null) return byId;
    return switch (engine.driverKind) {
      'claudeAgent' => {'anthropic': {'key': key}},
      'grok' => {'xai': {'key': key}},
      'openai-compat' when engine.instanceId == 'openai' => {
          'openai': {'key': key},
        },
      'openai-compat' when engine.instanceId == 'openrouter' => {
          'openrouter': {'key': key},
        },
      'openai-compat' when engine.instanceId == 'openaiCompat' => {
          'openaiCompat': {'key': key},
        },
      'meta' => {'meta': {'key': key}},
      'mistral' => {'mistral': {'key': key}},
      'cerebras' => {'cerebras': {'key': key}},
      'groq' => {'groq': {'key': key}},
      'kimiApi' => {'kimi': {'key': key}},
      _ => null,
    };
  }

  Future<void> _saveKey(EngineInstance engine) async {
    final patchReady = _keyPatch(engine, 'x');
    if (patchReady == null) {
      _toast('This engine needs a custom endpoint — use Add endpoint.');
      return;
    }
    final key = await _promptSecret(
      title: 'API key for ${engine.displayName}',
      hint: 'Paste the secret key',
    );
    if (key == null || key.isEmpty) return;
    setState(() => _busyId = engine.instanceId);
    try {
      await widget.client.putConfig(widget.baseUrl, _keyPatch(engine, key)!);
      await _reload();
      _toast('${engine.displayName} key saved');
    } catch (error) {
      _toast('$error');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _connectAuth(EngineInstance engine) async {
    if (engine.chatgptOnDesktop) {
      _toast('Continue with ChatGPT on the computer running Maximus.');
      return;
    }
    if (engine.readOnly) {
      _toast('Company models are managed by an administrator.');
      return;
    }
    setState(() => _busyId = engine.instanceId);
    try {
      final started = await widget.client.startInstanceAuth(
        widget.baseUrl,
        engine.instanceId,
      );
      if (!mounted) return;
      if (started.succeeded) {
        await _reload();
        _toast('${engine.displayName} is connected');
        return;
      }
      if (!started.waiting || started.flowId == null) {
        throw StateError(started.message ?? 'Sign-in could not start.');
      }
      if (engine.authMethod == 'paste-code') {
        await _pasteFlow(engine, started);
      } else {
        await _deviceFlow(engine, started);
      }
    } catch (error) {
      _toast('$error');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _deviceFlow(EngineInstance engine, EngineAuthFlow started) async {
    final url = started.authorizationUrl;
    if (url != null && url.isNotEmpty) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _DeviceCodeDialog(
        engine: engine,
        flow: started,
        client: widget.client,
        baseUrl: widget.baseUrl,
        onDone: () {
          Navigator.of(context).pop();
          unawaited(_reload());
        },
      ),
    );
  }

  Future<void> _pasteFlow(EngineInstance engine, EngineAuthFlow started) async {
    final url = started.authorizationUrl;
    if (url != null && url.isNotEmpty) {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    }
    final code = await _promptSecret(
      title: 'Code for ${engine.displayName}',
      hint: 'Paste the sign-in code from the browser',
    );
    if (code == null || code.isEmpty) {
      await widget.client.cancelInstanceAuth(widget.baseUrl, engine.instanceId);
      return;
    }
    await widget.client.completeInstanceAuth(
      widget.baseUrl,
      engine.instanceId,
      flowId: started.flowId!,
      code: code,
    );
    await _reload();
    _toast('${engine.displayName} is connected');
  }

  Future<void> _addEndpoint() async {
    final name = TextEditingController(text: 'OpenAI-compatible');
    final url = TextEditingController(text: 'https://api.openai.com/v1');
    final key = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        final inset = MediaQuery.viewInsetsOf(context).bottom;
        return Padding(
          padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + inset),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Add endpoint', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Name'),
                textInputAction: TextInputAction.next,
              ),
              TextField(
                controller: url,
                decoration: const InputDecoration(
                  labelText: 'Base URL',
                  hintText: 'https://…/v1',
                ),
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.next,
              ),
              TextField(
                controller: key,
                decoration: const InputDecoration(labelText: 'API key'),
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Save'),
              ),
            ],
          ),
        );
      },
    );
    if (ok != true) return;
    setState(() => _busyId = 'add');
    try {
      await widget.client.addOpenaiCompat(
        widget.baseUrl,
        displayName: name.text.trim(),
        url: url.text.trim(),
        key: key.text.trim(),
      );
      await _reload();
      _toast('Endpoint added');
    } catch (error) {
      _toast('$error');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<String?> _promptSecret({
    required String title,
    required String hint,
  }) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(hintText: hint),
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    if (_ownerOnly && auth != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Your AI')),
        body: OwnerOnlyBody(
          auth: auth,
          baseUrl: widget.baseUrl,
          detail:
              'Connecting your own keys needs the home owner. Sign out, then sign in with the owner account.',
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your AI'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _reload,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busyId != null ? null : _addEndpoint,
        icon: const Icon(Icons.add),
        label: const Text('Add endpoint'),
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          children: [
            Text(
              'Connect the models you pay for yourself. Muse plans use our key — pick those under Subscribe.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.error_outline),
                  title: const Text('Engines did not load'),
                  subtitle: Text(_error!),
                  trailing: TextButton(onPressed: _reload, child: const Text('Retry')),
                ),
              )
            else if (_engines.isEmpty)
              const Card(
                child: ListTile(
                  title: Text('No engines on this server'),
                  subtitle: Text('Add an OpenAI-compatible endpoint to get started.'),
                ),
              )
            else
              for (final engine in _engines) _engineCard(context, engine),
          ],
        ),
      ),
    );
  }

  Widget _engineCard(BuildContext context, EngineInstance engine) {
    final scheme = Theme.of(context).colorScheme;
    final busy = _busyId == engine.instanceId;
    final status = engine.available
        ? 'Ready'
        : (engine.reason?.isNotEmpty == true ? engine.reason! : engine.state);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    engine.displayName,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Icon(
                  engine.available ? Icons.check_circle_outline : Icons.pending_outlined,
                  size: 18,
                  color: engine.available ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              status,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
            ),
            if (engine.url != null) ...[
              const SizedBox(height: 2),
              Text(
                engine.url!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (engine.canSignIn || engine.chatgptOnDesktop)
                  FilledButton(
                    onPressed: busy || engine.readOnly
                        ? null
                        : () => _connectAuth(engine),
                    child: Text(busy ? 'Working…' : 'Sign in'),
                  ),
                if (engine.needsKey ||
                    (engine.access == 'api' && _keyPatch(engine, 'x') != null))
                  OutlinedButton(
                    onPressed: busy || engine.readOnly
                        ? null
                        : () => _saveKey(engine),
                    child: Text(engine.available ? 'Change key' : 'Add key'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceCodeDialog extends StatefulWidget {
  const _DeviceCodeDialog({
    required this.engine,
    required this.flow,
    required this.client,
    required this.baseUrl,
    required this.onDone,
  });

  final EngineInstance engine;
  final EngineAuthFlow flow;
  final MaximusApi client;
  final String baseUrl;
  final VoidCallback onDone;

  @override
  State<_DeviceCodeDialog> createState() => _DeviceCodeDialogState();
}

class _DeviceCodeDialogState extends State<_DeviceCodeDialog> {
  late EngineAuthFlow _flow = widget.flow;
  Timer? _poll;
  String? _error;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _tick());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    final flowId = _flow.flowId;
    if (flowId == null) return;
    try {
      final next = await widget.client.instanceAuthStatus(
        widget.baseUrl,
        widget.engine.instanceId,
        flowId: flowId,
      );
      if (!mounted) return;
      setState(() => _flow = next);
      if (next.succeeded) {
        _poll?.cancel();
        widget.onDone();
      } else if (!next.waiting) {
        _poll?.cancel();
        setState(() => _error = next.message ?? 'Sign-in ended.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _cancel() async {
    _poll?.cancel();
    try {
      await widget.client.cancelInstanceAuth(
        widget.baseUrl,
        widget.engine.instanceId,
      );
    } catch (_) {}
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final code = _flow.userCode;
    return AlertDialog(
      title: Text('Sign in to ${widget.engine.displayName}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (code != null && code.isNotEmpty) ...[
            const Text('Enter this code at the provider page:'),
            const SizedBox(height: 8),
            SelectableText(
              code,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code));
              },
              icon: const Icon(Icons.copy_outlined, size: 16),
              label: const Text('Copy code'),
            ),
          ] else
            const Text('Finish signing in in the browser. This dialog closes when it succeeds.'),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(onPressed: _cancel, child: const Text('Cancel')),
      ],
    );
  }
}
