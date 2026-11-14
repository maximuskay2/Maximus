import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../auth/auth_state.dart';
import '../chat/drafts.dart';
import '../chat/thread_page.dart';
import '../theme/chrome.dart';

/// Schedules and their history: next run, pause/resume, run now, delete,
/// edit-via-chat-draft, and a compact create sheet (daily/interval).
class RoutinesPage extends StatefulWidget {
  const RoutinesPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.bots,
    this.drafts,
  });

  final AuthState auth;
  final String baseUrl;
  final List<BotSummary> bots;

  /// Draft store for edit-via-chat (secure storage by default).
  final DraftStore? drafts;

  @override
  State<RoutinesPage> createState() => _RoutinesPageState();
}

class _RoutinesPageState extends State<RoutinesPage> {
  List<Routine> _routines = const [];
  List<RoutineRun> _runs = const [];
  bool _loading = true;
  String? _error;

  MaximusApi get _client => widget.auth.client;

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
      final list = await _client.routines(widget.baseUrl);
      if (mounted) {
        setState(() {
          _routines = list.routines;
          _runs = list.runs;
        });
      }
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _botName(String botId) {
    for (final bot in widget.bots) {
      if (bot.id == botId) return bot.name;
    }
    return 'Bot';
  }

  BotSummary? _bot(String botId) {
    for (final bot in widget.bots) {
      if (bot.id == botId) return bot;
    }
    return null;
  }

