import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Named computers the person can send work to.
class MachinesPage extends StatefulWidget {
  const MachinesPage({
    super.key,
    required this.client,
    required this.baseUrl,
    this.threadId,
    this.botId,
  });

  final MaximusApi client;
  final String baseUrl;
  final String? threadId;
  final String? botId;

  @override
  State<MachinesPage> createState() => _MachinesPageState();
}

class _MachinesPageState extends State<MachinesPage> {
  AgentOsMachinesPayload? _payload;
  List<AgentOsPlugin> _plugins = const [];
  bool _loading = true;
  String? _error;
  String? _picked;

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
      final payload = await widget.client.agentOsMachines(widget.baseUrl);
      final assigned = await widget.client.agentOsAssignment(
        widget.baseUrl,
        threadId: widget.threadId,
        botId: widget.botId,
      );
      final plugins = await widget.client.agentOsPlugins(widget.baseUrl);
      if (mounted) {
        setState(() {
          _payload = payload;
          _plugins = plugins;
          _picked = assigned ?? _picked ?? payload.selfId;
        });
      }
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _select(AgentOsMachine machine) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.client.assignAgentOsMachine(
        widget.baseUrl,
        machineId: machine.id,
        threadId: widget.threadId,
        botId: widget.botId,
      );
      if (!mounted) return;
      setState(() => _picked = machine.id);
      if (!machine.online) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              '${machine.name} is asleep. This thread waits here — it will not run on the phone\'s cloud. Wake that computer, then try again.',
            ),
          ),
        );
        return;
      }
      final routed = await widget.client.routeAgentOs(
        widget.baseUrl,
        machineId: machine.id,
        botId: widget.botId,
      );
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            routed['target'] == 'local'
                ? 'This computer will run the next approved action.'
                : '${machine.name} will run the next approved action.',
          ),
        ),
      );
    } on ApiError catch (error) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  static const _writes = {'post', 'update', 'publish', 'push', 'comment'};

  Future<void> _approve(AgentOsPlugin plugin, String action) async {
    final messenger = ScaffoldMessenger.of(context);
    if (_writes.contains(action)) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Send $action to ${plugin.app} as you?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Approve')),
          ],
        ),
      );
      if (ok != true) return;
    }
    try {
      final result = await widget.client.invokeAgentOsPlugin(
        widget.baseUrl,
        mode: plugin.mode,
        app: plugin.app,
        action: action,
        confirm: _writes.contains(action),
        threadId: widget.threadId,
        botId: widget.botId,
      );
      if (!mounted) return;
      final preview = result['preview'];
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            preview is String && preview.isNotEmpty
                ? preview
                : 'Approved $action on ${plugin.app} as you. That computer runs it.',
          ),
        ),
      );
    } on ApiError catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  String? _waitLine() {
    final picked = _picked;
    if (picked == null) return null;
    for (final machine in _payload?.machines ?? const <AgentOsMachine>[]) {
      if (machine.id == picked && !machine.online) {
        return '${machine.name} is asleep. This thread waits here — it will not run on the phone\'s cloud. Wake that computer, then try again.';
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Named computers')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text(_error!))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Text(
                    'Work runs on the computer you pick. A grey row means that computer is asleep.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 12),
                  if (_waitLine() != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        _waitLine()!,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  if (_plugins.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Text('Approve as you', style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 8),
                    for (final plugin in _plugins)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text('${plugin.app} · ${plugin.mode}'),
                            for (final action in plugin.actions)
                              ActionChip(
                                label: Text(action),
                                onPressed: () => _approve(plugin, action),
                              ),
                          ],
                        ),
                      ),
                  ],
                  for (final machine in _payload?.machines ?? const <AgentOsMachine>[])
                    ListTile(
                      title: Text(
                        machine.name,
                        style: TextStyle(
                          color: machine.online ? null : Colors.grey,
                        ),
                      ),
                      subtitle: Text(machine.online ? 'Awake' : 'Asleep'),
                      trailing: _picked == machine.id
                          ? const Icon(Icons.check)
                          : null,
                      onTap: () => _select(machine),
                    ),
                ],
              ),
            ),
    );
  }
}
