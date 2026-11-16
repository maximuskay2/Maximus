import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Bound machine + who approved, matching web `AgentOsWhere`.
class AgentOsWhere extends StatefulWidget {
  const AgentOsWhere({
    super.key,
    required this.client,
    required this.baseUrl,
    this.botId,
    this.threadId,
    this.answeredBy,
  });

  final MaximusApi client;
  final String baseUrl;
  final String? botId;
  final String? threadId;
  final CardAnsweredBy? answeredBy;

  @override
  State<AgentOsWhere> createState() => _AgentOsWhereState();
}

class _AgentOsWhereState extends State<AgentOsWhere> {
  String _machine = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AgentOsWhere oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.botId != widget.botId ||
        oldWidget.threadId != widget.threadId ||
        oldWidget.baseUrl != widget.baseUrl) {
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final machineId = await widget.client.agentOsAssignment(
        widget.baseUrl,
        botId: widget.botId,
        threadId: widget.threadId,
      );
      if (machineId == null || !mounted) return;
      final payload = await widget.client.agentOsMachines(widget.baseUrl);
      final found = payload.machines.where((row) => row.id == machineId);
      if (!mounted) return;
      setState(() => _machine = found.isEmpty ? '' : found.first.name);
    } catch (_) {
      /* assignment is optional chrome on the card */
    }
  }

  @override
  Widget build(BuildContext context) {
    final who = widget.answeredBy?.label.trim() ?? '';
    if (_machine.isEmpty && who.isEmpty) return const SizedBox.shrink();
    final parts = <String>[
      if (_machine.isNotEmpty) 'on $_machine',
      if (who.isNotEmpty) 'approved by $who',
    ];
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        parts.join(' · '),
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
        ),
      ),
    );
  }
}