  String _nextRun(int? at) {
    if (at == null) return 'Not scheduled';
    final when = DateTime.fromMillisecondsSinceEpoch(at);
    final inMinutes = when.difference(DateTime.now()).inMinutes;
    if (inMinutes < 1) return 'Due now';
    if (inMinutes < 60) return 'In $inMinutes min';
    final inHours = when.difference(DateTime.now()).inHours;
    if (inHours < 24) return 'In $inHours h';
    return '${when.month}/${when.day} ${when.hour.toString().padLeft(2, '0')}:${when.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _flip(Routine routine, bool enabled) async {
    try {
      final next = await _client.patchRoutine(
        widget.baseUrl,
        routine.id,
        {'enabled': enabled},
      );
      if (mounted) {
        setState(() {
          final at = _routines.indexWhere((r) => r.id == routine.id);
          if (at >= 0) _routines[at] = next;
        });
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _runNow(Routine routine) async {
    try {
      await _client.runRoutineNow(widget.baseUrl, routine.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('"${routine.name}" started.')),
        );
        await _load();
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _delete(Routine routine) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete "${routine.name}"?'),
        content: const Text('Its schedule stops and its history stays.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await _client.deleteRoutine(widget.baseUrl, routine.id);
      if (mounted) {
        Navigator.of(context).maybePop();
        await _load();
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  /// Full routine editing is a conversation: prefill the bot's main thread
  /// with an edit request and open it.
  Future<void> _editInChat(Routine routine) async {
    final bot = _bot(routine.botId);
    if (bot == null) return;
    final drafts = widget.drafts ?? DraftStore();
    await drafts.write(
      bot.threadId,
      'Edit the "${routine.name}" routine: ',
    );
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ThreadPage(
          client: _client,
          baseUrl: widget.baseUrl,
          bot: bot,
          thread: ThreadSummary(
            threadId: bot.threadId,
            title: bot.name,
            createdAt: 0,
          ),
          cache: widget.auth.cache,
          serverId: widget.auth.active?.id,
          onSessionEnded: widget.auth.sessionEnded,
        ),
      ),
    );
  }

  void _openDetail(Routine routine) {
    final history = [
      for (final run in _runs)
        if (run.routineId == routine.id) run,
    ];
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        maxChildSize: 0.92,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              routine.name,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 4),
            Text(
              '${_botName(routine.botId)} · ${routine.scheduleSummary} · ${_nextRun(routine.nextRunAt)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (routine.warning != null) ...[
              const SizedBox(height: 8),
              Text(
                routine.warning!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              routine.prompt,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonal(
                  onPressed: () => _runNow(routine),
                  child: const Text('Run now'),
                ),
                OutlinedButton(
                  onPressed: () => _flip(routine, !routine.enabled),
                  child: Text(routine.enabled ? 'Pause' : 'Resume'),
                ),
                OutlinedButton(
                  onPressed: () => _editInChat(routine),
                  child: const Text('Edit in chat'),
                ),
                TextButton(
                  onPressed: () => _delete(routine),
                  child: Text(
                    'Delete',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (history.isEmpty)
              const Text('No runs yet.')
            else
              for (final run in history.take(20))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    run.done
                        ? Icons.check_circle_outline
                        : run.failed
                        ? Icons.error_outline
                        : Icons.schedule_outlined,
                    color: run.failed
                        ? Theme.of(context).colorScheme.error
                        : null,
                  ),
                  title: Text(
                    run.output?.trim().isNotEmpty == true
                        ? run.output!.trim().split('\n').first
                        : run.status,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    '${_nextRun(run.scheduledFor)}${run.manual ? ' · manual' : ''}',
                  ),
                ),
          ],
        ),
      ),
    );
  }

  Future<void> _create() async {
    if (widget.bots.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add a bot first.')),
      );
      return;
    }
    final name = TextEditingController();
    final prompt = TextEditingController();
    var botId = widget.bots.first.id;
    var daily = true;
    var time = const TimeOfDay(hour: 8, minute: 0);
    var intervalMinutes = 60;
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (_, setSheet) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'New routine',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: botId,
                decoration: const InputDecoration(labelText: 'Bot'),
                items: [
                  for (final bot in widget.bots)
                    DropdownMenuItem(
                      value: bot.id,
                      child: Text(bot.name),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) setSheet(() => botId = value);
                },
              ),
              const SizedBox(height: 8),
              TextField(
                controller: prompt,
                decoration: const InputDecoration(
                  labelText: 'What should the bot do?',
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 8),
              MaxSegment<bool>(
                value: daily,
                options: const [(true, 'Daily'), (false, 'Interval')],
                onChanged: (value) => setSheet(() => daily = value),
              ),
              const SizedBox(height: 8),
              if (daily)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('At ${time.format(context)}'),
                  trailing: const Icon(Icons.schedule_outlined),
                  onTap: () async {
                    final picked = await showTimePicker(
                      context: sheetContext,
                      initialTime: time,
                    );
                    if (picked != null) setSheet(() => time = picked);
                  },
                )
              else
                DropdownButtonFormField<int>(
                  initialValue: intervalMinutes,
                  decoration: const InputDecoration(
                    labelText: 'Every',
                  ),
                  items: const [
                    DropdownMenuItem(value: 15, child: Text('15 minutes')),
                    DropdownMenuItem(value: 30, child: Text('30 minutes')),
                    DropdownMenuItem(value: 60, child: Text('1 hour')),
                    DropdownMenuItem(value: 180, child: Text('3 hours')),
                    DropdownMenuItem(value: 720, child: Text('12 hours')),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setSheet(() => intervalMinutes = value);
                    }
                  },
                ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(sheetContext).pop(true),
                  child: const Text('Create'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (created != true || !mounted) return;
    if (name.text.trim().isEmpty || prompt.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name and instructions are required.')),
      );
      return;
    }
    try {
      await _client.createRoutine(
        widget.baseUrl,
        name: name.text.trim(),
        prompt: prompt.text.trim(),
        botId: botId,
        schedule: daily
            ? {
                'type': 'daily',
                'time':
                    '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}',
                'weekdays': [0, 1, 2, 3, 4, 5, 6],
              }
            : {
                'type': 'interval',
                'everyMinutes': intervalMinutes,
                'anchorAt': DateTime.now().millisecondsSinceEpoch,
              },
      );
      await _load();
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Routines')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.add),
        label: const Text('New'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: _load,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          : _routines.isEmpty
          ? const Center(
              child: Text('No routines yet — tap New to schedule one.'),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                children: [
                  for (final routine in _routines)
                    SwitchListTile(
                      title: Text(routine.name),
                      subtitle: Text(
                        '${_botName(routine.botId)} · ${routine.scheduleSummary} · ${_nextRun(routine.nextRunAt)}'
                        '${routine.weekTotal != null ? ' · ${routine.weekOk ?? 0}/${routine.weekTotal} this week' : ''}',
                      ),
                      value: routine.enabled,
                      onChanged: (on) => _flip(routine, on),
                      secondary: IconButton(
                        icon: const Icon(Icons.chevron_right),
                        tooltip: 'Details',
                        onPressed: () => _openDetail(routine),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
